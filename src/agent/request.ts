import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelMessage, StepResult, TextStreamPart } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { ToolChoice } from './model_middleware';
import type { StreamMessageInfo } from './streaming';
import type { ChatStreamTextHandler, ResponseMessage } from './types';
import { generateText, stepCountIs, streamText, wrapLanguageModel } from 'ai';
import { ENV } from '../config/env';
import { log } from '../log';
import { wrapExpandableQuote } from '../telegram/utils/render_shared';
import { getAgentProvider, resolveLlmTarget } from './llm';
import { AIMiddleware, metaDataExtractor } from './model_middleware';
import { appendStreamSources, createThinkingExtractor, streamHandler } from './streaming';

export async function requestChatCompletionsV2({ model, system, messages, tools, activeTools, toolChoice, context, cache, abortSignal }: { model: LanguageModelV3; toolModel?: LanguageModelV3; prompt?: string; system?: string; messages: ModelMessage[]; tools?: any; activeTools: string[]; toolChoice?: ToolChoice[] | undefined; context: AgentUserConfig; cache?: string[]; abortSignal?: AbortSignal }, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string }> {
    log.info(`[requestChatCompletionsV2] messages before SDK: ${JSON.stringify(messages.map((m) => {
        if (m.role === 'user' && Array.isArray(m.content)) {
            return { role: m.role, content: m.content.map(c => c.type === 'file' ? { type: c.type, mediaType: (c as any).mediaType } : { type: c.type }) };
        }
        return { role: m.role };
    }))}, system: ${system ? 'present' : 'absent'}`);

    const shouldSplitPlannerPass = shouldUseToolPlannerPass({ model, activeTools, context });
    if (shouldSplitPlannerPass) {
        log.info(`[requestChatCompletionsV2] split tool planner enabled for TOOL_MODEL=${context.TOOL_MODEL}`);
        const plannerResult = await executeChatCompletions({
            model,
            system,
            messages,
            tools,
            activeTools,
            toolChoice,
            context,
            cache,
            abortSignal,
        }, createSilentPlannerStream(onStream));

        const finalMessages = plannerResult.toolResults.length > 0
            ? buildToolSynthesisMessages(messages, plannerResult.toolResults)
            : messages;
        log.info(`[requestChatCompletionsV2] planner toolResults=${plannerResult.toolResults.length}, running final synthesis on chat model`);
        const finalResult = await executeChatCompletions({
            model,
            system,
            messages: finalMessages,
            tools: undefined,
            activeTools: [],
            toolChoice: undefined,
            context,
            cache,
            abortSignal,
        }, onStream);
        return {
            messages: finalResult.messages,
            content: finalResult.content,
        };
    }

    const result = await executeChatCompletions({
        model,
        system,
        messages,
        tools,
        activeTools,
        toolChoice,
        context,
        cache,
        abortSignal,
    }, onStream);

    return {
        messages: result.messages,
        content: result.content,
    };
}

interface ToolExecutionRecord {
    toolCallId?: string;
    toolName: string;
    input: unknown;
    output: unknown;
}

interface StepToolResultRecord {
    toolCallId?: string;
    toolName: string;
    input: unknown;
    output: unknown;
}

async function executeChatCompletions({ model, system, messages, tools, activeTools, toolChoice, context, cache, abortSignal }: { model: LanguageModelV3; toolModel?: LanguageModelV3; prompt?: string; system?: string; messages: ModelMessage[]; tools?: any; activeTools: string[]; toolChoice?: ToolChoice[] | undefined; context: AgentUserConfig; cache?: string[]; abortSignal?: AbortSignal }, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string; toolResults: ToolExecutionRecord[] }> {
    const messageInfo: StreamMessageInfo = {
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

    const toolResults: ToolExecutionRecord[] = [];
    const handledParams = await combineParams({
        context,
        middleware,
        model,
        system,
        messages,
        activeTools,
        tools,
        prepareStepPre,
        onStepFinish: async (data: StepResult<any>) => {
            await onStepFinish(data);
            collectToolResults(toolResults, data.toolResults || []);
        },
        onChunk,
        abortSignal,
    });

    let responseMessages: ResponseMessage[] = [];
    let contentFull = '';

    if (onStream !== null) {
        const stream = streamText(handledParams);
        const dataExtractor = createThinkingExtractor(messageInfo);

        contentFull = await streamHandler(stream.fullStream, dataExtractor, onStream, messageInfo, abortSignal);
        responseMessages = messageInfo.occured_error ? [{ role: 'assistant', content: contentFull }] : (await stream.response).messages;
        contentFull = messageInfo.occured_error ? contentFull : metaDataExtractor(await stream.providerMetadata, model.provider, contentFull);

        const sources = messageInfo.sources ?? [];
        if (sources.length > 0) {
            contentFull = appendStreamSources(contentFull, sources);
        }
    } else {
        const result = await generateText(handledParams);
        contentFull = `${result.reasoning ? wrapExpandableQuote(`>\`Thought for several seconds\`\n>${(result.reasoningText ?? '').trim().replace(/\n/g, '\n>')}\n>✹\n`, ENV.EXPANDABLE_THINKING) : ''}${result.text}`;
        responseMessages = result.response.messages;
        contentFull = metaDataExtractor(result.providerMetadata, model.provider, contentFull);
    }

    return { messages: responseMessages, content: contentFull, toolResults };
}

function shouldUseToolPlannerPass({ model, activeTools, context }: { model: LanguageModelV3; activeTools: string[]; context: AgentUserConfig }) {
    const configuredToolModel = context.TOOL_MODEL?.trim();
    if (!configuredToolModel || activeTools.length === 0) {
        return false;
    }
    const target = resolveLlmTarget(configuredToolModel, context);
    return target.agent !== getAgentProvider(model) || target.modelId !== model.modelId;
}

function createSilentPlannerStream(onStream: ChatStreamTextHandler | null): ChatStreamTextHandler | null {
    if (onStream === null) {
        return null;
    }
    return {
        sender: onStream.sender,
        clearHeartbeat: onStream.clearHeartbeat,
        peek: () => '',
        send: async () => null,
        end: async () => null,
    };
}

function collectToolResults(target: ToolExecutionRecord[], toolResults: StepToolResultRecord[]) {
    const seen = new Set(target.map(result => toolResultKey(result)));
    for (const toolResult of toolResults) {
        const normalized: ToolExecutionRecord = {
            toolCallId: toolResult.toolCallId,
            toolName: toolResult.toolName,
            input: toolResult.input,
            output: toolResult.output,
        };
        const key = toolResultKey(normalized);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        target.push(normalized);
    }
}

function toolResultKey(result: ToolExecutionRecord) {
    if (result.toolCallId) {
        return result.toolCallId;
    }
    return `${result.toolName}:${safeJsonStringify(result.input)}:${safeJsonStringify(result.output)}`;
}

function buildToolSynthesisMessages(messages: ModelMessage[], toolResults: ToolExecutionRecord[]): ModelMessage[] {
    const toolContent = renderToolResultsForSynthesis(toolResults);
    if (!toolContent) {
        return messages;
    }
    return [
        ...messages,
        {
            role: 'user',
            content: [{
                type: 'text',
                text: `### Please use the following retrieved data to answer my question:\n${toolContent}`,
            }],
        },
    ];
}

function renderToolResultsForSynthesis(toolResults: ToolExecutionRecord[]) {
    return toolResults.map(({ toolName, input, output }) => {
        const normalizedOutput = (output as any)?.type === 'execution-denied'
            ? { error: (output as any).reason || 'Execution denied' }
            : ((output && typeof output === 'object' && 'value' in (output as Record<string, unknown>))
                    ? (output as Record<string, unknown>).value
                    : output);
        return `#### [tool \`${toolName}\` invoke detail]\n - args: ${safeJsonStringify(input)}\n - result:\n${safeJsonStringify(normalizedOutput)}\n`;
    }).join('\n').trim();
}

function safeJsonStringify(value: unknown) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
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
