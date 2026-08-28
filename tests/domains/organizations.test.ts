/**
 * Handler-invocation tests for the organizations domain.
 *
 * The tool surface (names, schemas) is exercised elsewhere (mcp-apps.test.ts
 * walks the full tool list). These tests invoke `handleCall` directly against
 * a mocked Meraki client to verify two things the surface-level tests do not:
 *   1. request shaping — tool args are mapped to the exact SDK call (method,
 *      positional args, and camelCased option keys)
 *   2. response mapping — the raw SDK response is what actually flows back
 *      out as the tool's JSON content
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { listSpy, getSpy, inventorySpy } = vi.hoisted(() => ({
  listSpy: vi.fn(),
  getSpy: vi.fn(),
  inventorySpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    organizations: {
      list: listSpy,
      get: getSpy,
      inventoryDevices: inventorySpy,
    },
  })),
}));

import { organizationsHandler } from '../../src/domains/organizations.js';

describe('organizationsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('meraki_organizations_list', () => {
    it('calls organizations.list with no arguments and returns the raw list', async () => {
      const orgs = [{ id: 'org_1', name: 'Acme Corp' }];
      listSpy.mockResolvedValue(orgs);

      const res = await organizationsHandler.handleCall('meraki_organizations_list', {});

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(listSpy).toHaveBeenCalledWith();
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.content[0].text)).toEqual(orgs);
    });
  });

  describe('meraki_organizations_get', () => {
    it('passes organization_id through to organizations.get', async () => {
      const org = { id: 'org_1', name: 'Acme Corp' };
      getSpy.mockResolvedValue(org);

      const res = await organizationsHandler.handleCall('meraki_organizations_get', {
        organization_id: 'org_1',
      });

      expect(getSpy).toHaveBeenCalledWith('org_1');
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(res.content[0].text)).toEqual(org);
    });
  });

  describe('meraki_organizations_inventory_list', () => {
    it('maps per_page/starting_after to perPage/startingAfter', async () => {
      const inventory = [{ serial: 'Q2XX-1111-AAAA' }, { serial: 'Q2XX-2222-BBBB' }];
      inventorySpy.mockResolvedValue(inventory);

      const res = await organizationsHandler.handleCall('meraki_organizations_inventory_list', {
        organization_id: 'org_1',
        per_page: 50,
        starting_after: 'cursor-1',
      });

      expect(inventorySpy).toHaveBeenCalledWith('org_1', {
        perPage: 50,
        startingAfter: 'cursor-1',
      });
      expect(JSON.parse(res.content[0].text)).toEqual(inventory);
    });

    it('passes undefined pagination options when omitted', async () => {
      inventorySpy.mockResolvedValue([]);

      await organizationsHandler.handleCall('meraki_organizations_inventory_list', {
        organization_id: 'org_1',
      });

      expect(inventorySpy).toHaveBeenCalledWith('org_1', {
        perPage: undefined,
        startingAfter: undefined,
      });
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await organizationsHandler.handleCall('meraki_organizations_bogus', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
