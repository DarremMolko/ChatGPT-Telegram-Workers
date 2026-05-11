import { describe, expect, it } from 'vitest';
import { resolveOpenAIChatModel } from './model_selector';

describe('resolveOpenAIChatModel', () => {
    it('uses the vision model for PDF file inputs', () => {
        const model = resolveOpenAIChatModel({
            OPENAI_CHAT_MODEL: 'gpt-chat',
            OPENAI_VISION_MODEL: 'gpt-vision',
        } as any, {
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: 'Summarize this PDF',
                },
                {
                    type: 'file',
                    data: new Uint8Array([1, 2, 3]),
                    mediaType: 'application/pdf',
                    filename: 'paper.pdf',
                },
            ],
        } as any);

        expect(model).toBe('gpt-vision');
    });
});
