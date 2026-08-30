/**
 * Handler-invocation tests for the devices domain.
 *
 * meraki_devices_get is the most complex handler in the codebase: beyond the
 * plain get/list/reboot mapping, it attaches a best-effort `_card` payload
 * (see card.builder.ts, unit-tested in isolation by mcp-apps.test.ts) by
 * resolving the device's network id through a second SDK call. That
 * composition — get → buildDeviceCard → networks.get — is only exercised
 * end-to-end here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { listByNetworkSpy, getSpy, rebootSpy, removeSpy, networksGetSpy } = vi.hoisted(() => ({
  listByNetworkSpy: vi.fn(),
  getSpy: vi.fn(),
  rebootSpy: vi.fn(),
  removeSpy: vi.fn(),
  networksGetSpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    devices: {
      listByNetwork: listByNetworkSpy,
      get: getSpy,
      reboot: rebootSpy,
      removeFromNetwork: removeSpy,
    },
    networks: {
      get: networksGetSpy,
    },
  })),
}));

import { devicesHandler } from '../../src/domains/devices.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('devicesHandler', () => {
  beforeEach(resetEnv);

  describe('meraki_devices_list', () => {
    it('passes network_id to devices.listByNetwork and returns the raw list', async () => {
      const devices = [{ serial: 'Q2XX-1111-AAAA' }];
      listByNetworkSpy.mockResolvedValue(devices);

      const res = await devicesHandler.handleCall('meraki_devices_list', { network_id: 'N_1' });

      expect(listByNetworkSpy).toHaveBeenCalledWith('N_1');
      expect(JSON.parse(res.content[0].text)).toEqual(devices);
    });
  });

  describe('meraki_devices_get', () => {
    it('attaches a resolved _card when the device has a serial and a resolvable network', async () => {
      getSpy.mockResolvedValue({
        serial: 'Q2XX-1111-AAAA',
        name: 'ap-lobby',
        model: 'MR46',
        networkId: 'N_1',
        tags: ['floor-1'],
      });
      networksGetSpy.mockResolvedValue({ id: 'N_1', name: 'Downtown HQ' });

      const res = await devicesHandler.handleCall('meraki_devices_get', { serial: 'Q2XX-1111-AAAA' });

      expect(getSpy).toHaveBeenCalledWith('Q2XX-1111-AAAA');
      const payload = JSON.parse(res.content[0].text);
      expect(payload.serial).toBe('Q2XX-1111-AAAA');
      expect(payload._card).toBeDefined();
      expect(payload._card.name).toBe('ap-lobby');
      expect(payload._card.network).toBe('Downtown HQ');
    });

    it('falls back to the raw network id label when the network lookup fails', async () => {
      getSpy.mockResolvedValue({ serial: 'Q2XX-1111-AAAA', networkId: 'N_1' });
      networksGetSpy.mockRejectedValue(new Error('not found'));

      const res = await devicesHandler.handleCall('meraki_devices_get', { serial: 'Q2XX-1111-AAAA' });

      const payload = JSON.parse(res.content[0].text);
      expect(payload._card.network).toBe('N_1');
      expect(res.isError).toBeFalsy();
    });

    it('omits _card entirely for a payload with no serial (best-effort, never fails the tool)', async () => {
      getSpy.mockResolvedValue({ name: 'weird-payload' });

      const res = await devicesHandler.handleCall('meraki_devices_get', { serial: 'Q2XX-1111-AAAA' });

      const payload = JSON.parse(res.content[0].text);
      expect(payload._card).toBeUndefined();
      expect(res.isError).toBeFalsy();
    });
  });

  describe('meraki_devices_reboot', () => {
    it('calls devices.reboot and returns the raw result once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      rebootSpy.mockResolvedValue({ success: true });

      const res = await devicesHandler.handleCall('meraki_devices_reboot', {
        serial: 'Q2XX-1111-AAAA',
        confirm_destructive_action: true,
      });

      expect(rebootSpy).toHaveBeenCalledWith('Q2XX-1111-AAAA');
      expect(JSON.parse(res.content[0].text)).toEqual({ success: true });
    });
  });

  describe('meraki_devices_remove', () => {
    it('calls devices.removeFromNetwork with network_id and serial once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      removeSpy.mockResolvedValue(undefined);

      const res = await devicesHandler.handleCall('meraki_devices_remove', {
        network_id: 'N_1',
        serial: 'Q2XX-1111-AAAA',
        confirm_destructive_action: true,
      });

      expect(removeSpy).toHaveBeenCalledWith('N_1', 'Q2XX-1111-AAAA');
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('Q2XX-1111-AAAA');
      expect(res.content[0].text).toContain('N_1');
    });

    it('is blocked by read-only mode (default) before calling the SDK', async () => {
      const res = await devicesHandler.handleCall('meraki_devices_remove', {
        network_id: 'N_1',
        serial: 'Q2XX-1111-AAAA',
        confirm_destructive_action: true,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('read_only_mode');
      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await devicesHandler.handleCall('meraki_devices_bogus', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
