import type { TextStreamPart } from 'ai';
import type { MessageInfo } from './model_middleware';
import type { ChatStreamTextHandler } from './types';
import { TypeValidationError } from 'ai';
import { ENV } from '../config/env';
import { log } from '../log';
import { SEGMENTATION_MARK, wrapExpandableQuote } from '../telegram/utils/render_shared';
import { isUserCancelledSignal } from '../utils/abort';
import { renderResponseBreak, renderThinkingTag, trimLeadingToolTransitionText, trimToolTransitionContent } from './thinking_format';

export interface StreamSource {
    url: string;
    title: string;
}

export interface StreamMessageInfo extends MessageInfo {
    sources?: StreamSource[];
}

interface ThinkingStreamState {
    messageInfo: StreamMessageInfo;
    thinkingStart: boolean;
    thinkingStartTime?: number;
    reasoningBuffer: string;
    lastOutputTime: number;
    hasEmittedReasoningText: boolean;
    detectedInlineThought: boolean;
    inlineThoughtBuffer: string;
    hasPendingToolTransition: boolean;
    shouldTrimLeadingToolTransitionText: boolean;
    thinkingTag: string;
    sources: StreamSource[];
}

export async function streamHandler(stream: AsyncIterable<any>, contentExtractor: (data: any) => string | null, onStream: ChatStreamTextHandler, messageInfo: StreamMessageInfo, abortSignal?: AbortSignal): Promise<string> {
    let lengthDelta = 0;
    let updateStep = 5;
    const maxLength = 10_000;

    try {
        for await (const part of stream) {
            const textPart = contentExtractor(part);
            if (textPart === null || textPart === undefined || textPart === '') {
                continue;
            }
            lengthDelta += textPart.length;
            messageInfo.content += textPart;

            if (lengthDelta > updateStep) {
                lengthDelta = 0;
                updateStep = Math.min(updateStep + 40, maxLength);
                onStream.send(`${messageInfo.content.trimEnd()}●`);
            }
        }
    } catch (e) {
        if (isUserCancelledSignal(abortSignal)) {
            if (messageInfo.content === '') {
                throw e;
            }
            return messageInfo.content;
        }
        if (messageInfo.content === '') {
            throw e;
        }
        console.error((e as Error).message, (e as Error).stack);
        let content: string | undefined;
        if (e instanceof TypeValidationError) {
            content = (e.value as any)?.choices?.[0]?.delta?.content;
        }
        messageInfo.content += (content ?? `\n\n\`\`\`Error\n${(e as Error).message}\n\`\`\``);
        messageInfo.occured_error = true;
    }

    return messageInfo.content;
}

export function appendStreamSources(content: string, sources: StreamSource[]): string {
    if (!sources || sources.length === 0) {
        return content;
    }

    const maxSources = 10;
    const urlToIndex = new Map<string, number>();
    sources.slice(0, maxSources).forEach((source, i) => {
        urlToIndex.set(source.url, i + 1);
    });

    let cleanedContent = content;
    for (const [url, index] of urlToIndex) {
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanedContent = cleanedContent.replace(
            new RegExp(`\\[\\[\\d+\\]\\]\\(${escapedUrl}\\)`, 'g'),
            `[${index}]`,
        );
    }

    const formattedSources = sources
        .slice(0, maxSources)
        .map((source, i) => `[[${i + 1}\\]](${source.url})`)
        .join('\x20');

    return `${cleanedContent.trimEnd()}\n\n>sources:\n>${formattedSources}`;
}

export function createThinkingExtractor(messageInfo: StreamMessageInfo) {
    const state = createThinkingState(messageInfo);
    return (data: TextStreamPart<any>) => handleStreamPart(state, data);
}

function createThinkingState(messageInfo: StreamMessageInfo): ThinkingStreamState {
    const sources: StreamSource[] = [];
    messageInfo.sources = sources;
    return {
        messageInfo,
        thinkingStart: false,
        reasoningBuffer: '',
        lastOutputTime: 0,
        hasEmittedReasoningText: false,
        detectedInlineThought: false,
        inlineThoughtBuffer: '',
        hasPendingToolTransition: false,
        shouldTrimLeadingToolTransitionText: false,
        thinkingTag: '>`Thinking...`',
        sources,
    };
}

function handleStreamPart(state: ThinkingStreamState, data: TextStreamPart<any>) {
    switch (data.type) {
        case 'reasoning-start':
            return handleReasoningStart(state);
        case 'reasoning-delta':
            return handleReasoningDelta(state, data.text);
        case 'reasoning-end':
            return handleReasoningEnd(state);
        case 'text-start':
            return handleTextStart(state);
        case 'text-delta':
            return handleTextDelta(state, data.text);
        case 'text-end':
            return '';
        case 'tool-call':
            return handleToolCall(state);
        case 'source':
            return handleSource(state, data);
        case 'error':
            throw data.error;
        default:
            return '';
    }
}

function handleReasoningStart(state: ThinkingStreamState) {
    if (!ENV.SHOW_THINKING_TEXT) {
        return '';
    }
    if (state.thinkingStart) {
        return '';
    }
    state.thinkingStart = true;
    state.thinkingStartTime = Date.now();
    state.reasoningBuffer = '';
    state.lastOutputTime = Date.now();
    state.hasEmittedReasoningText = false;
    const output = renderThinkingTag(state.messageInfo.content, state.thinkingTag, { separateFromPrevious: state.hasPendingToolTransition });
    state.hasPendingToolTransition = false;
    return output;
}

function handleReasoningDelta(state: ThinkingStreamState, text: string) {
    if (!ENV.SHOW_THINKING_TEXT) {
        return '';
    }
    state.reasoningBuffer += text;
    const now = Date.now();
    const shouldFlush = state.reasoningBuffer.length >= 50
        || /[。！？.!?]\s*$/.test(state.reasoningBuffer.trim())
        || (now - state.lastOutputTime > 500 && state.reasoningBuffer.length >= 20);
    if (!shouldFlush) {
        return '';
    }
    const output = renderQuotedReasoningChunk(state.reasoningBuffer, !state.hasEmittedReasoningText);
    state.reasoningBuffer = '';
    state.lastOutputTime = now;
    state.hasEmittedReasoningText = true;
    return output;
}

function handleReasoningEnd(state: ThinkingStreamState) {
    if (!ENV.SHOW_THINKING_TEXT) {
        return '';
    }
    if (state.reasoningBuffer.length === 0) {
        return '';
    }
    const output = renderQuotedReasoningChunk(state.reasoningBuffer, !state.hasEmittedReasoningText);
    state.reasoningBuffer = '';
    state.hasEmittedReasoningText = true;
    return output;
}

function handleTextStart(state: ThinkingStreamState) {
    log.info('[thinkingExtractor] text-start event');
    if (!state.thinkingStart) {
        if (state.hasPendingToolTransition) {
            state.hasPendingToolTransition = false;
            state.shouldTrimLeadingToolTransitionText = true;
            return renderResponseBreak(state.messageInfo.content);
        }
        return '';
    }
    state.thinkingStart = false;
    const thinkingTime = ((Date.now() - state.thinkingStartTime!) / 1e3).toFixed(1);
    state.messageInfo.content = state.messageInfo.content
        .replace(state.thinkingTag, `>\`Thought for ${thinkingTime} seconds\``)
        .replace(/(\n>)*$/, '')
        .replace(/(\n>){3,}$/g, '\n>\n>');
    return `\n>✹\n${SEGMENTATION_MARK}\n`;
}

function handleTextDelta(state: ThinkingStreamState, textDelta: string) {
    let nextTextDelta = textDelta;
    if (state.shouldTrimLeadingToolTransitionText) {
        nextTextDelta = trimLeadingToolTransitionText(nextTextDelta);
        if (nextTextDelta.length === 0) {
            return '';
        }
        state.shouldTrimLeadingToolTransitionText = false;
    }

    log.debug(`[thinkingExtractor] text-delta: "${nextTextDelta}"`);

    if (!ENV.SHOW_THINKING_TEXT) {
        return nextTextDelta;
    }

    const isStartOfMessage = state.messageInfo.content.trim().length === 0
        || state.messageInfo.content.endsWith(`${SEGMENTATION_MARK}\n`);
    const thoughtPatterns = /^(?:thought|thinking|reasoning)[\s:]+/i;

    if (isStartOfMessage && thoughtPatterns.test(nextTextDelta)) {
        state.detectedInlineThought = true;
        state.inlineThoughtBuffer = nextTextDelta;
        log.info('[thinkingExtractor] Detected inline thought text from AI model');
        return wrapExpandableQuote(`${state.thinkingTag}${renderQuotedChunk(nextTextDelta, true)}`, ENV.EXPANDABLE_THINKING);
    }

    if (state.detectedInlineThought) {
        state.inlineThoughtBuffer += nextTextDelta;
        const hasDoubleNewline = /\n\s*\n/.test(state.inlineThoughtBuffer);
        const endsWithSentenceThenCapital = /[.!?]\s+[A-Z]/.test(state.inlineThoughtBuffer.slice(-100));
        const isVeryLong = state.inlineThoughtBuffer.length > 500;
        const shouldEndThought = hasDoubleNewline
            || (state.inlineThoughtBuffer.length > 200 && endsWithSentenceThenCapital)
            || (isVeryLong && /[.!?]\s*$/.test(state.inlineThoughtBuffer.trim()));

        if (!shouldEndThought) {
            return renderQuotedChunk(nextTextDelta, false);
        }

        state.detectedInlineThought = false;
        const estimatedTime = (state.inlineThoughtBuffer.length / 100).toFixed(1);
        state.messageInfo.content = state.messageInfo.content
            .replace(state.thinkingTag, `>\`Thought for ${estimatedTime} seconds\``);
        state.inlineThoughtBuffer = '';
        log.info('[thinkingExtractor] Inline thought block ended');

        if (hasDoubleNewline) {
            const lastNewlineMatch = nextTextDelta.match(/\n\s*\n/);
            if (lastNewlineMatch) {
                const splitIndex = lastNewlineMatch.index! + lastNewlineMatch[0].length;
                const thoughtPart = nextTextDelta.slice(0, splitIndex);
                const responsePart = nextTextDelta.slice(splitIndex);
                return `${renderQuotedChunk(thoughtPart, false)}\n>✹\n${SEGMENTATION_MARK}\n${responsePart}`;
            }
        }

        return `${renderQuotedChunk(nextTextDelta, false)}\n>✹\n${SEGMENTATION_MARK}\n`;
    }

    return nextTextDelta;
}

function handleToolCall(state: ThinkingStreamState) {
    state.hasPendingToolTransition = state.messageInfo.content.trim().length > 0;
    if (state.hasPendingToolTransition) {
        state.messageInfo.content = trimToolTransitionContent(state.messageInfo.content);
    }
    return '';
}

function handleSource(state: ThinkingStreamState, data: TextStreamPart<any>) {
    const source = data as TextStreamPart<any> & { sourceType?: string; url?: string; title?: string };
    if (ENV.ENABLE_SEARCH_SOURCE && source.sourceType === 'url') {
        state.sources.push({
            url: source.url || '',
            title: source.title || source.url || '',
        });
    }
    return '';
}

function renderQuotedChunk(text: string, isStart: boolean) {
    return `${isStart ? '\n>' : ''}${text.replace(/\n/g, '\n>')}`;
}

function renderQuotedReasoningChunk(text: string, isStart: boolean) {
    return `${isStart ? '\n>' : text.startsWith('\n') ? '' : '\n>'}${text.replace(/\n/g, '\n>')}`;
}
