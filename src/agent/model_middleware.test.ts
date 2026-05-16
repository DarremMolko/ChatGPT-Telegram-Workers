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
});
