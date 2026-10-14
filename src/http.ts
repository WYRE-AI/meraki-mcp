import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { runWithCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

// HTTP startup fails closed (CWE-306). An empty CONDUIT_S2S_SECRET used to
// skip X-Gateway-S2S and accept /mcp. Startup now refuses to listen unless
// MCP_ALLOW_INSECURE_DEV=1, and that bypass binds 127.0.0.1 only. A known
// placeholder secret always refuses to start, including when the bypass flag
// is set. When a real secret is set, MCP_HTTP_HOST is honored. The secret
// value is never logged.

const LOOPBACK_HOST = '127.0.0.1';

/** Public example values. A copied placeholder must not verify as a real secret. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-real-secret',
  'your-s2s-secret',
  'your-secret',
  'changeme',
  'change-me',
  'placeholder',
  'secret',
  'example',
  'replace-me',
  's2s-secret',
]);

const MISSING_S2S_SECRET_ERROR =
  'Refusing to start HTTP server: CONDUIT_S2S_SECRET is empty. ' +
  'An empty secret would accept unauthenticated /mcp requests (CWE-306). ' +
  'Set CONDUIT_S2S_SECRET to the gateway-provisioned service-to-service secret, ' +
  'or set MCP_ALLOW_INSECURE_DEV=1 to bind 127.0.0.1 only for local development.';

const PLACEHOLDER_S2S_SECRET_ERROR =
  'Refusing to start HTTP server: CONDUIT_S2S_SECRET is a known placeholder. ' +
  'Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value. ' +
  'MCP_ALLOW_INSECURE_DEV does not accept a placeholder secret.';

const INSECURE_DEV_WARNING =
  'SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. ' +
  'HTTP /mcp is starting with service-to-service authentication DISABLED, bound to 127.0.0.1 only. ' +
  'Local development only; do not expose this port.';

const S2S_UNAUTHORIZED = {
  error: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
};

const GATEWAY_CREDENTIALS_UNAUTHORIZED = {
  error: 'Unauthorized: missing required gateway credential header x-meraki-api-key',
};

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read CONDUIT_S2S_SECRET at startup. Placeholders are rejected even when
 * MCP_ALLOW_INSECURE_DEV=1. Empty is fail-closed unless that flag is exactly
 * "1". The secret value is never written to logs.
 */
function resolveHttpS2sSecret(): { secret: string; insecureDev: boolean } {
  const raw = (process.env.CONDUIT_S2S_SECRET ?? '').trim();
  if (KNOWN_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    logger.error(PLACEHOLDER_S2S_SECRET_ERROR);
    process.exit(1);
  }
  if (raw) return { secret: raw, insecureDev: false };
  if (process.env.MCP_ALLOW_INSECURE_DEV === '1') {
    // error level so LOG_LEVEL=warn|error cannot hide the bypass.
    logger.error(INSECURE_DEV_WARNING);
    return { secret: '', insecureDev: true };
  }
  logger.error(MISSING_S2S_SECRET_ERROR);
  process.exit(1);
}

/**
 * Without a real secret the listener is 127.0.0.1 only, including when
 * MCP_HTTP_HOST is a wider address such as 0.0.0.0. A configured secret
 * honors MCP_HTTP_HOST. Unset host defaults to loopback.
 */
function resolveBindHost(insecureDev: boolean): string {
  const configured = (process.env.MCP_HTTP_HOST ?? '').trim();
  if (insecureDev) {
    if (configured && configured !== LOOPBACK_HOST) {
      logger.error(
        `WARNING: MCP_HTTP_HOST=${configured} is ignored because CONDUIT_S2S_SECRET is empty. ` +
          `MCP_ALLOW_INSECURE_DEV=1 forces the listener to ${LOOPBACK_HOST} only.`,
      );
    }
    return LOOPBACK_HOST;
  }
  return configured || LOOPBACK_HOST;
}

export async function startHttpServer(): Promise<Server> {
  const { secret: s2sSecret, insecureDev } = resolveHttpS2sSecret();
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const host = resolveBindHost(insecureDev);
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Liveness: must stay unauthenticated and must not read vendor credentials.
    // In gateway mode credentials arrive per request on /mcp. Gating this probe
    // on credentials would crash-loop the container.
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        transport: 'http',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
      return;
    }

    // Conduit service-to-service auth (gateway#377 parity): rejected
    // BEFORE any credential extraction. An empty secret only reaches this
    // point when MCP_ALLOW_INSECURE_DEV=1, in which case there is nothing
    // to verify. A configured secret is always enforced.
    if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(S2S_UNAUTHORIZED));
      return;
    }

    const apiKey = headerValue(req.headers['x-meraki-api-key']);
    const orgId = headerValue(req.headers['x-meraki-org-id']);

    const handle = async () => {
      // SECURITY-CRITICAL: this transport MUST stay stateless (sessionIdGenerator:
      // undefined + enableJsonResponse: true). Per-request tenant credentials are
      // carried in the AsyncLocalStorage context opened by runWithCredentials()
      // below, and a stateless request->single-response flow keeps the tool call
      // inside that context. A stateful/SSE transport (persistent stream) would let
      // a long-lived connection serve later messages under a stale/foreign
      // credential context — re-review tenant isolation before changing this.
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    };

    // Gateway mode injects per-request tenant credentials via headers and scopes
    // them with AsyncLocalStorage so concurrent tenants never share a credential
    // slot. Missing headers are rejected here. Falling through would resolve
    // MERAKI_API_KEY from the process environment.
    if (isGatewayMode) {
      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(GATEWAY_CREDENTIALS_UNAUTHORIZED));
        return;
      }
      await runWithCredentials({ apiKey, orgId }, handle);
      return;
    }

    await handle();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const boundPort = address && typeof address === 'object' ? address.port : port;
      logger.info(`HTTP streaming server listening on ${host}:${boundPort}`);
      resolve();
    });
  });

  return httpServer;
}

// Vitest imports this module to call startHttpServer. Skip the CLI
// entrypoint there. `node dist/http.js` still starts HTTP or stdio.
if (process.env.VITEST !== 'true') {
  if (process.env.MCP_TRANSPORT === 'http') {
    startHttpServer().catch((error: unknown) => {
      logger.error('Fatal HTTP startup error', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
  } else {
    void import('./index.js');
  }
}
