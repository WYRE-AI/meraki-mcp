/**
 * Handler-invocation tests for the clients domain.
 *
 * safety.test.ts already pins the confirmation-gating behavior of
 * meraki_clients_update_policy. These tests cover request shaping (including
 * the group_policy_id passthrough) and response mapping for every tool.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { listByNetworkSpy, getSpy, getPolicySpy, updatePolicySpy } = vi.hoisted(() => ({
  listByNetworkSpy: vi.fn(),
  getSpy: vi.fn(),
  getPolicySpy: vi.fn(),
  updatePolicySpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    clients: {
      listByNetwork: listByNetworkSpy,
      get: getSpy,
      getPolicy: getPolicySpy,
      updatePolicy: updatePolicySpy,
    },
  })),
}));

import { clientsHandler } from '../../src/domains/clients.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('clientsHandler', () => {
  beforeEach(resetEnv);

  describe('meraki_clients_list', () => {
    it('maps network_id/timespan/per_page to listByNetwork', async () => {
      const clients = [{ id: 'k1', mac: 'aa:bb:cc:dd:ee:ff' }];
      listByNetworkSpy.mockResolvedValue(clients);

      const res = await clientsHandler.handleCall('meraki_clients_list', {
        network_id: 'N_1',
        timespan: 3600,
        per_page: 100,
      });

      expect(listByNetworkSpy).toHaveBeenCalledWith('N_1', { timespan: 3600, perPage: 100 });
      expect(JSON.parse(res.content[0].text)).toEqual(clients);
    });
  });

  describe('meraki_clients_get', () => {
    it('passes network_id and client_id through to clients.get', async () => {
      const client = { id: 'k1', mac: 'aa:bb:cc:dd:ee:ff' };
      getSpy.mockResolvedValue(client);

      const res = await clientsHandler.handleCall('meraki_clients_get', {
        network_id: 'N_1',
        client_id: 'aa:bb:cc:dd:ee:ff',
      });

      expect(getSpy).toHaveBeenCalledWith('N_1', 'aa:bb:cc:dd:ee:ff');
      expect(JSON.parse(res.content[0].text)).toEqual(client);
    });
  });

  describe('meraki_clients_get_policy', () => {
    it('passes network_id and client_id through to clients.getPolicy', async () => {
      const policy = { devicePolicy: 'Normal' };
      getPolicySpy.mockResolvedValue(policy);

      const res = await clientsHandler.handleCall('meraki_clients_get_policy', {
        network_id: 'N_1',
        client_id: 'aa:bb:cc:dd:ee:ff',
      });

      expect(getPolicySpy).toHaveBeenCalledWith('N_1', 'aa:bb:cc:dd:ee:ff');
      expect(JSON.parse(res.content[0].text)).toEqual(policy);
    });
  });

  describe('meraki_clients_update_policy', () => {
    it('maps device_policy/group_policy_id to updatePolicy and returns the result once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      const updated = { devicePolicy: 'Group policy', groupPolicyId: 'gp_1' };
      updatePolicySpy.mockResolvedValue(updated);

      const res = await clientsHandler.handleCall('meraki_clients_update_policy', {
        network_id: 'N_1',
        client_id: 'aa:bb:cc:dd:ee:ff',
        device_policy: 'Group policy',
        group_policy_id: 'gp_1',
        confirm_destructive_action: true,
      });

      expect(updatePolicySpy).toHaveBeenCalledWith('N_1', 'aa:bb:cc:dd:ee:ff', {
        devicePolicy: 'Group policy',
        groupPolicyId: 'gp_1',
      });
      expect(JSON.parse(res.content[0].text)).toEqual(updated);
    });

    it('passes groupPolicyId as undefined when not applicable (e.g. Blocked)', async () => {
      process.env.READ_ONLY_MODE = 'false';
      updatePolicySpy.mockResolvedValue({ devicePolicy: 'Blocked' });

      await clientsHandler.handleCall('meraki_clients_update_policy', {
        network_id: 'N_1',
        client_id: 'aa:bb:cc:dd:ee:ff',
        device_policy: 'Blocked',
        confirm_destructive_action: true,
      });

      expect(updatePolicySpy).toHaveBeenCalledWith('N_1', 'aa:bb:cc:dd:ee:ff', {
        devicePolicy: 'Blocked',
        groupPolicyId: undefined,
      });
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await clientsHandler.handleCall('meraki_clients_bogus', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
