import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { passthroughHandler } from './domains/passthrough.js';
import { registerResourceHandlers } from './resources.js';
import { getCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';

export function createServer(): Server {
  const server = new Server(
    { name: 'meraki-mcp', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
        logging: {},
      },
    }
  );

  // MCP Apps (SEP-1865): serve the ui:// device-card resource.
  registerResourceHandlers(server);

  // Return ALL tools upfront — navigation is a stateless help/discovery tool.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = [...getNavigationTools()];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      allTools.push(...handler.getTools());
    }
    allTools.push(...passthroughHandler.getTools());
    return { tools: allTools };
  });

  // Route tool calls.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Navigation: navigate (stateless discovery aid)
    if (name === 'meraki_navigate') {
      const domain = (args?.domain as string) as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid domain: ${domain}. Valid: ${DOMAINS.join(', ')}` }],
          isError: true,
        };
      }

      const handler = await getDomainHandler(domain);
      const tools = handler.getTools().map(t => `${t.name}: ${t.description}`);

      return {
        content: [{
          type: 'text' as const,
          text: `Domain: ${domain}\n\nAvailable tools:\n${tools.join('\n')}`,
        }],
      };
    }

    // Navigation: status
    if (name === 'meraki_status') {
      const creds = getCredentials();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            connected: !!creds,
            orgId: creds?.orgId ?? null,
            domains: DOMAINS,
            status: 'No domain selected. Call conduit__my_access to see which tools you can use under the gateway, or meraki_navigate to browse tools by domain when running standalone.',
          }, null, 2),
        }],
      };
    }

    // Long-tail escape hatch
    if (passthroughHandler.getTools().some(t => t.name === name)) {
      try {
        return await passthroughHandler.handleCall(name, (args || {}) as Record<string, unknown>, extra);
      } catch (error) {
        logger.error('Tool call failed', { tool: name, error: (error as Error).message });
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    }

    // Domain tool calls — try every domain handler
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      const toolNames = handler.getTools().map(t => t.name);
      if (toolNames.includes(name)) {
        try {
          return await handler.handleCall(name, (args || {}) as Record<string, unknown>, extra);
        } catch (error) {
          logger.error('Tool call failed', { tool: name, error: (error as Error).message });
          return {
            content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
            isError: true,
          };
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Call conduit__my_access to see which tools you can use under the gateway, or meraki_navigate to browse available tools when running standalone.` }],
      isError: true,
    };
  });

  return server;
}
