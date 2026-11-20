import {
  type CallToolResult,
  type ServerContext,
  type Tool,
  Server,
} from '@modelcontextprotocol/server';
import { TOOL_SCHEMAS } from '@ethanwilkins/chrome-mcp-shared-2026';
import { filterToolsByPermission, getToolPermissionPolicy } from './permission-policy.js';
import { createToolProgressReporter, getToolDeadlineAt, handleToolCall } from './register-tools.js';

/** Register the same Chrome tools for the 2026-07-28 per-request server. */
export const setupModernTools = (server: Server): void => {
  server.setRequestHandler('tools/list', async () => {
    const policy = getToolPermissionPolicy();
    return {
      tools: filterToolsByPermission(TOOL_SCHEMAS as Tool[], policy),
    };
  });

  server.setRequestHandler('tools/call', async (request, ctx: ServerContext) => {
    return (await handleToolCall(
      request.params.name,
      request.params.arguments || {},
      ctx.mcpReq.signal,
      createToolProgressReporter(ctx.mcpReq._meta?.progressToken, (notification) =>
        ctx.mcpReq.notify(notification),
      ),
      getToolDeadlineAt(ctx.mcpReq._meta),
    )) as unknown as CallToolResult;
  });
};
