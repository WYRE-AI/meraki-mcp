/**
 * Handler-invocation tests for the switch domain.
 *
 * safety.test.ts already pins the confirmation-gating behavior of
 * meraki_switch_ports_update. These tests cover request shaping and
 * response mapping for every tool.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { listPortsSpy, updatePortSpy, listPortStatusesSpy } = vi.hoisted(() => ({
  listPortsSpy: vi.fn(),
  updatePortSpy: vi.fn(),
  listPortStatusesSpy: vi.fn(),
}));

vi.mock('../../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  getClient: vi.fn(async () => ({
    switch: {
      listPorts: listPortsSpy,
      updatePort: updatePortSpy,
      listPortStatuses: listPortStatusesSpy,
    },
  })),
}));

import { switchHandler } from '../../src/domains/switch.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('switchHandler', () => {
  beforeEach(resetEnv);

  describe('meraki_switch_ports_list', () => {
    it('passes serial to listPorts and returns the raw list', async () => {
      const ports = [{ portId: '1', enabled: true }];
      listPortsSpy.mockResolvedValue(ports);

      const res = await switchHandler.handleCall('meraki_switch_ports_list', {
        serial: 'Q2XX-ABCD-1234',
      });

      expect(listPortsSpy).toHaveBeenCalledWith('Q2XX-ABCD-1234');
      expect(JSON.parse(res.content[0].text)).toEqual(ports);
    });
  });

  describe('meraki_switch_ports_update', () => {
    it('maps serial/port_id/settings to updatePort and returns the result once confirmed', async () => {
      process.env.READ_ONLY_MODE = 'false';
      const updated = { portId: '1', enabled: false };
      updatePortSpy.mockResolvedValue(updated);

      const res = await switchHandler.handleCall('meraki_switch_ports_update', {
        serial: 'Q2XX-ABCD-1234',
        port_id: '1',
        settings: { enabled: false },
        confirm_destructive_action: true,
      });

      expect(updatePortSpy).toHaveBeenCalledWith('Q2XX-ABCD-1234', '1', { enabled: false });
      expect(JSON.parse(res.content[0].text)).toEqual(updated);
    });

    it('defaults settings to {} when omitted rather than passing undefined', async () => {
      process.env.READ_ONLY_MODE = 'false';
      updatePortSpy.mockResolvedValue({});

      await switchHandler.handleCall('meraki_switch_ports_update', {
        serial: 'Q2XX-ABCD-1234',
        port_id: '1',
        confirm_destructive_action: true,
      });

      expect(updatePortSpy).toHaveBeenCalledWith('Q2XX-ABCD-1234', '1', {});
    });
  });

  describe('meraki_switch_port_statuses_list', () => {
    it('maps serial/timespan to listPortStatuses', async () => {
      const statuses = [{ portId: '1', status: 'Connected' }];
      listPortStatusesSpy.mockResolvedValue(statuses);

      const res = await switchHandler.handleCall('meraki_switch_port_statuses_list', {
        serial: 'Q2XX-ABCD-1234',
        timespan: 600,
      });

      expect(listPortStatusesSpy).toHaveBeenCalledWith('Q2XX-ABCD-1234', { timespan: 600 });
      expect(JSON.parse(res.content[0].text)).toEqual(statuses);
    });

    it('passes timespan as undefined when omitted', async () => {
      listPortStatusesSpy.mockResolvedValue([]);

      await switchHandler.handleCall('meraki_switch_port_statuses_list', {
        serial: 'Q2XX-ABCD-1234',
      });

      expect(listPortStatusesSpy).toHaveBeenCalledWith('Q2XX-ABCD-1234', { timespan: undefined });
    });
  });

  describe('unknown tool', () => {
    it('returns an error result rather than throwing', async () => {
      const res = await switchHandler.handleCall('meraki_switch_bogus', {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool');
    });
  });
});
