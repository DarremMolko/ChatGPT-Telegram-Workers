import type { TextStreamPart } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
const debug = vi.fn();

vi.mock('../config/env', () => ({
    ENV: {
        SHOW_THINKING_TEXT: true,
        EXPANDABLE_THINKING: true,
        ENABLE_SEARCH_SOURCE: true,
    },
}));

vi.mock('../log', () => ({
    log: {
        info,
        debug,
    },
}));

const { ENV } = await import('../config/env');
const { EXPANDABLE_QUOTE_MARK, SEGMENTATION_MARK } = await import('../telegram/utils/render_shared');
const { appendStreamSources, createThinkingExtractor, streamHandler } = await import('./streaming');

beforeEach(() => {
    info.mockReset();
    debug.mockReset();
    ENV.SHOW_THINKING_TEXT = true;
    ENV.EXPANDABLE_THINKING = true;
    ENV.ENABLE_SEARCH_SOURCE = true;
});

describe('streamHandler', () => {
    it('accumulates text and emits a progress update after the threshold', async () => {
        async function* stream() {
            yield { text: 'abc' };
            yield { text: 'def' };
        }

        const onStream = {
            send: vi.fn(),
        };
        const messageInfo = { content: '' };

        const result = await streamHandler(stream(), part => part.text, onStream as any, messageInfo as any);

        expect(result).toBe('abcdef');
        expect(onStream.send).toHaveBeenCalledWith('abcdef●');
    });
});

describe('appendStreamSources', () => {
    it('appends a numbered source footer', () => {
        expect(appendStreamSources('answer', [
            { url: 'https://a.example', title: 'A' },
            { url: 'https://b.example', title: 'B' },
        ])).toBe('answer\n\n>sources:\n>[[1\\]](https://a.example) [[2\\]](https://b.example)');
    });

    it('renumbers inline source links', () => {
        expect(appendStreamSources('answer [[1]](https://a.example)', [
            { url: 'https://a.example', title: 'A' },
        ])).toBe('answer [1]\n\n>sources:\n>[[1\\]](https://a.example)');
    });
});

describe('createThinkingExtractor', () => {
    it('opens an expandable thinking quote on reasoning start', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'reasoning-start' } as TextStreamPart<any>))
            .toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
    });

    it('records sources from stream events', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        extractor({
            type: 'source',
            sourceType: 'url',
            url: 'https://example.com',
            title: 'Example',
        } as TextStreamPart<any>);

        expect((messageInfo as any).sources).toEqual([
            { url: 'https://example.com', title: 'Example' },
        ]);
    });

    it('keeps the segmentation marker available for the final answer split', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'text-start' } as TextStreamPart<any>)).toBe('');
        expect(SEGMENTATION_MARK).toBe('//SEGMENTATIONMARK//');
    });
});
