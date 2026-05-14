import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
    ENV: {
        TELEGRAM_RENDER_PIPE_TABLES: true,
    },
}));

const { SEGMENTATION_MARK } = await import('./render_shared');
const { markdownToEntities, renderMessageChunks, renderSingleMessage } = await import('./rich_text');

describe('markdownToEntities', () => {
    it('converts inline formatting and links into entities from raw markdown', () => {
        expect(markdownToEntities('Hello, **world**. Visit [OpenAI](https://openai.com).')).toEqual({
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

    it('keeps snake_case text literal', () => {
        expect(markdownToEntities('foo_bar_baz and some_text_with__double__underscores')).toEqual({
            text: 'foo_bar_baz and some_text_with__double__underscores',
        });
    });

    it('renders headings and bullet lists without markdownv2 normalization', () => {
        expect(markdownToEntities('## Title\n- item')).toEqual({
            text: '## Title\n• item',
            entities: [
                {
                    type: 'bold',
                    offset: 3,
                    length: 5,
                },
            ],
        });
    });

    it('converts fenced code blocks into pre entities', () => {
        expect(markdownToEntities('```ts\nconst a = `x`;\n```')).toEqual({
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

    it('converts quoted markdown blocks into blockquote entities', () => {
        expect(markdownToEntities('> Quoted _text_\n> - item', { quoteEntireMessage: false, quoteExpandable: true })).toEqual({
            text: 'Quoted text\n• item',
            entities: [
                {
                    type: 'expandable_blockquote',
                    offset: 0,
                    length: 18,
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

describe('renderSingleMessage', () => {
    it('applies addQuote using entities instead of quote-prefixed markdown', () => {
        expect(renderSingleMessage('MarkdownV2', `alpha\n${SEGMENTATION_MARK}\nbeta`, {
            addQuote: true,
            quoteExpandable: true,
        })).toEqual({
            text: 'alpha\n\nbeta',
            entities: [
                {
                    type: 'expandable_blockquote',
                    offset: 0,
                    length: 11,
                },
            ],
            useEntities: true,
        });
    });
});

describe('renderMessageChunks', () => {
    it('splits long formatted spans while preserving entities', () => {
        const chunks = renderMessageChunks('MarkdownV2', `**${'a'.repeat(4500)}**`);
        expect(chunks).toHaveLength(2);
        expect(chunks[0].text.length).toBeLessThanOrEqual(4000);
        expect(chunks[1].text.length).toBeLessThanOrEqual(4000);
        expect(chunks[0].entities).toEqual([{
            type: 'bold',
            offset: 0,
            length: chunks[0].text.length,
        }]);
        expect(chunks[1].entities).toEqual([{
            type: 'bold',
            offset: 0,
            length: chunks[1].text.length,
        }]);
    });
});
