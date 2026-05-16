import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { ModelMessage, StepResult, TextStreamPart } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { ToolChoice } from './model_middleware';
import type { StreamMessageInfo } from './streaming';
import type { ChatStreamTextHandler, ResponseMessage } from './types';
import { generateText, stepCountIs, streamText, tool, wrapLanguageModel } from 'ai';
import { z } from 'zod';
import { ENV } from '../config/env';
import { log } from '../log';
import { wrapExpandableQuote } from '../telegram/utils/render_shared';
import { createLlmModel, getAgentProvider, resolveLlmTarget } from './llm';
import { AIMiddleware, metaDataExtractor } from './model_middleware';
import { appendStreamSources, createThinkingExtractor, streamHandler } from './streaming';
import { shouldEnableSpecialistTool, shouldOverrideToolModel } from './tool_model';

export async function requestChatCompletionsV2({ model, system, messages, tools, activeTools, toolChoice, context, cache, abortSignal, enableSpecialistTool = true }: { model: LanguageModelV3; toolModel?: LanguageModelV3; prompt?: string; system?: string; messages: ModelMessage[]; tools?: any; activeTools: string[]; toolChoice?: ToolChoice[] | undefined; context: AgentUserConfig; cache?: string[]; abortSignal?: AbortSignal; enableSpecialistTool?: boolean }, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string }> {
    log.info(`[requestChatCompletionsV2] messages before SDK: ${JSON.stringify(messages.map((m) => {
        if (m.role === 'user' && Array.isArray(m.content)) {
            return { role: m.role, content: m.content.map(c => c.type === 'file' ? { type: c.type, mediaType: (c as any).mediaType } : { type: c.type }) };
        }
        return { role: m.role };
    }))}, system: ${system ? 'present' : 'absent'}`);

    const { activeTools: effectiveActiveTools, tools: effectiveTools } = createRequestTools({
        activeTools,
        baseTools: tools || {},
        cache,
        context,
        messages,
        system,
        abortSignal,
        enableSpecialistTool,
    });

    const messageInfo: StreamMessageInfo = {
        content: cache?.join() ?? '',
        occured_error: false,
    };
    const { prepareStepPre, onStepFinish, onChunk, ...middleware } = await AIMiddleware({
        config: context,
        activeTools: effectiveActiveTools,
        onStream,
        toolChoice: toolChoice || [],
        messageInfo,
    });

    const handledParams = await combineParams({ context, middleware, model, system, messages, activeTools: effectiveActiveTools, tools: effectiveTools, prepareStepPre, onStepFinish, onChunk, abortSignal });

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

    return { messages: responseMessages, content: contentFull };
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
    const effectiveTarget = shouldOverrideToolModel(context, activeTools.length)
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

function createRequestTools({ activeTools, baseTools, cache, context, messages, system, abortSignal, enableSpecialistTool }: { activeTools: string[]; baseTools: Record<string, any>; cache?: string[]; context: AgentUserConfig; messages: ModelMessage[]; system?: string; abortSignal?: AbortSignal; enableSpecialistTool: boolean }) {
    if (!enableSpecialistTool || !shouldEnableSpecialistTool(context, activeTools.length)) {
        return {
            activeTools,
            tools: baseTools,
        };
    }

    const specialistToolName = 'delegate_to_specialist';
    return {
        activeTools: [...activeTools, specialistToolName],
        tools: {
            ...baseTools,
            [specialistToolName]: tool({
                description: 'Delegate a focused tool-heavy subtask to TOOL_MODEL. Use this when you need deeper research, tool planning, or synthesis before answering.',
                inputSchema: z.object({
                    task: z.string().min(1).describe('The focused task for the specialist model to complete.'),
                    context: z.string().optional().describe('Optional extra context or constraints the specialist should consider.'),
                }),
                execute: async ({ task, context: specialistContext }, options) => {
                    const specialistModel = await createLlmModel(context.TOOL_MODEL.trim(), context);
                    const specialistResult = await requestChatCompletionsV2({
                        model: specialistModel,
                        system: buildSpecialistSystemPrompt(system),
                        messages: buildSpecialistMessages(messages, task, specialistContext, activeTools),
                        tools: baseTools,
                        activeTools,
                        toolChoice: undefined,
                        context,
                        cache: cache ? [...cache] : [],
                        abortSignal: mergeAbortSignals([abortSignal, options.abortSignal]),
                        enableSpecialistTool: false,
                    }, null);
                    return {
                        summary: specialistResult.content,
                    };
                },
            }),
        },
    };
}

function buildSpecialistSystemPrompt(system?: string) {
    const baseSystem = system?.trim() || 'You are a helpful assistant.';
    return `${baseSystem}\n\nYou are an internal specialist assistant helping another model. Focus on the delegated task, use tools when helpful, and return concise findings for the calling model. Do not write as if you are directly speaking to the end user.`;
}

function buildSpecialistMessages(messages: ModelMessage[], task: string, specialistContext: string | undefined, activeTools: string[]): ModelMessage[] {
    const sections = [
        `Delegated task:\n${task.trim()}`,
        specialistContext?.trim() ? `Caller context:\n${specialistContext.trim()}` : '',
        getLatestUserText(messages) ? `Latest user message:\n${getLatestUserText(messages)}` : '',
        activeTools.length > 0 ? `Available tools:\n${activeTools.join(', ')}` : '',
        'Return concise findings for the calling model. Include concrete facts from any tool results you gather.',
    ].filter(Boolean);

    return [{
        role: 'user',
        content: [{
            type: 'text',
            text: sections.join('\n\n'),
        }],
    }];
}

function getLatestUserText(messages: ModelMessage[]) {
    const userMessage = messages.findLast(message => message.role === 'user');
    if (!userMessage) {
        return '';
    }
    if (Array.isArray(userMessage.content)) {
        return userMessage.content
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n')
            .trim();
    }
    return `${userMessage.content || ''}`.trim();
}
