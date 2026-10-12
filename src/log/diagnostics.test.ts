import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({
    ENV: {
        LOG_TO_FILE: '',
        DEBUG_LOG_MAX_STRING_LENGTH: 128,
    },
}));

const {
    formatDiagnosticFields,
    summarizeModelMessages,
    summarizeTelegramUpdate,
    summarizeUserConfig,
} = await import('./diagnostics');

describe('summarizeTelegramUpdate', () => {
    it('extracts a compact summary for message updates', () => {
        const summary = summarizeTelegramUpdate({
            update_id: 123,
            message: {
                message_id: 99,
                chat: { id: 456, type: 'private' },
                from: { id: 789, is_bot: false, first_name: 'User', username: 'tester' },
                text: '/vision hello world',
            },
        } as any);

        expect(summary).toMatchObject({
            updateId: 123,
            type: 'message',
            chatId: 456,
            userId: 789,
            kind: 'text',
            command: '/vision',
        });
    });
});

describe('summarizeUserConfig', () => {
    it('reports the effective vision model and provider models', () => {
        const summary = summarizeUserConfig({
            AI_CHAT_PROVIDER: 'oailike',
            AI_IMAGE_PROVIDER: 'oailike',
            AI_ASR_PROVIDER: 'oailike',
            AI_TTS_PROVIDER: 'oailike',
            OAILIKE_CHAT_MODEL: 'gpt-5.4',
            OAILIKE_IMAGE_MODEL: 'flux',
            OAILIKE_STT_MODEL: 'whisper',
            OAILIKE_TTS_MODEL: 'tts-1',
            OAILIKE_VISION_MODEL: 'gemini-default',
            VISION_MODEL: 'oailike:gemini-3-flash-preview',
            TOOL_MODEL: '',
            USE_MCP: ['production'],
            USE_OPENAI_BUILDIN: [],
            TEXT_HANDLE_TYPE: 'text',
            TEXT_OUTPUT: 'text',
            AUDIO_HANDLE_TYPE: 'stt',
            AUDIO_OUTPUT: 'text',
            DEFINE_KEYS: ['VISION_MODEL'],
        } as any);

        expect(summary).toMatchObject({
            chatProvider: 'oailike',
            chatModel: 'gpt-5.4',
            visionOverride: 'oailike:gemini-3-flash-preview',
            visionModel: 'oailike:gemini-3-flash-preview',
            imageModel: 'flux',
            defineKeyCount: 1,
        });
    });
});

describe('formatDiagnosticFields', () => {
    it('formats nested values into a log-friendly string', () => {
        const text = formatDiagnosticFields({
            scope: 'history:123',
            roles: { user: 2, assistant: 1 },
            tags: ['a', 'b'],
        });

        expect(text).toContain('scope=history:123');
        expect(text).toContain('roles=');
        expect(text).toContain('tags=');
    });
});

describe('summarizeModelMessages', () => {
    it('reports roles and multimodal messages', () => {
        const summary = summarizeModelMessages([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'image', image: 'x' }] },
        ] as any);

        expect(summary).toMatchObject({
            count: 2,
            roles: { user: 1, assistant: 1 },
            multimodalMessages: 1,
        });
    });
});
