/**
 * Handler-invocation tests for the passthrough (long-tail escape hatch) domain.
 *
 * safety.test.ts already exercises the DELETE (destructive) path in detail.
 * These tests cover the two paths it does not: a plain GET (no guard at all)
 * and a POST (a write that is gated by read-only mode but does not require
 * `confirm_destructive_action`) — plus that a rejected SDK call propagates as
 * a rejection rather than being silently swallowed, since the domain handler
 * itself has no try/catch (that lives in server.ts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { requestSpy } = vi.hoisted(() => ({
  requestSpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    request: requestSpy,
  })),
}));

import { passthroughHandler } from '../../src/domains/passthrough.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('passthroughHandler', () => {
  beforeEach(resetEnv);

  describe('GET', () => {
    it('is never gated by read-only mode and forwards query params', async () => {
      // No READ_ONLY_MODE set → read-only is ON by default, but GET is a
      // read and must bypass the guard entirely.
      const body = { id: 'org_1' };
      requestSpy.mockResolvedValue(body);

      const res = await passthroughHandler.handleCall('meraki_raw_request', {
        method: 'GET',
        path: '/organizations/org_1',
        query: { includeInventory: true },
      });

      expect(res.isError).toBeFalsy();
      expect(requestSpy).toHaveBeenCalledWith('GET', '/organizations/org_1', {
        query: { includeInventory: true },
        body: undefined,
      });
      expect(JSON.parse(res.content[0].text)).toEqual(body);
    });
  });

  describe('POST', () => {
    it('is blocked by read-only mode (default) without needing confirmation', async () => {
      const res = await passthroughHandler.handleCall('meraki_raw_request', {
        method: 'POST',
        path: '/networks/N_1/devices/claim',
        body: { serials: ['Q2XX-1111-AAAA'] },
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('read_only_mode');
      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('proceeds once read-only mode is disabled, with no confirmation flag required', async () => {
      process.env.READ_ONLY_MODE = 'false';
      requestSpy.mockResolvedValue({ claimed: true });

      const res = await passthroughHandler.handleCall('meraki_raw_request', {
        method: 'POST',
        path: '/networks/N_1/devices/claim',
        body: { serials: ['Q2XX-1111-AAAA'] },
      });

      expect(res.isError).toBeFalsy();
      expect(requestSpy).toHaveBeenCalledWith('POST', '/networks/N_1/devices/claim', {
        query: undefined,
        body: { serials: ['Q2XX-1111-AAAA'] },
      });
    });
  });

  describe('error propagation', () => {
    it('does not swallow a rejected SDK call — it propagates for server.ts to catch', async () => {
      process.env.READ_ONLY_MODE = 'false';
      requestSpy.mockRejectedValue(new Error('Meraki API 404'));

      await expect(
        passthroughHandler.handleCall('meraki_raw_request', {
          method: 'GET',
          path: '/organizations/does-not-exist',
        })
      ).rejects.toThrow('Meraki API 404');
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await passthroughHandler.handleCall('meraki_raw_bogus', {} as never);
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
