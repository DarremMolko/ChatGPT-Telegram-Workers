import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
    ENV: {
        TELEGRAM_RENDER_PIPE_TABLES: true,
    },
}));

const { EXPANDABLE_QUOTE_MARK, SEGMENTATION_MARK } = await import('./render_shared');
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

    it('keeps placeholder markdown links literal when the URL is invalid', () => {
        expect(markdownToEntities('Sintaxis: [texto](url)')).toEqual({
            text: 'Sintaxis: [texto](url)',
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
        expect(markdownToEntities('> Quoted _text_\n> - item')).toEqual({
            text: 'Quoted text\n• item',
            entities: [
                {
                    type: 'blockquote',
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

    it('allows explicit expandable quotes when requested', () => {
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
    it('keeps showinfo separate from streamed thinking when addQuote is off', () => {
        expect(renderSingleMessage('MarkdownV2', `${EXPANDABLE_QUOTE_MARK}\n> banner\n${SEGMENTATION_MARK}\n${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\`\n> thought\n>✹\n${SEGMENTATION_MARK}\nanswer\n> user quote`, {
            addQuote: false,
            quoteExpandable: false,
        })).toEqual({
            text: 'banner\n\nThinking...\nthought\n✹\n\nanswer\nuser quote',
            entities: [
                {
                    type: 'expandable_blockquote',
                    offset: 0,
                    length: 6,
                },
                {
                    type: 'expandable_blockquote',
                    offset: 8,
                    length: 21,
                },
                {
                    type: 'code',
                    offset: 8,
                    length: 11,
                },
                {
                    type: 'blockquote',
                    offset: 38,
                    length: 10,
                },
            ],
            useEntities: true,
        });
    });

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
                    length: 5,
                },
                {
                    type: 'expandable_blockquote',
                    offset: 7,
                    length: 4,
                },
            ],
            useEntities: true,
        });
    });

    it('keeps pre-quoted thinking text separate from segmented info banners', () => {
        expect(renderSingleMessage('MarkdownV2', `>\`Thought for 1.2 seconds\`\n> step one\n>✹\n${SEGMENTATION_MARK}\nmodel 1.2s`, {
            addQuote: true,
            quoteExpandable: true,
        })).toEqual({
            text: 'Thought for 1.2 seconds\nstep one\n✹\n\nmodel 1.2s',
            entities: [
                {
                    type: 'expandable_blockquote',
                    offset: 0,
                    length: 34,
                },
                {
                    type: 'code',
                    offset: 0,
                    length: 23,
                },
                {
                    type: 'expandable_blockquote',
                    offset: 36,
                    length: 10,
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
