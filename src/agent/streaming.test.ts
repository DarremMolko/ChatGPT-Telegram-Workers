import type { TextStreamPart } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
const debug = vi.fn();

vi.mock('../config/env', () => ({
    ENV: {
        SHOW_THINKING_TEXT: true,
        EXPANDABLE_THINKING: true,
        ENABLE_SEARCH_SOURCE: true,
        STREAM_DEBUG_DIAGNOSTICS: true,
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
    ENV.STREAM_DEBUG_DIAGNOSTICS = true;
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
        expect(debug).toHaveBeenCalledWith('[streamHandler] stream-begin', {
            initialContentLength: 0,
            hasAbortSignal: false,
        });
    });

    it('skips streamed diagnostics when the env flag is disabled', async () => {
        ENV.STREAM_DEBUG_DIAGNOSTICS = false;

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
        expect(debug).not.toHaveBeenCalledWith('[streamHandler] stream-begin', expect.anything());
        expect(debug).not.toHaveBeenCalledWith('[streamHandler] append-extracted-text', expect.anything());
        expect(debug).not.toHaveBeenCalledWith('[streamHandler] emit-progress-update', expect.anything());
    });

    it('logs empty extractor results when diagnostics are enabled', async () => {
        async function* stream() {
            yield { type: 'source', title: 'Example' };
        }

        const onStream = {
            send: vi.fn(),
        };
        const messageInfo = { content: '' };

        const result = await streamHandler(stream(), () => '', onStream as any, messageInfo as any);

        expect(result).toBe('');
        expect(debug).toHaveBeenCalledWith('[streamHandler] no-extracted-text', {
            part: {
                type: 'source',
                preview: {
                    type: 'source',
                },
            },
        });
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
        expect(debug).toHaveBeenCalledWith('[thinkingExtractor] source-event', {
            accepted: true,
            sourceType: 'url',
            title: {
                length: 7,
                preview: 'Example',
            },
            url: {
                length: 19,
                preview: 'https://example.com',
            },
            totalSources: 1,
        });
    });

    it('logs the first raw stream part type once', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        extractor({
            type: 'text-delta',
            text: 'hola',
        } as TextStreamPart<any>);
        extractor({
            type: 'text-delta',
            text: ' mundo',
        } as TextStreamPart<any>);

        const firstPartLogs = debug.mock.calls.filter(call => call[0] === '[thinkingExtractor] stream-first-part');
        expect(firstPartLogs).toHaveLength(1);
        expect(firstPartLogs[0][1]).toMatchObject({
            type: 'text-delta',
            preview: {
                length: 4,
                preview: 'hola',
            },
        });
    });

    it('keeps the segmentation marker available for the final answer split', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'text-start' } as TextStreamPart<any>)).toBe('');
        expect(SEGMENTATION_MARK).toBe('//SEGMENTATIONMARK//');
        expect(debug).toHaveBeenCalledWith('[thinkingExtractor] text-start', {
            mode: 'noop',
        });
    });

    it('logs tool transitions before the final text starts', () => {
        const messageInfo = { content: 'Existing answer' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'tool-call', toolName: 'search_tools' } as TextStreamPart<any>)).toBe('');
        expect(extractor({ type: 'text-start' } as TextStreamPart<any>)).toBe('\n');

        expect(debug).toHaveBeenCalledWith('[thinkingExtractor] tool-call-transition', {
            pendingToolTransition: true,
            contentLength: expect.any(Number),
        });
        expect(debug).toHaveBeenCalledWith('[thinkingExtractor] text-start', {
            mode: 'pending_tool_transition',
            emitted: {
                length: 1,
                preview: '\\n',
            },
        });
    });

    it('logs inline thought detection in text-delta mode', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({
            type: 'text-delta',
            text: 'Thinking: I should inspect the tools first.',
        } as TextStreamPart<any>)).toContain('Thinking: I should inspect the tools first.');

        const inlineThoughtLog = debug.mock.calls.find(call => call[0] === '[thinkingExtractor] inline-thought-detected');
        expect(inlineThoughtLog?.[1]).toEqual({
            initialChunk: {
                length: 43,
                preview: 'Thinking: I should inspect the tools first.',
            },
        });
    });

    it('waits for a safer boundary before flushing streamed reasoning text', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'reasoning-start' } as TextStreamPart<any>))
            .toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
        expect(extractor({
            type: 'reasoning-delta',
            text: 'Considering user response style I think the user probably',
        } as TextStreamPart<any>)).toBe('');
        expect(extractor({
            type: 'reasoning-delta',
            text: ' wants me to stop with the jokes.',
        } as TextStreamPart<any>)).toBe('\n>Considering user response style I think the user probably wants me to stop with the jokes.');
    });

    it('inserts a separator between flushed reasoning chunks when the next chunk starts a new sentence fragment', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'reasoning-start' } as TextStreamPart<any>))
            .toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
        expect(extractor({
            type: 'reasoning-delta',
            text: 'The tool call failed, so I cannot provide the forecast right now.',
        } as TextStreamPart<any>)).toBe('\n>The tool call failed, so I cannot provide the forecast right now.');
        expect(extractor({
            type: 'reasoning-delta',
            text: 'Clarifying weather data limitations.',
        } as TextStreamPart<any>)).toBe(' Clarifying weather data limitations.');
    });

    it('continues quoted reasoning correctly after a flushed newline', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'reasoning-start' } as TextStreamPart<any>))
            .toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
        expect(extractor({
            type: 'reasoning-delta',
            text: 'Line one is long enough to flush after a newline.\n',
        } as TextStreamPart<any>)).toBe('\n>Line one is long enough to flush after a newline.\n>');
        expect(extractor({
            type: 'reasoning-delta',
            text: 'Line two continues the quote correctly.',
        } as TextStreamPart<any>)).toBe('>Line two continues the quote correctly.');
    });

    it('starts a new quoted paragraph for block-shaped reasoning chunks', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        expect(extractor({ type: 'reasoning-start' } as TextStreamPart<any>))
            .toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
        expect(extractor({
            type: 'reasoning-delta',
            text: 'If all else fails, I might consider web search tools.',
        } as TextStreamPart<any>)).toBe('\n>If all else fails, I might consider web search tools.');
        expect(extractor({
            type: 'reasoning-delta',
            text: '**Exploring tool parameters**\n\nI\'m running into a similar issue with the `call_tool`.',
        } as TextStreamPart<any>)).toBe('\n>**Exploring tool parameters**\n>\n>I\'m running into a similar issue with the `call_tool`.');

        const flushCalls = debug.mock.calls.filter(call => call[0] === '[thinkingExtractor] reasoning-flush');
        expect(flushCalls.at(-1)?.[1]).toMatchObject({
            joinMode: 'paragraph_break',
        });
    });

    it('logs reasoning flush diagnostics at debug level', () => {
        const messageInfo = { content: '' };
        const extractor = createThinkingExtractor(messageInfo as any);

        extractor({ type: 'reasoning-start' } as TextStreamPart<any>);
        extractor({
            type: 'reasoning-delta',
            text: 'The tool call failed, so I cannot provide the forecast right now.',
        } as TextStreamPart<any>);

        const flushCall = debug.mock.calls.find(call => call[0] === '[thinkingExtractor] reasoning-flush');
        expect(flushCall?.[1]).toMatchObject({
            reason: ['sentence_boundary'],
            joinMode: 'initial_quote',
        });
    });
});
