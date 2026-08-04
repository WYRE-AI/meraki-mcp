import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { guardWrite } from '../utils/safety.js';

function getTools(): Tool[] {
  return [
    {
      name: 'meraki_clients_list',
      description: 'List clients seen on a network within a time window.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          timespan: { type: 'number', description: 'Timespan in seconds to look back (max 2592000)' },
          per_page: { type: 'number', description: 'Results per page' },
        },
        required: ['network_id'],
      },
    },
    {
      name: 'meraki_clients_get',
      description: 'Get a single client on a network by client ID or MAC.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          client_id: { type: 'string', description: 'Client ID or MAC address' },
        },
        required: ['network_id', 'client_id'],
      },
    },
    {
      name: 'meraki_clients_get_policy',
      description: 'Get the network policy assigned to a client.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          client_id: { type: 'string', description: 'Client ID or MAC address' },
        },
        required: ['network_id', 'client_id'],
      },
    },
    {
      name: 'meraki_clients_update_policy',
      description:
        '⚠ HIGH-IMPACT. Updates the network access policy for a client (e.g. Normal, ' +
        'Blocked, Allowed, or a group policy). Takes effect immediately and can revoke or ' +
        'grant network access for the device. Reversible by reassigning the policy, but a ' +
        'blocked client loses the connection it would need to report the problem. Requires ' +
        'confirm_destructive_action: true. Confirm with the user before invoking.',
      annotations: {
        title: 'Update client policy (high-impact)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          client_id: { type: 'string', description: 'Client ID or MAC address' },
          device_policy: {
            type: 'string',
            enum: ['Normal', 'Blocked', 'Allowed', 'Group policy'],
            description: 'The policy to apply to the client',
          },
          group_policy_id: {
            type: 'string',
            description: 'Group policy ID (required when device_policy is "Group policy")',
          },
          confirm_destructive_action: {
            type: 'boolean',
            description:
              'Must be true to confirm changing this client\'s network access. Setting ' +
              '"Blocked" cuts the device off the network immediately.',
          },
        },
        required: ['network_id', 'client_id', 'device_policy'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (toolName) {
    case 'meraki_clients_list': {
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: clients.list', { networkId });
      const result = await client.clients.listByNetwork(networkId, {
        timespan: args.timespan as number | undefined,
        perPage: args.per_page as number | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_clients_get': {
      const client = await getClient();
      const networkId = args.network_id as string;
      const clientId = args.client_id as string;
      logger.info('API call: clients.get', { networkId, clientId });
      const result = await client.clients.get(networkId, clientId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_clients_get_policy': {
      const client = await getClient();
      const networkId = args.network_id as string;
      const clientId = args.client_id as string;
      logger.info('API call: clients.getPolicy', { networkId, clientId });
      const result = await client.clients.getPolicy(networkId, clientId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_clients_update_policy': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const networkId = args.network_id as string;
      const clientId = args.client_id as string;
      logger.info('API call: clients.updatePolicy', { networkId, clientId });
      const result = await client.clients.updatePolicy(networkId, clientId, {
        devicePolicy: args.device_policy as string,
        groupPolicyId: args.group_policy_id as string | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const clientsHandler: DomainHandler = { getTools, handleCall };
