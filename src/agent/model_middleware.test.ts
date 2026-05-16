import { describe, expect, it } from 'vitest';
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
});
