import { describe, expect, it } from 'vitest';
import { messageUsesVisionModel, resolveOpenAIChatModel, resolveOpenAILikeChatModel } from './model_selector';

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

    it('prefers the generic vision override when present', () => {
        const model = resolveOpenAIChatModel({
            OPENAI_CHAT_MODEL: 'gpt-chat',
            OPENAI_VISION_MODEL: 'gpt-vision',
            VISION_MODEL: 'oailike:gemini-3-flash-preview',
        } as any, {
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: 'Describe this image.',
                },
                {
                    type: 'image',
                    image: new URL('https://example.com/a.png'),
                },
            ],
        } as any);

        expect(model).toBe('oailike:gemini-3-flash-preview');
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

describe('resolveOpenAILikeChatModel', () => {
    it('uses the generic vision override for oailike chat agents too', () => {
        const model = resolveOpenAILikeChatModel({
            OAILIKE_CHAT_MODEL: 'gpt-5.4',
            OAILIKE_VISION_MODEL: 'gemini-local-default',
            VISION_MODEL: 'oailike:gemini-3-flash-preview',
        } as any, {
            role: 'user',
            content: [
                {
                    type: 'text',
                    text: 'Describe this image.',
                },
                {
                    type: 'image',
                    image: new URL('https://example.com/a.png'),
                },
            ],
        } as any);

        expect(model).toBe('oailike:gemini-3-flash-preview');
    });
});
