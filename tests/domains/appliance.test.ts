/**
 * Handler-invocation tests for the appliance domain.
 *
 * safety.test.ts already pins the confirmation-gating behavior of
 * meraki_appliance_firewall_l3_update. These tests cover request shaping and
 * response mapping for every tool.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getL3Spy, updateL3Spy, getVpnSpy } = vi.hoisted(() => ({
  getL3Spy: vi.fn(),
  updateL3Spy: vi.fn(),
  getVpnSpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    appliance: {
      getL3FirewallRules: getL3Spy,
      updateL3FirewallRules: updateL3Spy,
      getSiteToSiteVpn: getVpnSpy,
    },
  })),
}));

import { applianceHandler } from '../../src/domains/appliance.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('applianceHandler', () => {
  beforeEach(resetEnv);

  describe('meraki_appliance_firewall_l3_get', () => {
    it('passes network_id to getL3FirewallRules and returns the raw rules', async () => {
      const rules = { rules: [{ policy: 'allow', protocol: 'any' }] };
      getL3Spy.mockResolvedValue(rules);

      const res = await applianceHandler.handleCall('meraki_appliance_firewall_l3_get', {
        network_id: 'N_1',
      });

      expect(getL3Spy).toHaveBeenCalledWith('N_1');
      expect(JSON.parse(res.content[0].text)).toEqual(rules);
    });
  });

  describe('meraki_appliance_firewall_l3_update', () => {
    it('wraps rules in { rules } for updateL3FirewallRules and returns the result once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      const ruleSet = [{ policy: 'deny', protocol: 'tcp', destPort: '23' }];
      const updated = { rules: ruleSet };
      updateL3Spy.mockResolvedValue(updated);

      const res = await applianceHandler.handleCall('meraki_appliance_firewall_l3_update', {
        network_id: 'N_1',
        rules: ruleSet,
        confirm_destructive_action: true,
      });

      expect(updateL3Spy).toHaveBeenCalledWith('N_1', { rules: ruleSet });
      expect(JSON.parse(res.content[0].text)).toEqual(updated);
    });
  });

  describe('meraki_appliance_vpn_status_get', () => {
    it('passes network_id to getSiteToSiteVpn and returns the raw status', async () => {
      const vpn = { mode: 'spoke', hubs: [] };
      getVpnSpy.mockResolvedValue(vpn);

      const res = await applianceHandler.handleCall('meraki_appliance_vpn_status_get', {
        network_id: 'N_1',
      });

      expect(getVpnSpy).toHaveBeenCalledWith('N_1');
      expect(JSON.parse(res.content[0].text)).toEqual(vpn);
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await applianceHandler.handleCall('meraki_appliance_bogus', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
