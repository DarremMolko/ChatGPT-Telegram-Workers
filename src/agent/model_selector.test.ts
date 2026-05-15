import { describe, expect, it } from 'vitest';
import { messageUsesVisionModel, resolveOpenAIChatModel } from './model_selector';

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

    it('uses the vision model when image content is followed by text', () => {
        const model = resolveOpenAIChatModel({
            OPENAI_CHAT_MODEL: 'gpt-chat',
            OPENAI_VISION_MODEL: 'gpt-vision',
        } as any, {
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: 'Compare these images.',
                },
                {
                    type: 'image',
                    image: new URL('https://example.com/a.png'),
                },
                {
                    type: 'text',
                    text: 'Focus on the differences.',
                },
            ],
        } as any);

        expect(model).toBe('gpt-vision');
    });
});

describe('messageUsesVisionModel', () => {
    it('detects multimodal messages even when text is the last part', () => {
        const usesVisionModel = messageUsesVisionModel({
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: 'Compare these images.',
                },
                {
                    type: 'image',
                    image: new URL('https://example.com/a.png'),
                },
                {
                    type: 'text',
                    text: 'Focus on the differences.',
                },
            ],
        } as any);

        expect(usesVisionModel).toBe(true);
    });
});
