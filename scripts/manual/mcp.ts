import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as MCPStdioTransport } from '@ai-sdk/mcp/mcp-stdio';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { stepCountIs, streamText } from 'ai';

let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;

// Manual smoke script for exercising MCP integration against live services.
async function main() {
    try {
        const transport = new MCPStdioTransport({
            command: 'npx',
            args: ['-y', '@amap/amap-maps-mcp-server'],
            env: {
                AMAP_MAPS_API_KEY: process.env.AMAP_MAPS_API_KEY!,
            },
        });
        mcpClient = await createMCPClient({
            name: 'amap',
            transport,
        });

        const { textStream } = streamText({
            model: createOpenAICompatible({
                baseURL: process.env.BASE_URL!,
                apiKey: process.env.API_KEY!,
                name: 'oailike',
            }).languageModel('gemini-2.5-pro'),
            stopWhen: stepCountIs(10),
            tools: await mcpClient.tools() as any,
            prompt: 'Find the fastest driving route from Shanghai Hongqiao Railway Station to the Oriental Pearl. I do not know the coordinates. Use the available tools and tell me the fastest route.',
        });

        for await (const textPart of textStream) {
            process.stdout.write(textPart);
        }
    } catch (error) {
        console.error(error);
    } finally {
        await mcpClient?.close();
    }
}

void main();
