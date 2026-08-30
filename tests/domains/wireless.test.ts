/**
 * Handler-invocation tests for the wireless domain.
 *
 * safety.test.ts already pins the confirmation-gating behavior of
 * meraki_wireless_ssids_update. These tests cover request shaping — notably
 * the `settings` default-to-`{}` when omitted — and response mapping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { listSsidsSpy, updateSsidSpy, listRfProfilesSpy } = vi.hoisted(() => ({
  listSsidsSpy: vi.fn(),
  updateSsidSpy: vi.fn(),
  listRfProfilesSpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    wireless: {
      listSsids: listSsidsSpy,
      updateSsid: updateSsidSpy,
      listRfProfiles: listRfProfilesSpy,
    },
  })),
}));

import { wirelessHandler } from '../../src/domains/wireless.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('wirelessHandler', () => {
  beforeEach(resetEnv);

  describe('meraki_wireless_ssids_list', () => {
    it('passes network_id to listSsids and returns the raw list', async () => {
      const ssids = [{ number: 0, name: 'Corp' }];
      listSsidsSpy.mockResolvedValue(ssids);

      const res = await wirelessHandler.handleCall('meraki_wireless_ssids_list', { network_id: 'N_1' });

      expect(listSsidsSpy).toHaveBeenCalledWith('N_1');
      expect(JSON.parse(res.content[0].text)).toEqual(ssids);
    });
  });

  describe('meraki_wireless_ssids_update', () => {
    it('maps network_id/number/settings to updateSsid and returns the result once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      const updated = { number: 0, name: 'Corp-New' };
      updateSsidSpy.mockResolvedValue(updated);

      const res = await wirelessHandler.handleCall('meraki_wireless_ssids_update', {
        network_id: 'N_1',
        number: 0,
        settings: { name: 'Corp-New', enabled: true },
        confirm_destructive_action: true,
      });

      expect(updateSsidSpy).toHaveBeenCalledWith('N_1', 0, { name: 'Corp-New', enabled: true });
      expect(JSON.parse(res.content[0].text)).toEqual(updated);
    });

    it('defaults settings to {} when omitted rather than passing undefined', async () => {
      process.env.READ_ONLY_MODE = 'false';
      updateSsidSpy.mockResolvedValue({});

      await wirelessHandler.handleCall('meraki_wireless_ssids_update', {
        network_id: 'N_1',
        number: 2,
        confirm_destructive_action: true,
      });

      expect(updateSsidSpy).toHaveBeenCalledWith('N_1', 2, {});
    });
  });

  describe('meraki_wireless_rf_profiles_list', () => {
    it('passes network_id to listRfProfiles and returns the raw list', async () => {
      const profiles = [{ id: 'rf_1', name: 'Default' }];
      listRfProfilesSpy.mockResolvedValue(profiles);

      const res = await wirelessHandler.handleCall('meraki_wireless_rf_profiles_list', {
        network_id: 'N_1',
      });

      expect(listRfProfilesSpy).toHaveBeenCalledWith('N_1');
      expect(JSON.parse(res.content[0].text)).toEqual(profiles);
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await wirelessHandler.handleCall('meraki_wireless_bogus', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
