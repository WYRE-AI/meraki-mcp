import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { guardWrite } from '../utils/safety.js';
import { buildDeviceCard, DEVICE_CARD_META } from '../card.builder.js';

function getTools(): Tool[] {
  return [
    {
      name: 'meraki_devices_list',
      description: 'List the devices in a network.',
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
      name: 'meraki_devices_get',
      description: 'Get a single device by serial number.',
      _meta: DEVICE_CARD_META,
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          serial: { type: 'string', description: 'Device serial number' },
        },
        required: ['serial'],
      },
    },
    {
      name: 'meraki_devices_reboot',
      description:
        '⚠ HIGH-IMPACT. Reboots a Meraki device, causing a temporary loss of connectivity ' +
        'for clients served by it — including, if this is the gateway, the link carrying ' +
        'this request. Service resumes automatically after the reboot. Requires ' +
        'confirm_destructive_action: true. Confirm with the user before invoking.',
      annotations: {
        title: 'Reboot device (high-impact)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          serial: { type: 'string', description: 'Device serial number' },
          confirm_destructive_action: {
            type: 'boolean',
            description:
              'Must be true to confirm rebooting the device. Clients served by it lose ' +
              'connectivity until it comes back up.',
          },
        },
        required: ['serial'],
      },
    },
    {
      name: 'meraki_devices_remove',
      description:
        '⚠ DESTRUCTIVE — IRREVERSIBLE. Removes a device from its network, unclaiming its ' +
        'configuration and returning it to organization inventory. This action cannot be undone. ' +
        'Confirm with the user before invoking.',
      annotations: {
        title: 'Remove device from network (irreversible)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID the device belongs to' },
          serial: { type: 'string', description: 'Device serial number' },
          confirm_destructive_action: {
            type: 'boolean',
            description: 'Must be true to confirm removing the device from its network.',
          },
        },
        required: ['network_id', 'serial'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (toolName) {
    case 'meraki_devices_list': {
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: devices.listByNetwork', { networkId });
      const result = await client.devices.listByNetwork(networkId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_devices_get': {
      const client = await getClient();
      const serial = args.serial as string;
      logger.info('API call: devices.get', { serial });
      const device = await client.devices.get(serial);
      const payload: Record<string, unknown> = { ...device };

      // MCP Apps: attach the normalized card payload the ui:// device card
      // renders from. Best-effort — a null card just means no UI surface.
      const card = await buildDeviceCard(payload, client).catch(() => null);
      if (card) payload._card = card;

      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    }
    case 'meraki_devices_reboot': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const serial = args.serial as string;
      logger.info('API call: devices.reboot', { serial });
      const result = await client.devices.reboot(serial);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_devices_remove': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const networkId = args.network_id as string;
      const serial = args.serial as string;
      logger.info('API call: devices.removeFromNetwork', { networkId, serial });
      await client.devices.removeFromNetwork(networkId, serial);
      return { content: [{ type: 'text', text: `Device ${serial} removed from network ${networkId}.` }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const devicesHandler: DomainHandler = { getTools, handleCall };
