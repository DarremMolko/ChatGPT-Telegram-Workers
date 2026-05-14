import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
    ENV: {
        TELEGRAM_RENDER_PIPE_TABLES: true,
    },
}));

const { markdownV2ToEntities } = await import('./rich_text');

describe('markdownV2ToEntities', () => {
    it('converts inline formatting and text links into entities', () => {
        expect(markdownV2ToEntities('Hello, *world*\\. Visit [OpenAI](https://openai\\.com)\\.')).toEqual({
            text: 'Hello, world. Visit OpenAI.',
            entities: [
                {
                    type: 'bold',
                    offset: 7,
                    length: 5,
                },
                {
                    type: 'text_link',
                    offset: 20,
                    length: 6,
                    url: 'https://openai.com',
                },
            ],
        });
    });

    it('converts fenced code blocks into pre entities', () => {
        expect(markdownV2ToEntities('```ts\nconst a = \\`x\\`;\n```')).toEqual({
            text: 'const a = `x`;',
            entities: [
                {
                    type: 'pre',
                    offset: 0,
                    length: 14,
                    language: 'ts',
                },
            ],
        });
    });

    it('converts expandable quotes into blockquote entities', () => {
        expect(markdownV2ToEntities('**>Quoted _text_||')).toEqual({
            text: 'Quoted text',
            entities: [
                {
                    type: 'expandable_blockquote',
                    offset: 0,
                    length: 11,
                },
                {
                    type: 'italic',
                    offset: 7,
                    length: 4,
                },
            ],
        });
    });
});
