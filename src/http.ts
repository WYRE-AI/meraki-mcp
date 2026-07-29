import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { getCredentials, runWithCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || '';

function startHttpServer(): void {
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const host = process.env.MCP_HTTP_HOST || '0.0.0.0';
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      // liveness: must NOT gate on credentials (ACA probe carries none) or the container crash-loops
      const creds = getCredentials();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        transport: 'http',
        credentials: { configured: !!creds },
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
      return;
    }

    if (S2S_SECRET && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, S2S_SECRET)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.' }));
      return;
    }

    const apiKey = isGatewayMode ? (req.headers['x-meraki-api-key'] as string | undefined) : undefined;
    const orgId = isGatewayMode ? (req.headers['x-meraki-org-id'] as string | undefined) : undefined;

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

    // Gateway mode injects per-request tenant credentials via headers; scope them
    // to this request with AsyncLocalStorage so concurrent tenants never share a
    // credential slot. When absent (stdio/env mode, or a tools/list probe with no
    // creds) fall through to process.env — tools/list works without credentials,
    // only tools/call requires them.
    if (apiKey) {
      await runWithCredentials({ apiKey, orgId }, handle);
    } else {
      await handle();
    }
  });

  httpServer.listen(port, host, () => {
    logger.info(`HTTP streaming server listening on ${host}:${port}`);
  });
}

const transport = process.env.MCP_TRANSPORT;
if (transport === 'http') {
  startHttpServer();
} else {
  import('./index.js');
}
