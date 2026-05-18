import { describe, expect, it, vi } from 'vitest';
import { AIMiddleware } from './model_middleware';

describe('aIMiddleware', () => {
    it('keeps the resolved model when tools are active but TOOL_MODEL is empty', async () => {
        const visionModel = {
            provider: 'oailike',
            modelId: 'gemini-3-flash-preview',
        } as any;
        const middleware = await AIMiddleware({
            config: {
                TOOL_MODEL: '',
                ENABLE_ALIAS: false,
                MAPPING_VALUE: '',
            } as any,
            activeTools: ['search_tools'],
            onStream: null,
            toolChoice: [],
            messageInfo: {
                content: '',
            },
        });

        const result = await middleware.prepareStepPre({})({
            model: visionModel,
            stepNumber: 0,
            steps: [],
        });

        expect(result.model).toBe(visionModel);
        expect(result.model.modelId).toBe('gemini-3-flash-preview');
    });

    it('keeps the chat model when TOOL_MODEL_MODE is specialist', async () => {
        const chatModel = {
            provider: 'openai.responses',
            modelId: 'gpt-4.1',
        } as any;
        const middleware = await AIMiddleware({
            config: {
                TOOL_MODEL: 'oailike:deepseek-chat',
                TOOL_MODEL_MODE: 'specialist',
                ENABLE_ALIAS: false,
                MAPPING_VALUE: '',
            } as any,
            activeTools: ['search_tools'],
            onStream: null,
            toolChoice: [],
            messageInfo: {
                content: '',
            },
        });

        const result = await middleware.prepareStepPre({})({
            model: chatModel,
            stepNumber: 0,
            steps: [],
        });

        expect(result.model).toBe(chatModel);
        expect(result.model.modelId).toBe('gpt-4.1');
    });

    it('emits a clean tool-call status without replaying streamed narration when hiding is enabled', async () => {
        const onStream = {
            send: vi.fn(),
        };
        const messageInfo: any = {
            content: 'Déjame buscar eso para ti.\n\nVoy a revisar dos herramientas.',
            hideToolCallNarration: true,
        };
        const middleware = await AIMiddleware({
            config: {
                TOOL_MODEL: '',
                ENABLE_ALIAS: false,
                MAPPING_VALUE: '',
            } as any,
            activeTools: ['search_tools'],
            onStream: onStream as any,
            toolChoice: [],
            messageInfo: messageInfo as any,
        });

        await middleware.prepareStepPre({})({
            model: {
                provider: 'oailike',
                modelId: 'deepseek-chat',
            } as any,
            stepNumber: 0,
            steps: [],
        });
        middleware.onChunk({
            chunk: {
                type: 'tool-call',
                toolName: 'search_tools',
                toolCallId: 'call_1',
                input: {},
            },
        });

        expect(onStream.send).toHaveBeenCalledWith('Déjame buscar eso para ti.\n\ntool call start: `search_tools`');
        expect(messageInfo.content).toBe('');
        expect(messageInfo.preservedPreamble).toBe('Déjame buscar eso para ti.');
        expect(messageInfo.suppressProgressUpdates).toBe(true);
    });

    it('preserves a quoted reasoning preamble instead of dropping it as a bare placeholder', async () => {
        const onStream = {
            send: vi.fn(),
        };
        const messageInfo: any = {
            content: '//EXPANDABLEQUOTEMARK//\n>`Thinking...`\n>"The user wants the weather forecast."\n',
            hideToolCallNarration: true,
        };
        const middleware = await AIMiddleware({
            config: {
                TOOL_MODEL: '',
                ENABLE_ALIAS: false,
                MAPPING_VALUE: '',
            } as any,
            activeTools: ['search_tools'],
            onStream: onStream as any,
            toolChoice: [],
            messageInfo: messageInfo as any,
        });

        await middleware.prepareStepPre({})({
            model: {
                provider: 'oailike',
                modelId: 'deepseek-chat',
            } as any,
            stepNumber: 0,
            steps: [],
        });
        middleware.onChunk({
            chunk: {
                type: 'tool-call',
                toolName: 'search_tools',
                toolCallId: 'call_1',
                input: {},
            },
        });

        expect(onStream.send).toHaveBeenCalledWith('//EXPANDABLEQUOTEMARK//\n>`Thinking...`\n>"The user wants the weather forecast."\n\ntool call start: `search_tools`');
        expect(messageInfo.preservedPreamble).toBe('//EXPANDABLEQUOTEMARK//\n>`Thinking...`\n>"The user wants the weather forecast."');
    });

    it('upgrades an early partial preserved preamble with the fuller tool-call-time content', async () => {
        const onStream = {
            send: vi.fn(),
        };
        const messageInfo: any = {
            content: '//EXPANDABLEQUOTEMARK//\n>`Thinking...`\n>The user wants to know the weather forecast for today in Paraná, Argentina.',
            hideToolCallNarration: true,
            preservedPreamble: '//EXPANDABLEQUOTEMARK//\n>`Thinking...`\n>The user wants to know the weather forecast for today in Paraná,',
        };
        const middleware = await AIMiddleware({
            config: {
                TOOL_MODEL: '',
                ENABLE_ALIAS: false,
                MAPPING_VALUE: '',
            } as any,
            activeTools: ['search_tools'],
            onStream: onStream as any,
            toolChoice: [],
            messageInfo: messageInfo as any,
        });

        await middleware.prepareStepPre({})({
            model: {
                provider: 'oailike',
                modelId: 'deepseek-chat',
            } as any,
            stepNumber: 0,
            steps: [],
        });
        middleware.onChunk({
            chunk: {
                type: 'tool-call',
                toolName: 'search_tools',
                toolCallId: 'call_1',
                input: {},
            },
        });

        expect(onStream.send).toHaveBeenCalledWith('//EXPANDABLEQUOTEMARK//\n>`Thinking...`\n>The user wants to know the weather forecast for today in Paraná, Argentina.\n\ntool call start: `search_tools`');
        expect(messageInfo.preservedPreamble).toBe('//EXPANDABLEQUOTEMARK//\n>`Thinking...`\n>The user wants to know the weather forecast for today in Paraná, Argentina.');
    });

    it('resets authoritative text when a later tool step happens before the final answer', async () => {
        const messageInfo: any = {
            authoritativeText: '',
            content: '',
        };
        const middleware = await AIMiddleware({
            config: {
                TOOL_MODEL: '',
                ENABLE_ALIAS: false,
                MAPPING_VALUE: '',
            } as any,
            activeTools: ['search_tools'],
            onStream: null,
            toolChoice: [],
            messageInfo,
        });

        await middleware.prepareStepPre({})({
            model: {
                provider: 'oailike',
                modelId: 'deepseek-chat',
            } as any,
            stepNumber: 0,
            steps: [],
        });

        await middleware.onStepFinish({
            request: {},
            response: {},
            text: 'Let me describe both tools first.',
            toolResults: [],
            usage: {},
        });
        expect(messageInfo.authoritativeText).toBe('Let me describe both tools first.');

        await middleware.onStepFinish({
            request: {},
            response: {},
            text: 'Actually, let me call both simultaneously.',
            toolResults: [{ toolName: 'search_tools', toolCallId: 'call_1', input: {}, output: {} }],
            usage: {},
        });
        expect(messageInfo.authoritativeText).toBe('');

        await middleware.onStepFinish({
            request: {},
            response: {},
            text: 'Final weather summary.',
            toolResults: [],
            usage: {},
        });
        expect(messageInfo.authoritativeText).toBe('Final weather summary.');
    });
});
