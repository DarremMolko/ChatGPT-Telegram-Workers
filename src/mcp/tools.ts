import type { AgentUserConfig } from '../config/env';
import { getMcp } from '.';

export async function resolveMcpTools(config: AgentUserConfig) {
    const mcpTools = await getMcp();
    const tools = Object.entries(mcpTools)
        .filter(([groupName]) => config.USE_MCP.includes(groupName))
        .reduce((acc: Record<string, any>, [_, groupTools]) => ({ ...acc, ...groupTools }), {});

    return {
        tools,
        activeToolNames: Object.keys(tools),
    };
}
