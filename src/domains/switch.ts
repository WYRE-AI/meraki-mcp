import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { guardWrite } from '../utils/safety.js';

function getTools(): Tool[] {
  return [
    {
      name: 'meraki_switch_ports_list',
      description: 'List the ports configured on a switch.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          serial: { type: 'string', description: 'Switch serial number' },
        },
        required: ['serial'],
      },
    },
    {
      name: 'meraki_switch_ports_update',
      description:
        '⚠ HIGH-IMPACT. Updates a switch port\'s configuration (name, enabled state, VLAN, ' +
        'type, PoE, etc.). Changes take effect immediately and can disrupt connectivity for ' +
        'devices on that port — including the uplink carrying this request. Reversible by ' +
        'reverting the settings, if you still have a path to the switch. Requires ' +
        'confirm_destructive_action: true. Confirm with the user before invoking.',
      annotations: {
        title: 'Update switch port (high-impact)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          serial: { type: 'string', description: 'Switch serial number' },
          port_id: { type: 'string', description: 'Port ID (e.g. "1")' },
          settings: {
            type: 'object',
            description: 'Port settings to apply (e.g. { name, enabled, vlan, type, poeEnabled, ... }).',
          },
          confirm_destructive_action: {
            type: 'boolean',
            description:
              'Must be true to confirm reconfiguring this port. Disabling it or moving its ' +
              'VLAN can cut off the devices behind it.',
          },
        },
        required: ['serial', 'port_id', 'settings'],
      },
    },
    {
      name: 'meraki_switch_port_statuses_list',
      description: 'List live status and traffic counters for the ports on a switch.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          serial: { type: 'string', description: 'Switch serial number' },
          timespan: { type: 'number', description: 'Timespan in seconds for counters' },
        },
        required: ['serial'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (toolName) {
    case 'meraki_switch_ports_list': {
      const client = await getClient();
      const serial = args.serial as string;
      logger.info('API call: switch.listPorts', { serial });
      const result = await client.switch.listPorts(serial);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_switch_ports_update': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const serial = args.serial as string;
      const portId = args.port_id as string;
      const settings = (args.settings as Record<string, unknown> | undefined) ?? {};
      logger.info('API call: switch.updatePort', { serial, portId });
      const result = await client.switch.updatePort(serial, portId, settings);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_switch_port_statuses_list': {
      const client = await getClient();
      const serial = args.serial as string;
      logger.info('API call: switch.listPortStatuses', { serial });
      const result = await client.switch.listPortStatuses(serial, {
        timespan: args.timespan as number | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const switchHandler: DomainHandler = { getTools, handleCall };
