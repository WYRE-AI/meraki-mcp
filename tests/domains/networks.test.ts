/**
 * Handler-invocation tests for the networks domain.
 *
 * safety.test.ts already pins the confirmation-gating behavior of
 * meraki_networks_update / meraki_networks_delete. These tests cover what
 * that file does not: the exact request shape sent to the SDK once a write
 * is unblocked, and response mapping for the read tools.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { listSpy, getSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  listSpy: vi.fn(),
  getSpy: vi.fn(),
  updateSpy: vi.fn(),
  deleteSpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    networks: {
      listByOrg: listSpy,
      get: getSpy,
      update: updateSpy,
      delete: deleteSpy,
    },
  })),
}));

import { networksHandler } from '../../src/domains/networks.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('networksHandler', () => {
  beforeEach(resetEnv);

  describe('meraki_networks_list', () => {
    it('maps organization_id and pagination to listByOrg', async () => {
      const networks = [{ id: 'N_1', name: 'HQ' }];
      listSpy.mockResolvedValue(networks);

      const res = await networksHandler.handleCall('meraki_networks_list', {
        organization_id: 'org_1',
        per_page: 25,
        starting_after: 'cursor-1',
      });

      expect(listSpy).toHaveBeenCalledWith('org_1', {
        perPage: 25,
        startingAfter: 'cursor-1',
      });
      expect(JSON.parse(res.content[0].text)).toEqual(networks);
    });
  });

  describe('meraki_networks_get', () => {
    it('passes network_id through to networks.get and returns the raw network', async () => {
      const network = { id: 'N_1', name: 'HQ' };
      getSpy.mockResolvedValue(network);

      const res = await networksHandler.handleCall('meraki_networks_get', { network_id: 'N_1' });

      expect(getSpy).toHaveBeenCalledWith('N_1');
      expect(JSON.parse(res.content[0].text)).toEqual(network);
    });
  });

  describe('meraki_networks_update', () => {
    it('maps args to networks.update and returns the updated network once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      const updated = { id: 'N_1', name: 'renamed', tags: ['production'] };
      updateSpy.mockResolvedValue(updated);

      const res = await networksHandler.handleCall('meraki_networks_update', {
        network_id: 'N_1',
        name: 'renamed',
        timeZone: 'America/Chicago',
        tags: ['production'],
        notes: 'renamed via test',
        confirm_destructive_action: true,
      });

      expect(updateSpy).toHaveBeenCalledWith('N_1', {
        name: 'renamed',
        timeZone: 'America/Chicago',
        tags: ['production'],
        notes: 'renamed via test',
      });
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.content[0].text)).toEqual(updated);
      // The confirmation flag itself must never reach the SDK.
      expect(JSON.stringify(updateSpy.mock.calls[0])).not.toContain('confirm_destructive_action');
    });

    it('passes undefined for omitted optional fields rather than dropping the key', async () => {
      process.env.READ_ONLY_MODE = 'false';
      updateSpy.mockResolvedValue({ id: 'N_1' });

      await networksHandler.handleCall('meraki_networks_update', {
        network_id: 'N_1',
        confirm_destructive_action: true,
      });

      expect(updateSpy).toHaveBeenCalledWith('N_1', {
        name: undefined,
        timeZone: undefined,
        tags: undefined,
        notes: undefined,
      });
    });
  });

  describe('meraki_networks_delete', () => {
    it('calls networks.delete and returns a confirmation message once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      deleteSpy.mockResolvedValue(undefined);

      const res = await networksHandler.handleCall('meraki_networks_delete', {
        network_id: 'N_1',
        confirm_destructive_action: true,
      });

      expect(deleteSpy).toHaveBeenCalledWith('N_1');
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('N_1');
      expect(res.content[0].text).toContain('deleted');
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await networksHandler.handleCall('meraki_networks_bogus', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
