import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { guardWrite } from '../utils/safety.js';

function getTools(): Tool[] {
  return [
    {
      name: 'meraki_networks_list',
      description: 'List the networks belonging to an organization.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object' as const,
        properties: {
          organization_id: { type: 'string', description: 'Organization ID' },
          per_page: { type: 'number', description: 'Results per page' },
          starting_after: { type: 'string', description: 'Pagination cursor' },
        },
        required: ['organization_id'],
      },
    },
    {
      name: 'meraki_networks_get',
      description: 'Get a single network by ID.',
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
      name: 'meraki_networks_update',
      description:
        '⚠ HIGH-IMPACT. Updates a network\'s configuration (name, time zone, tags, notes). ' +
        'Changes take effect immediately across the network and are visible to operators. ' +
        'Reversible by reverting the fields, but `tags` REPLACES the existing list rather ' +
        'than merging, so omitted tags are dropped. Requires confirm_destructive_action: ' +
        'true. Confirm with the user before invoking.',
      annotations: {
        title: 'Update network (high-impact)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          name: { type: 'string', description: 'New network name' },
          timeZone: { type: 'string', description: 'New IANA time zone (e.g. "America/Chicago")' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list' },
          notes: { type: 'string', description: 'Network notes' },
          confirm_destructive_action: {
            type: 'boolean',
            description:
              'Must be true to confirm updating this network. Any tag not present in ' +
              '`tags` is dropped.',
          },
        },
        required: ['network_id'],
      },
    },
    {
      name: 'meraki_networks_delete',
      description:
        '⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently deletes a network and all of its ' +
        'configuration. This action cannot be undone. ' +
        'Confirm with the user before invoking.',
      annotations: {
        title: 'Delete network (irreversible)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          confirm_destructive_action: {
            type: 'boolean',
            description: 'Must be true to confirm this irreversible deletion.',
          },
        },
        required: ['network_id'],
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (toolName) {
    case 'meraki_networks_list': {
      const client = await getClient();
      const organizationId = args.organization_id as string;
      logger.info('API call: networks.listByOrg', { organizationId });
      const result = await client.networks.listByOrg(organizationId, {
        perPage: args.per_page as number | undefined,
        startingAfter: args.starting_after as string | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_networks_get': {
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: networks.get', { networkId });
      const network = await client.networks.get(networkId);
      return { content: [{ type: 'text', text: JSON.stringify(network, null, 2) }] };
    }
    case 'meraki_networks_update': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: networks.update', { networkId });
      const network = await client.networks.update(networkId, {
        name: args.name as string | undefined,
        timeZone: args.timeZone as string | undefined,
        tags: args.tags as string[] | undefined,
        notes: args.notes as string | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(network, null, 2) }] };
    }
    case 'meraki_networks_delete': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: networks.delete', { networkId });
      await client.networks.delete(networkId);
      return { content: [{ type: 'text', text: `Network ${networkId} deleted.` }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const networksHandler: DomainHandler = { getTools, handleCall };
