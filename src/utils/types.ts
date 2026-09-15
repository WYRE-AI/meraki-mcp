import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type DomainName =
  | 'organizations'
  | 'networks'
  | 'devices'
  | 'clients'
  | 'wireless'
  | 'switch'
  | 'appliance';

export type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export interface DomainHandler {
  getTools(): Tool[];
  handleCall(
    toolName: string,
    args: Record<string, unknown>,
    extra?: unknown
  ): Promise<CallToolResult>;
}
