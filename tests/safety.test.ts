import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DomainHandler } from '../src/utils/types.js';

// Spies for the mocked Meraki client. Declared via vi.hoisted so they are
// available inside the hoisted vi.mock factory below.
const {
  updateSpy,
  deleteSpy,
  requestSpy,
  l3UpdateSpy,
  portUpdateSpy,
  ssidUpdateSpy,
  rebootSpy,
} = vi.hoisted(() => ({
  updateSpy: vi.fn(),
  deleteSpy: vi.fn(),
  requestSpy: vi.fn(),
  l3UpdateSpy: vi.fn(),
  portUpdateSpy: vi.fn(),
  ssidUpdateSpy: vi.fn(),
  rebootSpy: vi.fn(),
}));

vi.mock('../src/utils/client.js', () => ({
  getCredentials: () => ({ apiKey: 'test-key' }),
  clearClient: () => {},
  getClient: vi.fn(async () => ({
    networks: { update: updateSpy, delete: deleteSpy },
    appliance: { updateL3FirewallRules: l3UpdateSpy },
    switch: { updatePort: portUpdateSpy },
    wireless: { updateSsid: ssidUpdateSpy },
    devices: { reboot: rebootSpy },
    request: requestSpy,
  })),
}));

import { networksHandler } from '../src/domains/networks.js';
import { passthroughHandler } from '../src/domains/passthrough.js';
import { applianceHandler } from '../src/domains/appliance.js';
import { switchHandler } from '../src/domains/switch.js';
import { wirelessHandler } from '../src/domains/wireless.js';
import { devicesHandler } from '../src/domains/devices.js';
import { getClient } from '../src/utils/client.js';

function resetEnv(): void {
  vi.clearAllMocks();
  delete process.env.READ_ONLY_MODE;
  delete process.env.READ_ONLY;
}

describe('safety gating', () => {
  beforeEach(resetEnv);

  it('blocks a write tool in read-only mode (default)', async () => {
    // No READ_ONLY_MODE set → read-only is ON by default.
    const res = await networksHandler.handleCall('meraki_networks_update', {
      network_id: 'N_1',
      name: 'renamed',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('read_only_mode');
    expect(res.content[0].text).toContain('READ_ONLY_MODE=false');
    // Guard should short-circuit before ever reaching the SDK.
    expect(getClient).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('requires confirm_destructive_action for a destructive tool', async () => {
    process.env.READ_ONLY_MODE = 'false';

    const res = await networksHandler.handleCall('meraki_networks_delete', {
      network_id: 'N_1',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('confirmation_required');
    expect(res.content[0].text).toContain('confirm_destructive_action');
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('proceeds when confirmed and never forwards confirm_destructive_action', async () => {
    process.env.READ_ONLY_MODE = 'false';
    requestSpy.mockResolvedValue({ deleted: true });

    const res = await passthroughHandler.handleCall('meraki_raw_request', {
      method: 'DELETE',
      path: '/networks/N_1',
      body: { keepConfig: false },
      confirm_destructive_action: true,
    });

    expect(res.isError).toBeFalsy();
    expect(requestSpy).toHaveBeenCalledTimes(1);

    const [method, path, options] = requestSpy.mock.calls[0];
    expect(method).toBe('DELETE');
    expect(path).toBe('/networks/N_1');
    expect(options.body).toEqual({ keepConfig: false });

    // The confirmation flag must never be handed to the SDK.
    expect(JSON.stringify(requestSpy.mock.calls[0])).not.toContain('confirm_destructive_action');
  });
});

/**
 * High-blast-radius tools.
 *
 * Each of these is applied over the very link it can break — a bad L3 rule set,
 * a disabled switch port, a re-keyed SSID or a reboot can sever the operator's
 * own path back to the device, leaving them unable to undo it. All four already
 * advertise `destructiveHint: true`; these tests pin the runtime guard to that
 * annotation so it cannot silently drift back to an unconfirmed write.
 */
const HIGH_BLAST_RADIUS: Array<{
  tool: string;
  handler: DomainHandler;
  spy: ReturnType<typeof vi.fn>;
  args: Record<string, unknown>;
}> = [
  {
    tool: 'meraki_appliance_firewall_l3_update',
    handler: applianceHandler,
    spy: l3UpdateSpy,
    // Replaces the whole rule set — omitted rules are deleted.
    args: { network_id: 'N_1', rules: [{ policy: 'allow', protocol: 'any' }] },
  },
  {
    tool: 'meraki_switch_ports_update',
    handler: switchHandler,
    spy: portUpdateSpy,
    args: { serial: 'Q2XX-ABCD-1234', port_id: '1', settings: { enabled: false } },
  },
  {
    tool: 'meraki_wireless_ssids_update',
    handler: wirelessHandler,
    spy: ssidUpdateSpy,
    // Re-keying drops every client; they cannot rejoin with the old PSK.
    args: { network_id: 'N_1', number: 0, settings: { psk: 'rotated-secret' } },
  },
  {
    tool: 'meraki_devices_reboot',
    handler: devicesHandler,
    spy: rebootSpy,
    args: { serial: 'Q2XX-ABCD-1234' },
  },
];

describe.each(HIGH_BLAST_RADIUS)(
  '$tool destructive confirmation',
  ({ tool, handler, spy, args }) => {
    beforeEach(resetEnv);

    it('declares confirm_destructive_action in its input schema', () => {
      // Without this parameter the guard below is unsatisfiable: callers would
      // be permanently blocked rather than merely asked to confirm.
      const def = handler.getTools().find((t) => t.name === tool);
      expect(def).toBeDefined();

      const props = def!.inputSchema.properties as
        | Record<string, { type?: string }>
        | undefined;
      expect(props?.confirm_destructive_action).toBeDefined();
      expect(props?.confirm_destructive_action?.type).toBe('boolean');

      // It must stay optional. Marking it required would make schema-validating
      // clients reject the first, unconfirmed call instead of surfacing the
      // guard's "re-invoke with confirmation" message.
      expect(def!.inputSchema.required ?? []).not.toContain('confirm_destructive_action');
    });

    it('is blocked without confirm_destructive_action', async () => {
      process.env.READ_ONLY_MODE = 'false';

      const res = await handler.handleCall(tool, { ...args });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('confirmation_required');
      expect(res.content[0].text).toContain('confirm_destructive_action');
      expect(spy).not.toHaveBeenCalled();
    });

    it('proceeds with confirm_destructive_action and never forwards the flag', async () => {
      process.env.READ_ONLY_MODE = 'false';
      spy.mockResolvedValue({ ok: true });

      const res = await handler.handleCall(tool, {
        ...args,
        confirm_destructive_action: true,
      });

      expect(res.isError).toBeFalsy();
      expect(spy).toHaveBeenCalledTimes(1);
      // The confirmation flag must never be handed to the SDK.
      expect(JSON.stringify(spy.mock.calls[0])).not.toContain('confirm_destructive_action');
    });

    it('stays blocked by read-only mode even when confirmed', async () => {
      // Confirmation is not an escape hatch from READ_ONLY_MODE.
      const res = await handler.handleCall(tool, {
        ...args,
        confirm_destructive_action: true,
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('read_only_mode');
      expect(spy).not.toHaveBeenCalled();
    });
  }
);
