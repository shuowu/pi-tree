import { Type } from "typebox";
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";

/**
 * Sanitize a tool name for Pi SDK registration.
 * Replaces non-alphanumeric chars (except underscores) with underscores.
 */
function sanitizeToolName(serverName: string, toolName: string): string {
  return `mcp_${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

export default definePiTreeExtension((pi, services) => {
  const { mcpBridge } = services;
  if (!mcpBridge) return;

  const tools = mcpBridge.getTools();
  if (!tools.length) return;

  const servers = new Set<string>();

  for (const tool of tools) {
    servers.add(tool.serverName);
    const safeName = sanitizeToolName(tool.serverName, tool.name);

    pi.registerTool({
      name: safeName,
      label: `[${tool.serverName}] ${tool.name}`,
      description: `[MCP: ${tool.serverName}] ${tool.description || tool.name}`,
      parameters: Type.Unsafe(tool.inputSchema as never),
      async execute(_toolCallId, params) {
        try {
          const mcpContent = await mcpBridge.callTool(
            tool.serverName,
            tool.name,
            params as Record<string, unknown>,
          );
          // Coerce MCP content to Pi SDK TextContent
          const content = mcpContent.map((c) => ({
            type: c.type as "text",
            text: c.text ?? JSON.stringify(c),
          }));
          return { content, details: undefined };
        } catch (err: any) {
          throw new Error(
            `[mcp] ${tool.serverName}/${tool.name} failed: ${err.message}`,
          );
        }
      },
    });
  }

  console.log(
    `[mcp] Registered ${tools.length} tools from ${servers.size} servers`,
  );
});
