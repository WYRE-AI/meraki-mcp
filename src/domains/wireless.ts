import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { guardWrite } from '../utils/safety.js';

function getTools(): Tool[] {
  return [
    {
      name: 'meraki_wireless_ssids_list',
      description: 'List the wireless SSIDs configured on a network.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
        },
        required: ['network_id'],
      },
    },
    {
      name: 'meraki_wireless_ssids_update',
      description:
        '⚠ HIGH-IMPACT. Updates a wireless SSID\'s configuration (name, enabled state, auth ' +
        'mode, PSK, VLAN, etc.). Changes are broadcast immediately and can disconnect clients ' +
        'or change network access. Changing the PSK or auth mode drops every client on the ' +
        'SSID and they cannot rejoin with the old credentials. Reversible by reverting the ' +
        'settings. Requires confirm_destructive_action: true. ' +
        'Confirm with the user before invoking.',
      annotations: {
        title: 'Update wireless SSID (high-impact)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          number: { type: 'number', description: 'SSID number (0-14)' },
          settings: {
            type: 'object',
            description: 'SSID settings to apply (e.g. { name, enabled, authMode, psk, ... }).',
          },
          confirm_destructive_action: {
            type: 'boolean',
            description:
              'Must be true to confirm reconfiguring this SSID. Changing the PSK, auth mode ' +
              'or enabled state disconnects every client currently on it.',
          },
        },
        required: ['network_id', 'number', 'settings'],
      },
    },
    {
      name: 'meraki_wireless_rf_profiles_list',
      description: 'List the RF profiles configured on a network.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
        },
        required: ['network_id'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (toolName) {
    case 'meraki_wireless_ssids_list': {
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: wireless.listSsids', { networkId });
      const result = await client.wireless.listSsids(networkId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_wireless_ssids_update': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const networkId = args.network_id as string;
      const number = args.number as number;
      const settings = (args.settings as Record<string, unknown> | undefined) ?? {};
      logger.info('API call: wireless.updateSsid', { networkId, number });
      const result = await client.wireless.updateSsid(networkId, number, settings);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_wireless_rf_profiles_list': {
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: wireless.listRfProfiles', { networkId });
      const result = await client.wireless.listRfProfiles(networkId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const wirelessHandler: DomainHandler = { getTools, handleCall };
