/* eslint-disable no-case-declarations */
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelMessage, StepResult, TextStreamPart } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { MessageInfo, ToolChoice } from './model_middleware';
import type { ChatStreamTextHandler, ResponseMessage } from './types';
import { generateText, stepCountIs, streamText, TypeValidationError, wrapLanguageModel } from 'ai';
import { ENV } from '../config/env';
import { log } from '../log';
import { SEGMENTATION_MARK } from '../telegram/utils/md2tgmd';
import { isUserCancelledSignal } from '../utils/abort';
import { getAgentProvider, resolveLlmTarget } from './llm';
import { AIMiddleware, metaDataExtractor } from './model_middleware';
import { renderResponseBreak, renderThinkingTag, trimLeadingToolTransitionText, trimToolTransitionContent } from './thinking_format';

export async function streamHandler(stream: AsyncIterable<any>, contentExtractor: (data: any) => string | null, onStream: ChatStreamTextHandler, messageInfo: MessageInfo, abortSignal?: AbortSignal): Promise<string> {
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

function appendStreamSources(content: string, sources: Array<{ url: string; title: string }>): string {
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

export async function requestChatCompletionsV2({ model, system, messages, tools, activeTools, toolChoice, context, cache, abortSignal }: { model: LanguageModelV3; toolModel?: LanguageModelV3; prompt?: string; system?: string; messages: ModelMessage[]; tools?: any; activeTools: string[]; toolChoice?: ToolChoice[] | undefined; context: AgentUserConfig; cache?: string[]; abortSignal?: AbortSignal }, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string }> {
    log.info(`[requestChatCompletionsV2] messages before SDK: ${JSON.stringify(messages.map((m) => {
        if (m.role === 'user' && Array.isArray(m.content)) {
            return { role: m.role, content: m.content.map(c => c.type === 'file' ? { type: c.type, mediaType: (c as any).mediaType } : { type: c.type }) };
        }
        return { role: m.role };
    }))}, system: ${system ? 'present' : 'absent'}`);

    const messageInfo: MessageInfo = {
        content: cache?.join() ?? '',
        occured_error: false,
    };
    const { prepareStepPre, onStepFinish, onChunk, ...middleware } = await AIMiddleware({
        config: context,
        activeTools,
        onStream,
        toolChoice: toolChoice || [],
        messageInfo,
    });

    const handledParams = await combineParams({ context, middleware, model, system, messages, activeTools, tools, prepareStepPre, onStepFinish, onChunk, abortSignal });

    let responseMessages: ResponseMessage[] = [];
    let contentFull = '';

    if (onStream !== null) {
        const stream = streamText(handledParams);
        const dataExtractor = thinkingExtractor(messageInfo);

        contentFull = await streamHandler(stream.fullStream, dataExtractor, onStream, messageInfo, abortSignal);
        responseMessages = messageInfo.occured_error ? [{ role: 'assistant', content: contentFull }] : (await stream.response).messages;
        contentFull = messageInfo.occured_error ? contentFull : metaDataExtractor(await stream.providerMetadata, model.provider, contentFull);

        if ((messageInfo as any).sources?.length > 0) {
            contentFull = appendStreamSources(contentFull, (messageInfo as any).sources);
        }
    } else {
        const result = await generateText(handledParams);
        contentFull = `${result.reasoning ? `>\`Thought for several seconds\`\n>${(result.reasoningText ?? '').trim().replace(/\n/g, '\n>')}\n>✹\n` : ''}${result.text}`;
        responseMessages = result.response.messages;
        contentFull = metaDataExtractor(result.providerMetadata, model.provider, contentFull);
    }

    return { messages: responseMessages, content: contentFull };
}

function thinkingExtractor(messageInfo: MessageInfo) {
    let thinkingStart = false;
    let thinkingStartTime: undefined | number;
    let reasoningBuffer = '';
    let lastOutputTime = 0;
    let hasEmittedReasoningText = false;
    const thinkingTag = '>`Thinking\\.\\.\\.`';
    const sources: Array<{ url: string; title: string }> = [];

    let detectedInlineThought = false;
    let inlineThoughtBuffer = '';
    let hasPendingToolTransition = false;
    let shouldTrimLeadingToolTransitionText = false;

    (messageInfo as any).sources = sources;

    const renderQuotedChunk = (text: string, isStart: boolean) => {
        return `${isStart ? '\n>' : ''}${text.replace(/\n/g, '\n>')}`;
    };

    return (data: TextStreamPart<any>) => {
        switch (data.type) {
            case 'reasoning-start':
                if (!ENV.SHOW_THINKING_TEXT) {
                    return '';
                }
                if (!thinkingStart) {
                    thinkingStart = true;
                    thinkingStartTime = Date.now();
                    reasoningBuffer = '';
                    lastOutputTime = Date.now();
                    hasEmittedReasoningText = false;
                    const output = renderThinkingTag(messageInfo.content, thinkingTag, { separateFromPrevious: hasPendingToolTransition });
                    hasPendingToolTransition = false;
                    return output;
                }
                return '';
            case 'reasoning-delta':
                if (!ENV.SHOW_THINKING_TEXT) {
                    return '';
                }
                reasoningBuffer += data.text;
                const now = Date.now();
                if (reasoningBuffer.length >= 50
                    || /[。！？.!?]\s*$/.test(reasoningBuffer.trim())
                    || (now - lastOutputTime > 500 && reasoningBuffer.length >= 20)) {
                    const output = renderQuotedChunk(reasoningBuffer, !hasEmittedReasoningText);
                    reasoningBuffer = '';
                    lastOutputTime = now;
                    hasEmittedReasoningText = true;
                    return output;
                }
                return '';
            case 'reasoning-end':
                if (!ENV.SHOW_THINKING_TEXT) {
                    return '';
                }
                let output = '';
                if (reasoningBuffer.length > 0) {
                    output = renderQuotedChunk(reasoningBuffer, !hasEmittedReasoningText);
                    reasoningBuffer = '';
                    hasEmittedReasoningText = true;
                }
                return output;
            case 'text-start':
                log.info('[thinkingExtractor] text-start event');
                if (!thinkingStart) {
                    if (hasPendingToolTransition) {
                        hasPendingToolTransition = false;
                        shouldTrimLeadingToolTransitionText = true;
                        return renderResponseBreak(messageInfo.content);
                    }
                    return '';
                }
                thinkingStart = false;
                const thinkingTime = ((Date.now() - thinkingStartTime!) / 1e3).toFixed(1);
                messageInfo.content = messageInfo.content
                    .replace(thinkingTag, `>\`Thought for ${thinkingTime} seconds\``)
                    .replace(/(\n>)*$/, '')
                    .replace(/(\n>){3,}$/g, '\n>\n>');
                return `\n>✹\n${SEGMENTATION_MARK}\n`;
            case 'text-delta':
                let textDelta = data.text;
                if (shouldTrimLeadingToolTransitionText) {
                    textDelta = trimLeadingToolTransitionText(textDelta);
                    if (textDelta.length === 0) {
                        return '';
                    }
                    shouldTrimLeadingToolTransitionText = false;
                }
                log.debug(`[thinkingExtractor] text-delta: "${textDelta}"`);

                if (!ENV.SHOW_THINKING_TEXT) {
                    return textDelta;
                }

                const isStartOfMessage = messageInfo.content.trim().length === 0
                    || messageInfo.content.endsWith(`${SEGMENTATION_MARK}\n`);
                const thoughtPatterns = /^(?:thought|thinking|reasoning)[\s:]+/i;

                if (isStartOfMessage && thoughtPatterns.test(textDelta)) {
                    detectedInlineThought = true;
                    inlineThoughtBuffer = textDelta;
                    log.info('[thinkingExtractor] Detected inline thought text from AI model');
                    return `${thinkingTag}${renderQuotedChunk(textDelta, true)}`;
                }

                if (detectedInlineThought) {
                    inlineThoughtBuffer += textDelta;
                    const hasDoubleNewline = /\n\s*\n/.test(inlineThoughtBuffer);
                    const endsWithSentenceThenCapital = /[.!?]\s+[A-Z]/.test(inlineThoughtBuffer.slice(-100));
                    const isVeryLong = inlineThoughtBuffer.length > 500;
                    const shouldEndThought = hasDoubleNewline
                        || (inlineThoughtBuffer.length > 200 && endsWithSentenceThenCapital)
                        || (isVeryLong && /[.!?]\s*$/.test(inlineThoughtBuffer.trim()));

                    if (shouldEndThought) {
                        detectedInlineThought = false;
                        const estimatedTime = (inlineThoughtBuffer.length / 100).toFixed(1);
                        messageInfo.content = messageInfo.content
                            .replace(thinkingTag, `>\`Thought for ${estimatedTime} seconds\``);
                        inlineThoughtBuffer = '';
                        log.info('[thinkingExtractor] Inline thought block ended');

                        if (hasDoubleNewline) {
                            const lastNewlineMatch = textDelta.match(/\n\s*\n/);
                            if (lastNewlineMatch) {
                                const splitIndex = lastNewlineMatch.index! + lastNewlineMatch[0].length;
                                const thoughtPart = textDelta.slice(0, splitIndex);
                                const responsePart = textDelta.slice(splitIndex);
                                return `${renderQuotedChunk(thoughtPart, false)}\n>✹\n${SEGMENTATION_MARK}\n${responsePart}`;
                            }
                        }

                        return `${renderQuotedChunk(textDelta, false)}\n>✹\n${SEGMENTATION_MARK}\n`;
                    }

                    return renderQuotedChunk(textDelta, false);
                }

                return textDelta;
            case 'text-end':
                return '';
            case 'tool-call':
                hasPendingToolTransition = messageInfo.content.trim().length > 0;
                if (hasPendingToolTransition) {
                    messageInfo.content = trimToolTransitionContent(messageInfo.content);
                }
                return '';
            case 'source':
                if (ENV.ENABLE_SEARCH_SOURCE && data.sourceType === 'url') {
                    sources.push({
                        url: data.url,
                        title: data.title || data.url,
                    });
                }
                return '';
            case 'error':
                throw data.error;
            default:
                return '';
        }
    };
}

function mergeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
    const activeSignals = signals.filter(Boolean) as AbortSignal[];
    if (activeSignals.length === 0) {
        return undefined;
    }
    if (activeSignals.length === 1) {
        return activeSignals[0];
    }
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any(activeSignals);
    }
    const controller = new AbortController();
    const abort = (signal: AbortSignal) => {
        if (!controller.signal.aborted) {
            controller.abort(signal.reason);
        }
    };
    for (const signal of activeSignals) {
        if (signal.aborted) {
            abort(signal);
            break;
        }
        signal.addEventListener('abort', () => abort(signal), { once: true });
    }
    return controller.signal;
}

async function combineParams({ context, middleware, model, system, messages, activeTools, tools, prepareStepPre, onStepFinish, onChunk, abortSignal }: { context: AgentUserConfig; middleware: any; model: LanguageModelV3; system?: string; messages: ModelMessage[]; activeTools: string[]; tools: any; prepareStepPre: (middleware: (...args: any[]) => any) => any; onStepFinish: (data: StepResult<any>) => void; onChunk: (data: { chunk: TextStreamPart<any> }) => void; abortSignal?: AbortSignal }) {
    const effectiveTarget = activeTools.length > 0 && context.TOOL_MODEL
        ? resolveLlmTarget(context.TOOL_MODEL, context)
        : {
                agent: getAgentProvider(model),
                modelId: model.modelId,
                useResponsesApi: model.provider.endsWith('.responses'),
            };
    const providerOptions: Record<string, any> = {};
    if (effectiveTarget.agent === 'oailike' && !effectiveTarget.useResponsesApi) {
        providerOptions['oailike.chat'] = context.OAILIKE_PROVIDER_OPTIONS;
    } else {
        providerOptions.openai = effectiveTarget.agent === 'oailike' ? context.OAILIKE_PROVIDER_OPTIONS : context.OPENAI_PROVIDER_OPTIONS;
    }
    const mergedAbortSignal = mergeAbortSignals([
        abortSignal,
        ENV.CHAT_TOTAL_DURATION_LIMIT > 0 ? AbortSignal.timeout(ENV.CHAT_TOTAL_DURATION_LIMIT * 1e3) : undefined,
    ]);

    return {
        model: wrapLanguageModel({
            model,
            middleware,
        }),
        providerOptions,
        system,
        messages,
        experimental_continueSteps: context.CONTINUE_STEP,
        maxRetries: context.MAX_RETRIES,
        temperature: (activeTools?.length || 0) > 0 ? context.FUNCTION_CALL_TEMPERATURE : context.CHAT_TEMPERATURE,
        tools,
        maxTokens: context.MAX_TOKENS,
        activeTools,
        prepareStep: prepareStepPre(middleware),
        stopWhen: stepCountIs(context.MAX_STEPS),
        onStepFinish,
        onChunk,
        ...(mergedAbortSignal && { abortSignal: mergedAbortSignal }),
    };
}
