/**
 * HTTP transport fails closed (CWE-306).
 *
 * Startup refuses to listen when CONDUIT_S2S_SECRET is empty or a known
 * placeholder, unless MCP_ALLOW_INSECURE_DEV=1. That flag binds 127.0.0.1
 * only. A configured secret honors MCP_HTTP_HOST. Gateway-mode /mcp
 * requests without X-Meraki-Api-Key are 401 and must not read MERAKI_*
 * from process.env.
 */

import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const S2S_SECRET = 's2s-do-not-log-7f3a';
const ENV_API_KEY = 'env-meraki-key-must-not-leak';
const ENV_ORG_ID = 'env-org-must-not-leak';

const getCredentialsSpy = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/client.js')>();
  return {
    ...actual,
    getCredentials: () => {
      const creds = actual.getCredentials();
      getCredentialsSpy(creds);
      return creds;
    },
  };
});

import { startHttpServer } from '../src/http.js';

const ENV_KEYS = [
  'CONDUIT_S2S_SECRET',
  'MCP_ALLOW_INSECURE_DEV',
  'MCP_HTTP_PORT',
  'MCP_HTTP_HOST',
  'AUTH_MODE',
  'MERAKI_API_KEY',
  'MERAKI_ORG_ID',
  'MERAKI_BASE_URL',
  'LOG_LEVEL',
  'MCP_TRANSPORT',
] as const;

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const servers: Server[] = [];

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

function captureConsoleError(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  return {
    text: () => lines.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

function exitSpy() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code ?? 'undefined'}`);
  }) as typeof process.exit);
}

function listenInfo(server: Server): AddressInfo {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('expected a TCP address');
  }
  return address;
}

async function closeServers(): Promise<void> {
  const open = servers.splice(0);
  await Promise.all(open.map((server) => new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((err) => (err ? reject(err) : resolve()));
  })));
}

beforeEach(() => {
  restoreEnv();
  process.env.LOG_LEVEL = 'error';
  process.env.MCP_HTTP_PORT = '0';
  delete process.env.MCP_HTTP_HOST;
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.MERAKI_API_KEY;
  delete process.env.MERAKI_ORG_ID;
  delete process.env.MERAKI_BASE_URL;
  getCredentialsSpy.mockClear();
});

afterEach(async () => {
  await closeServers();
  restoreEnv();
});

async function expectRefused(assertLog: (logged: string) => void): Promise<void> {
  const captured = captureConsoleError();
  const exit = exitSpy();
  try {
    await expect(startHttpServer()).rejects.toThrow('process.exit:1');
    expect(exit).toHaveBeenCalledWith(1);
    assertLog(captured.text());
  } finally {
    captured.restore();
    exit.mockRestore();
  }
}

async function startTracked(): Promise<Server> {
  const exit = exitSpy();
  try {
    const server = await startHttpServer();
    servers.push(server);
    expect(exit).not.toHaveBeenCalled();
    return server;
  } finally {
    exit.mockRestore();
  }
}

function statusCallBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'meraki_status', arguments: {} },
  });
}

async function postMcp(port: number, headers: Record<string, string>): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: statusCallBody(),
  });
}

describe('HTTP startup fails closed without CONDUIT_S2S_SECRET', () => {
  it('logs an error and exits non-zero when the secret is empty', async () => {
    await expectRefused((logged) => {
      expect(logged).toContain('Refusing to start HTTP server: CONDUIT_S2S_SECRET is empty.');
      expect(logged).toContain('MCP_ALLOW_INSECURE_DEV=1');
      expect(logged).not.toContain(S2S_SECRET);
    });
  });

  it('treats a whitespace-only secret as empty', async () => {
    process.env.CONDUIT_S2S_SECRET = '   ';
    await expectRefused((logged) => {
      expect(logged).toContain('CONDUIT_S2S_SECRET is empty');
    });
  });

  it('still exits when MCP_ALLOW_INSECURE_DEV is not exactly 1', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = 'true';
    await expectRefused((logged) => {
      expect(logged).toContain('CONDUIT_S2S_SECRET is empty');
    });
  });

  it('starts on 127.0.0.1 and logs a warning when MCP_ALLOW_INSECURE_DEV=1', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.AUTH_MODE = 'gateway';
    const captured = captureConsoleError();
    try {
      const server = await startTracked();
      expect(listenInfo(server).address).toBe('127.0.0.1');
      const logged = captured.text();
      expect(logged).toContain('SECURITY WARNING');
      expect(logged).toContain('MCP_ALLOW_INSECURE_DEV=1');
      expect(logged).toContain('DISABLED');
      expect(logged).toContain('127.0.0.1');
      expect(logged).not.toContain(S2S_SECRET);
    } finally {
      captured.restore();
    }
  });

  it('forces 127.0.0.1 when insecure dev is set and MCP_HTTP_HOST is wider', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const captured = captureConsoleError();
    try {
      const server = await startTracked();
      expect(listenInfo(server).address).toBe('127.0.0.1');
      const logged = captured.text();
      expect(logged).toContain('MCP_HTTP_HOST=0.0.0.0');
      expect(logged).toContain('forces the listener to 127.0.0.1 only');
      expect(logged).not.toContain(S2S_SECRET);
    } finally {
      captured.restore();
    }
  });

  it('refuses a known placeholder secret and does not log it', async () => {
    process.env.CONDUIT_S2S_SECRET = 'replace-with-a-real-secret';
    await expectRefused((logged) => {
      expect(logged).toContain('known placeholder');
      expect(logged).toContain('openssl rand -hex 32');
      expect(logged).not.toContain('replace-with-a-real-secret');
    });
  });

  it('refuses a placeholder even when MCP_ALLOW_INSECURE_DEV=1', async () => {
    process.env.CONDUIT_S2S_SECRET = '  Your-S2S-Secret  ';
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    await expectRefused((logged) => {
      expect(logged).toContain('known placeholder');
      expect(logged).not.toContain('Your-S2S-Secret');
    });
  });

  it('refuses other known placeholders without logging them', async () => {
    for (const placeholder of ['changeme', 'ChangeMe', 's2s-secret']) {
      process.env.CONDUIT_S2S_SECRET = placeholder;
      await expectRefused((logged) => {
        expect(logged).toContain('known placeholder');
        expect(logged).not.toContain(placeholder);
      });
    }
  });

  it('honors MCP_HTTP_HOST when a real secret is configured', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    const captured = captureConsoleError();
    try {
      const server = await startTracked();
      expect(listenInfo(server).address).toBe('0.0.0.0');
      expect(captured.text()).not.toContain(S2S_SECRET);
    } finally {
      captured.restore();
    }
  });

  it('defaults to 127.0.0.1 when a secret is set and MCP_HTTP_HOST is unset', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    delete process.env.MCP_HTTP_HOST;
    const server = await startTracked();
    expect(listenInfo(server).address).toBe('127.0.0.1');
  });

  it('accepts a secret that merely contains a placeholder word', async () => {
    process.env.CONDUIT_S2S_SECRET = 'not-a-placeholder-secret-value';
    const server = await startTracked();
    expect(listenInfo(server).address).toBe('127.0.0.1');
  });
});

describe('gateway /mcp auth', () => {
  let port = 0;

  beforeEach(async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.MCP_HTTP_PORT = '0';
    process.env.AUTH_MODE = 'gateway';
    process.env.MERAKI_API_KEY = ENV_API_KEY;
    process.env.MERAKI_ORG_ID = ENV_ORG_ID;
    process.env.LOG_LEVEL = 'error';

    const server = await startTracked();
    port = listenInfo(server).port;
    getCredentialsSpy.mockClear();
  });

  it('serves /health without authentication and without reading credentials', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json() as { status: string; credentials?: unknown };
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.credentials).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(ENV_API_KEY);
    expect(JSON.stringify(body)).not.toContain(ENV_ORG_ID);
    expect(JSON.stringify(body)).not.toContain(S2S_SECRET);
    expect(getCredentialsSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when the S2S header is missing', async () => {
    const response = await postMcp(port, {
      'x-meraki-api-key': 'header-key',
      'x-meraki-org-id': 'header-org',
    });
    const body = await response.json() as { error: string };
    expect(response.status).toBe(401);
    expect(body.error).toMatch(/X-Gateway-S2S/);
    expect(getCredentialsSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(ENV_API_KEY);
    expect(JSON.stringify(body)).not.toContain(S2S_SECRET);
  });

  it('returns 401 when the S2S header is invalid', async () => {
    const response = await postMcp(port, {
      'x-gateway-s2s': mintS2sHeader('wrong-secret'),
      'x-meraki-api-key': 'header-key',
    });
    const body = await response.json() as { error: string };
    expect(response.status).toBe(401);
    expect(body.error).toMatch(/X-Gateway-S2S/);
    expect(getCredentialsSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(ENV_API_KEY);
  });

  it('returns 401 in gateway mode when the API key header is missing and does not use env credentials', async () => {
    const response = await postMcp(port, {
      'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
      'x-meraki-org-id': 'header-org',
    });
    const body = await response.json() as { error: string };
    expect(response.status).toBe(401);
    expect(body.error).toMatch(/x-meraki-api-key/);
    expect(getCredentialsSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(ENV_API_KEY);
    expect(JSON.stringify(body)).not.toContain(ENV_ORG_ID);
    expect(JSON.stringify(body)).not.toContain(S2S_SECRET);
  });

  it('accepts a valid S2S header plus credential headers and uses those credentials', async () => {
    const response = await postMcp(port, {
      'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
      'x-meraki-api-key': 'header-key',
      'x-meraki-org-id': 'header-org',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      result: { content: Array<{ text: string }> };
    };
    const status = JSON.parse(body.result.content[0].text) as { orgId: string | null; connected: boolean };
    expect(status.connected).toBe(true);
    expect(status.orgId).toBe('header-org');
    expect(JSON.stringify(body)).not.toContain(ENV_API_KEY);
    expect(JSON.stringify(body)).not.toContain(ENV_ORG_ID);
    expect(JSON.stringify(body)).not.toContain(S2S_SECRET);
    expect(getCredentialsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'header-key', orgId: 'header-org' }),
    );
  });
});

describe('env mode still requires S2S and then reads MERAKI_*', () => {
  it('returns 401 without X-Gateway-S2S and uses env credentials when the header is valid', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = 'env';
    process.env.MERAKI_API_KEY = ENV_API_KEY;
    process.env.MERAKI_ORG_ID = ENV_ORG_ID;
    process.env.MCP_HTTP_HOST = '127.0.0.1';

    const server = await startTracked();
    const port = listenInfo(server).port;
    getCredentialsSpy.mockClear();

    const missing = await postMcp(port, {});
    expect(missing.status).toBe(401);
    expect(getCredentialsSpy).not.toHaveBeenCalled();

    const response = await postMcp(port, {
      'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      result: { content: Array<{ text: string }> };
    };
    const status = JSON.parse(body.result.content[0].text) as { orgId: string | null; connected: boolean };
    expect(status.connected).toBe(true);
    expect(status.orgId).toBe(ENV_ORG_ID);
    expect(JSON.stringify(body)).not.toContain(ENV_API_KEY);
    expect(JSON.stringify(body)).not.toContain(S2S_SECRET);
    expect(getCredentialsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: ENV_API_KEY, orgId: ENV_ORG_ID }),
    );
  });
});

describe('insecure local dev', () => {
  it('skips X-Gateway-S2S and still rejects gateway requests that omit the API key', async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.AUTH_MODE = 'gateway';
    process.env.MERAKI_API_KEY = ENV_API_KEY;
    process.env.MERAKI_ORG_ID = ENV_ORG_ID;
    process.env.MCP_HTTP_HOST = '0.0.0.0';

    const server = await startTracked();
    expect(listenInfo(server).address).toBe('127.0.0.1');
    const port = listenInfo(server).port;
    getCredentialsSpy.mockClear();

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    expect(getCredentialsSpy).not.toHaveBeenCalled();

    const missing = await postMcp(port, {});
    const missingBody = await missing.json() as { error: string };
    expect(missing.status).toBe(401);
    expect(missingBody.error).toMatch(/x-meraki-api-key/);
    expect(getCredentialsSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(missingBody)).not.toContain(ENV_API_KEY);

    const response = await postMcp(port, {
      'x-meraki-api-key': 'header-key',
      'x-meraki-org-id': 'header-org',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      result: { content: Array<{ text: string }> };
    };
    const status = JSON.parse(body.result.content[0].text) as { orgId: string | null };
    expect(status.orgId).toBe('header-org');
    expect(JSON.stringify(body)).not.toContain(ENV_API_KEY);
    expect(JSON.stringify(body)).not.toContain(ENV_ORG_ID);
  });
});
