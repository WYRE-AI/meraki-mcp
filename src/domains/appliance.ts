import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { guardWrite } from '../utils/safety.js';
import type { L3FirewallRule } from '@wyre-technology/node-meraki';

function getTools(): Tool[] {
  return [
    {
      name: 'meraki_appliance_firewall_l3_get',
      description: 'Get the layer 3 firewall rules for an MX appliance network.',
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
      name: 'meraki_appliance_firewall_l3_update',
      description:
        '⚠ HIGH-IMPACT. Replaces the layer 3 firewall rule set for an MX appliance network. ' +
        'This changes what traffic is allowed or denied and takes effect immediately; a bad ' +
        'rule set can cut off network access. Reversible by re-applying the previous rules, ' +
        'but the change is applied over the same link it can sever. Requires ' +
        'confirm_destructive_action: true. Confirm with the user before invoking.',
      annotations: {
        title: 'Update L3 firewall rules (high-impact)',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        type: 'object' as const,
        properties: {
          network_id: { type: 'string', description: 'Network ID' },
          rules: {
            type: 'array',
            description: 'The ordered list of L3 firewall rules to apply (replaces the existing set).',
            items: { type: 'object' },
          },
          confirm_destructive_action: {
            type: 'boolean',
            description:
              'Must be true to confirm replacing the entire L3 firewall rule set. Any rule ' +
              'not present in `rules` is deleted.',
          },
        },
        required: ['network_id', 'rules'],
      },
    },
    {
      name: 'meraki_appliance_vpn_status_get',
      description: 'Get the site-to-site VPN configuration for an MX appliance network.',
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
    case 'meraki_appliance_firewall_l3_get': {
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: appliance.getL3FirewallRules', { networkId });
      const result = await client.appliance.getL3FirewallRules(networkId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_appliance_firewall_l3_update': {
      const blocked = guardWrite({ destructive: true }, args);
      if (blocked) return blocked;
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: appliance.updateL3FirewallRules', { networkId });
      const result = await client.appliance.updateL3FirewallRules(networkId, {
        rules: args.rules as L3FirewallRule[],
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'meraki_appliance_vpn_status_get': {
      const client = await getClient();
      const networkId = args.network_id as string;
      logger.info('API call: appliance.getSiteToSiteVpn', { networkId });
      const result = await client.appliance.getSiteToSiteVpn(networkId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

export const applianceHandler: DomainHandler = { getTools, handleCall };
