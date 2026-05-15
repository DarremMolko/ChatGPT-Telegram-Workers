import { describe, expect, it } from 'vitest';

const {
    parseInlineNodes,
    parseMarkdownDocument,
    renderInlineNodesToPlainText,
    renderMarkdownDocumentToTelegraph,
    renderMarkdownDocumentToTelegram,
} = await import('./markdown_core');

describe('markdown_core barrel', () => {
    it('renders parsed markdown to Telegram entities', () => {
        expect(renderMarkdownDocumentToTelegram(parseMarkdownDocument('Hello **world**'))).toEqual({
            text: 'Hello world',
            entities: [{
                type: 'bold',
                offset: 6,
                length: 5,
            }],
        });
    });

    it('renders inline nodes to plain text', () => {
        expect(renderInlineNodesToPlainText(parseInlineNodes('[OpenAI](https://openai.com)').nodes))
            .toBe('OpenAI (https://openai.com)');
    });

    it('renders blockquotes to Telegraph nodes', () => {
        expect(renderMarkdownDocumentToTelegraph(parseMarkdownDocument('> quoted'))).toEqual([{
            tag: 'blockquote',
            children: [{
                tag: 'p',
                children: ['quoted'],
            }],
        }]);
    });
});
