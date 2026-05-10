/* eslint-disable no-case-declarations */
/* eslint-disable unused-imports/no-unused-vars */
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Prompt } from '@ai-sdk/provider';
import type { ModelMessage, StepResult, TextStreamPart, ToolCallPart, ToolResultPart } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { LogStruct } from '../log';
import type { ToolResult } from '../telegram/utils/tool_result';
import type { ChatStreamTextHandler } from './types';
import {
    extractReasoningMiddleware,
    wrapLanguageModel,
} from 'ai';
import { ENV } from '../config/env';
import { getLogSingleton, log } from '../log';
import { resolveMcpTools } from '../mcp/tools';
import { sendToolResult } from '../telegram/utils/tool_result';
import { createLlmModel, getAgentProvider, resolveLlmTarget } from './llm';

type Writeable<T> = { -readonly [P in keyof T as P extends 'modelId' ? P : never]: T[P] };
export interface MessageInfo {
    content: string;
    occured_error?: boolean;
}

const OPENAI_PROVIDER_TOOLS = new Set(['web_search', 'code_interpreter', 'file_search', 'image_generation', 'mcp']);

export async function AIMiddleware({ config, activeTools, onStream, toolChoice, messageInfo, chatModel }: { config: AgentUserConfig; activeTools: string[]; onStream: ChatStreamTextHandler | null; toolChoice: ToolChoice[] | []; messageInfo: MessageInfo; chatModel: string }): Promise<Record<string, ((...args: any[]) => any)>> {
    let step = 0;
    let rawSystemPrompt: string | undefined;
    const extractReasoning = extractReasoningMiddleware({ tagName: 'think' });
    let hasRecordFirstChunkTime = false;
    let record: LogStruct;
    let currentModel: LanguageModelV3;

    return {
        prepareStepPre: (middleware: any) => async ({ model }: { model: LanguageModelV3; stepNumber: number; steps: StepResult<any>[] }) => {
            currentModel = model;
            if (activeTools.length > 0) {
                const targetModel = config.TOOL_MODEL;
                currentModel = wrapLanguageModel({
                    model: await createLlmModel(targetModel, config),
                    middleware,
                });
            }
            record = getLogSingleton({ config });
            recordModelLog({ config, model: currentModel, record });
            return {
                model: currentModel,
            };
        },

        wrapGenerate: async ({ doGenerate, params, model }: { doGenerate: () => Promise<any>; params: any; model: LanguageModelV3 }) => {
            return extractReasoning.wrapGenerate!({ doGenerate, doStream: () => model.doStream(params), params, model });
        },

        wrapStream: async ({ doStream, params, model }: { doStream: () => Promise<any>; params: any; model: LanguageModelV3 }) => {
            return extractReasoning.wrapStream!({ doStream, doGenerate: () => model.doGenerate(params), params, model });
        },

        transformParams: async ({ type, params }: { type: 'generate' | 'stream'; params: LanguageModelV3CallOptions }) => {
            log.info(`start ${type} call`);

            if (activeTools.length > 0 && toolChoice.length > 0 && step < toolChoice.length) {
                const toolChoiceItem = toolChoice[step] as any;
                log.info(`toolChoice changed: ${JSON.stringify(toolChoiceItem)}`);
                params.toolChoice = toolChoiceItem;
            }
            if (params.prompt.at(-1)?.role === 'tool') {
                log.info('detect last message is tool result, handle tool result');
                const toolResults = params.prompt.at(-1)?.content as unknown as ToolResultPart[];
                await handleToolResult({ toolResults, onStream, config });
                log.debug(`last tool result: ${JSON.stringify(toolResults, null, 2)}`);
            }
            if (!rawSystemPrompt) {
                rawSystemPrompt = params.prompt.find((i: any) => i.role === 'system')?.content as string;
            }
            const isResponseApi = currentModel.provider.endsWith('.responses');
            warpMessages(params, activeTools, isResponseApi, rawSystemPrompt);
            return params;
        },

        onChunk: ({ chunk }: { chunk: TextStreamPart<any> }) => {
            if (!hasRecordFirstChunkTime) {
                record.first_chunk_time = Date.now() - record.start_time;
                hasRecordFirstChunkTime = true;
            }
            if (chunk.type === 'tool-call') {
                onStream?.send(`${messageInfo.content.trimEnd()}\n\ntool call start: \`${chunk.toolName}\``);
                log.info(`start tool: ${chunk.toolName}`);
            }
        },

        onStepFinish: async ({ text, toolResults, usage, request, response }: StepResult<any>) => {
            log.info('llm request end');
            log.info(`[onStepFinish] text: "${text}", text length: ${text?.length || 0}, toolResults count: ${toolResults.length}`);
            log.debug('step raw request:', request);

            record.end_time = Date.now();

            if (toolResults.length > 0) {
                const uniqueResults = toolResults.filter((result, index, self) =>
                    index === self.findIndex(r => r.toolCallId === result.toolCallId),
                );
                if (uniqueResults.length < toolResults.length) {
                    log.warn(`Deduplicated ${toolResults.length - uniqueResults.length} duplicate tool calls`);
                }
                await handleToolResult({ toolResults: uniqueResults as any, onStream, config });
            }

            if (toolResults.length > 0) {
                const funcLogs = toolResults.map(({ toolName, input, output }: { toolName: string; input: any; output: any }) => {
                    const hasContent = output && typeof output === 'object' && 'content' in output;
                    const hasValue = output && typeof output === 'object' && 'value' in output;
                    const hasResult = output && typeof output === 'object' && 'result' in output;

                    let hasError = false;
                    if (hasContent && Array.isArray(output.content)) {
                        hasError = output.content.some((i: any) => i.is_error);
                    } else if (hasValue && Array.isArray(output.value?.content)) {
                        hasError = output.value.content.some((i: any) => i.type === 'error');
                    }

                    const inputValues = Object.values(input as any);
                    const hasInput = inputValues.length > 0;

                    let resultPreview;
                    if (hasResult && output?.result != null) {
                        if (typeof output.result === 'string' && output.result.length > 0) {
                            resultPreview = output.result.length > 50
                                ? `${output.result.substring(0, 50)}...`
                                : output.result;
                        } else if (typeof output.result !== 'string') {
                            resultPreview = output.result;
                        }
                    }

                    return {
                        name: toolName,
                        ...(hasInput && { args: inputValues }),
                        ...(resultPreview && { result_preview: resultPreview }),
                        ...(hasError && { error: 'Tool execution error' }),
                        ...(output?.time && { time: output.time }),
                    };
                });

                record.functions.push(...funcLogs);
                toolResults.forEach(({ output }: any) => output?.time && (delete output.time));

                log.info(`tool details: ${JSON.stringify(funcLogs, null, 2)}`);
                log.debug(`tool results: ${JSON.stringify(toolResults, null, 2)}`);

                const toolNames = [...new Set(toolResults.map(i => i.toolName))];
                log.info(`finish tools: ${toolNames}`);
            }

            if (text && text.trim()) {
                log.info(`Final response text length: ${text.length}`);
            }

            if (usage && usage.inputTokens && usage.outputTokens) {
                record.tokens = {
                    prompt: usage.inputTokens,
                    completion: usage.outputTokens,
                    reasoning: usage.reasoningTokens,
                    cached: usage.cachedInputTokens,
                };
                log.info(`tokens: ${JSON.stringify(usage)}`);
            } else {
                log.warn('usage is none');
            }

            hasRecordFirstChunkTime = false;
            step++;
        },
    };
}

function warpMessages(params: LanguageModelV3CallOptions, activeTools: string[], isResponseApi: boolean, rawSystemPrompt: string | undefined) {
    const { prompt: messages, tools } = params;

    const getSystemContent = () => rawSystemPrompt || 'You are a helpful assistant';

    const trimMessages = (promptMessages: ModelMessage[]) => {
        const modifiedMessages: any[] = [];
        for (const [i, message] of promptMessages.entries()) {
            switch (message.role) {
                case 'system':
                    modifiedMessages.push({
                        role: 'system',
                        content: getSystemContent(),
                    });
                    continue;
                case 'assistant':
                    if (Array.isArray(message.content) && message.content.every(i => i.type !== 'tool-call')) {
                        modifiedMessages.push(message);
                    }
                    continue;
                case 'tool':
                    const previousMessage = promptMessages[i - 1];
                    let text = '';
                    for (const toolResultPart of message.content) {
                        const { toolCallId, toolName, output } = toolResultPart as ToolResultPart;
                        let toolArgs = 'UNKNOWN';
                        if (previousMessage?.role === 'assistant' && (previousMessage?.content as any[])?.some(i => i.type === 'tool-call')) {
                            toolArgs = JSON.stringify((previousMessage?.content as ToolCallPart[])?.find(i => i.toolCallId === toolCallId)?.input) || 'UNKNOWN';
                        }
                        const arrayResult = (output.type === 'execution-denied') ? { error: output.reason || 'Execution denied' } : ('value' in output ? output.value : output);
                        text += `#### [tool \`${toolName}\` invoke detail]\n - args: ${toolArgs}\n - result:\n${JSON.stringify(arrayResult)}\n\n`;
                    }
                    modifiedMessages.push({
                        role: 'user',
                        content: [{ type: 'text', text: `### Please use the following retrieved data to answer my question:\n${text}` }],
                    });
                    continue;
                case 'user':
                    modifiedMessages.push(message);
                    continue;
            }
        }
        return modifiedMessages;
    };

    if (tools && activeTools.length === 0) {
        tools.length = 0;
    }
    if (ENV.MESSAGE_COMPATIBLE) {
        params.prompt = trimMessages(messages);
    } else {
        const systemMessage = messages[0].role === 'system' ? messages[0] : undefined;
        if (systemMessage) {
            systemMessage.content = getSystemContent();
            params.prompt.shift();
        }
        const firstMessage = params.prompt[0];
        const firstIsToolCall = Array.isArray(firstMessage?.content) && firstMessage?.content.some((c: any) => c.type === 'tool-call');
        if (firstIsToolCall) {
            params.prompt.unshift({
                role: 'user',
                content: [{ type: 'text', text: 'Use the tool to answer my question.' }],
            });
        }
        systemMessage && params.prompt.unshift(systemMessage);
    }
    if (isResponseApi) {
        params.prompt = handleResponseApiMessage(messages);
    }
}

function warpModel(model: LanguageModelV3, config: AgentUserConfig, activeTools: string[], toolChoice: ToolChoice, chatModel: string) {
    const mutableModel = model as Writeable<LanguageModelV3>;
    const effectiveModel = (activeTools.length > 0 && toolChoice?.type !== 'none') ? (config.TOOL_MODEL || chatModel) : chatModel;
    if (effectiveModel !== mutableModel.modelId) {
        let newModel: LanguageModelV3 | undefined;
        mutableModel.modelId = newModel?.modelId ?? effectiveModel;
    }
}

export async function warpLLMParams({ messages, model, cache }: { messages: ModelMessage[]; model: LanguageModelV3; cache?: string[] }, context: AgentUserConfig) {
    const userMessage = messages.findLast(m => m.role === 'user')!;
    const userText = Array.isArray(userMessage.content) ? userMessage.content.find(c => c.type === 'text')?.text ?? '' : userMessage.content;
    const { tools = {}, activeToolNames = [] } = await resolveMcpTools(context);

    const activeTools = [...activeToolNames];
    const effectiveTarget = activeTools.length > 0 && context.TOOL_MODEL
        ? resolveLlmTarget(context.TOOL_MODEL, context)
        : {
                agent: getAgentProvider(model),
                modelId: model.modelId,
                useResponsesApi: model.provider.endsWith('.responses'),
            };

    if (effectiveTarget.agent === 'openai' && effectiveTarget.useResponsesApi) {
        const { openai } = await import('@ai-sdk/openai');
        const openaiTools = openai.tools;

        if (context.USE_OPENAI_BUILDIN.includes('webSearch') || context.OPENAI_ENABLE_WEB_SEARCH) {
            const webSearchConfig: any = {
                externalWebAccess: context.OPENAI_WEB_SEARCH_EXTERNAL_ACCESS,
                searchContextSize: context.OPENAI_WEB_SEARCH_CONTEXT_SIZE,
            };
            if (context.OPENAI_WEB_SEARCH_ALLOWED_DOMAINS.length > 0) {
                webSearchConfig.filters = {
                    allowedDomains: context.OPENAI_WEB_SEARCH_ALLOWED_DOMAINS,
                };
            }
            if (context.OPENAI_WEB_SEARCH_USER_LOCATION) {
                const location = context.OPENAI_WEB_SEARCH_USER_LOCATION.trim();
                const parts = location.split(',').map(s => s.trim());
                const isCoordinates = parts.length === 2 && !Number.isNaN(Number(parts[0])) && !Number.isNaN(Number(parts[1]));
                if (!isCoordinates && parts.length >= 1) {
                    webSearchConfig.userLocation = {
                        type: 'approximate' as const,
                        ...(parts.length >= 2 && { city: parts[0], country: parts[1] }),
                        ...(parts.length === 1 && { country: parts[0] }),
                    };
                }
            }
            tools.web_search = openaiTools.webSearch(webSearchConfig);
            activeTools.push('web_search');
        }

        if (context.USE_OPENAI_BUILDIN.includes('codeInterpreter') || context.OPENAI_ENABLE_CODE_INTERPRETER) {
            const config = context.OPENAI_CODE_INTERPRETER_CONTAINER
                ? { container: context.OPENAI_CODE_INTERPRETER_CONTAINER }
                : {};
            tools.code_interpreter = openaiTools.codeInterpreter(config);
            activeTools.push('code_interpreter');
        }

        if (context.USE_OPENAI_BUILDIN.includes('fileSearch') || context.OPENAI_ENABLE_FILE_SEARCH) {
            if (context.OPENAI_FILE_SEARCH_VECTOR_STORES.length > 0) {
                const fileSearchConfig: any = {
                    vectorStoreIds: context.OPENAI_FILE_SEARCH_VECTOR_STORES,
                    maxNumResults: context.OPENAI_FILE_SEARCH_MAX_RESULTS,
                };
                if (context.OPENAI_FILE_SEARCH_SCORE_THRESHOLD > 0) {
                    fileSearchConfig.ranking = {
                        scoreThreshold: context.OPENAI_FILE_SEARCH_SCORE_THRESHOLD,
                    };
                }
                tools.file_search = openaiTools.fileSearch(fileSearchConfig);
                activeTools.push('file_search');
            }
        }

        if (context.USE_OPENAI_BUILDIN.includes('imageGeneration') || context.OPENAI_ENABLE_IMAGE_GENERATION) {
            tools.image_generation = openaiTools.imageGeneration({
                background: context.OPENAI_IMAGE_BACKGROUND,
                inputFidelity: context.OPENAI_IMAGE_INPUT_FIDELITY,
                model: context.OPENAI_IMAGE_MODEL,
                outputCompression: context.OPENAI_IMAGE_OUTPUT_COMPRESSION,
                outputFormat: context.OPENAI_IMAGE_OUTPUT_FORMAT,
                partialImages: context.OPENAI_IMAGE_PARTIAL_IMAGES,
                quality: context.OPENAI_IMAGE_QUALITY,
                size: context.OPENAI_IMAGE_SIZE,
            });
            activeTools.push('image_generation');
        }

        if (context.USE_OPENAI_BUILDIN.includes('mcp') || context.OPENAI_ENABLE_MCP) {
            if (context.OPENAI_MCP_SERVER_LABEL && (context.OPENAI_MCP_SERVER_URL || context.OPENAI_MCP_CONNECTOR_ID)) {
                const mcpConfig: any = {
                    serverLabel: context.OPENAI_MCP_SERVER_LABEL,
                };

                if (context.OPENAI_MCP_SERVER_URL) {
                    mcpConfig.serverUrl = context.OPENAI_MCP_SERVER_URL;
                }
                if (context.OPENAI_MCP_CONNECTOR_ID) {
                    mcpConfig.connectorId = context.OPENAI_MCP_CONNECTOR_ID;
                }
                if (context.OPENAI_MCP_SERVER_DESCRIPTION) {
                    mcpConfig.serverDescription = context.OPENAI_MCP_SERVER_DESCRIPTION;
                }
                if (context.OPENAI_MCP_ALLOWED_TOOLS.length > 0) {
                    if (context.OPENAI_MCP_ALLOWED_TOOLS_READ_ONLY) {
                        mcpConfig.allowedTools = {
                            readOnly: true,
                            toolNames: context.OPENAI_MCP_ALLOWED_TOOLS,
                        };
                    } else {
                        mcpConfig.allowedTools = context.OPENAI_MCP_ALLOWED_TOOLS;
                    }
                }
                if (context.OPENAI_MCP_AUTHORIZATION) {
                    mcpConfig.authorization = context.OPENAI_MCP_AUTHORIZATION;
                }
                if (Object.keys(context.OPENAI_MCP_HEADERS).length > 0) {
                    mcpConfig.headers = context.OPENAI_MCP_HEADERS;
                }
                if (context.OPENAI_MCP_REQUIRE_APPROVAL === 'always') {
                    mcpConfig.requireApproval = 'always';
                } else if (context.OPENAI_MCP_APPROVAL_TOOL_NAMES.length > 0) {
                    mcpConfig.requireApproval = {
                        never: {
                            toolNames: context.OPENAI_MCP_APPROVAL_TOOL_NAMES,
                        },
                    };
                } else {
                    mcpConfig.requireApproval = 'never';
                }

                tools.mcp = openaiTools.mcp(mcpConfig);
                activeTools.push('mcp');
            }
        }

        if (context.OPENAI_ENABLE_WEB_SEARCH || context.OPENAI_ENABLE_CODE_INTERPRETER || context.OPENAI_ENABLE_FILE_SEARCH || context.OPENAI_ENABLE_IMAGE_GENERATION || context.OPENAI_ENABLE_MCP || context.USE_OPENAI_BUILDIN.length > 0) {
            log.info(`[warpLLMParams] OpenAI server-side tools enabled: ${activeTools.filter(t => OPENAI_PROVIDER_TOOLS.has(t)).join(', ')}`);
        }
    }

    let toolChoice;
    if (activeToolNames.length > 0 && userText) {
        const choiceResult = await wrapToolChoice(activeToolNames, userText);
        if (Array.isArray(userMessage.content)) {
            userMessage.content.find(c => c.type === 'text')!.text = choiceResult.message;
        } else {
            userMessage.content = choiceResult.message;
        }
        toolChoice = choiceResult.toolChoices;
    }

    log.info(`[warpLLMParams] activeTools: ${activeTools}`);

    return {
        model,
        messages,
        cache,
        tools,
        activeTools,
        toolChoice,
        context,
    };
}

export type ToolChoice = { type: 'auto' | 'none' | 'required' } | { type: 'tool'; toolName: string };

async function wrapToolChoice(activeToolAlias: string[], message: string): Promise<{
    message: string;
    toolChoices: ToolChoice[] | [];
}> {
    const toolPrefix = '/t-';
    let text = message.trim();
    const choices = ['auto', 'none', 'required', ...activeToolAlias];
    const toolChoices = [];
    while (true) {
        const toolAlias = choices.find(t => text.startsWith(`${toolPrefix}${t}`)) || '';
        if (toolAlias) {
            text = text.substring(toolPrefix.length + toolAlias.length).trim();
            const choice = ['auto', 'none', 'required'].includes(toolAlias)
                ? { type: toolAlias as 'auto' | 'none' | 'required' }
                : { type: 'tool', toolName: toolAlias };
            toolChoices.push(choice);
        } else {
            break;
        }
    }

    log.info(`All RealtoolChoices: ${JSON.stringify(toolChoices)}`);

    return {
        message: text,
        toolChoices: toolChoices as ToolChoice[],
    };
}

function recordModelLog({ config, model, record }: { config: AgentUserConfig; model: LanguageModelV3; record: LogStruct }) {
    log.info(`provider: ${model.provider}, modelId: ${model.modelId} `);
    record.start_time = Date.now();
    record.model = model.modelId;
    if (config.ENABLE_ALIAS) {
        const mappedModel = config.MAPPING_VALUE.split('|').map(i => i.split(':')).find(([_, value]) => value === model.modelId);
        record.model = mappedModel?.[0] ?? model.modelId;
    }
}

function addCitationLinks(content: string, citations: Array<string | { url_citation?: { title: string; url: string } }>) {
    if (!citations || citations.length === 0) {
        return content;
    }

    if (typeof citations[0] === 'string') {
        let updated = content;
        for (const [i, url] of Object.entries(citations as string[])) {
            updated = updated.replace(new RegExp(`\\[(${+i + 1})\\]`, 'g'), `[[$1\\]](${url})`);
        }
        return updated;
    }

    const sources = (citations as Array<{ url_citation?: { title: string; url: string } }>)
        .map(({ url_citation }) => url_citation)
        .filter((citation): citation is { title: string; url: string } => Boolean(citation))
        .map(({ title, url }) => `- [${title.length > 40 ? `${title.slice(0, 40)}...` : title}](${url})`)
        .join('\n>');
    return sources ? `${content.trimEnd()}\n\n>sources:\n>${sources}` : content;
}

export function metaDataExtractor(metadata: any, provider: string, content: string) {
    if (!metadata || !ENV.ENABLE_SEARCH_SOURCE) {
        return content;
    }

    switch (provider) {
        case 'openai.chat':
        case 'openai.responses':
            return addCitationLinks(content, metadata?.openai?.citations ?? []);
        case 'oailike':
            return addCitationLinks(content, metadata?.pplx?.citations?.length > 0 ? metadata.pplx.citations : (metadata?.openai?.citations ?? []));
        default:
            return content;
    }
}

async function handleToolResult({ toolResults, onStream, config }: { toolResults: ToolResultPart[]; onStream: ChatStreamTextHandler | null; config: AgentUserConfig }) {
    const providerMessageTools = ['image_generation', 'code_interpreter', 'mcp'];

    const needSendResult: ToolResult[] = [];
    for (const { output, toolName } of toolResults) {
        const shouldSend = providerMessageTools.includes(toolName);

        if (shouldSend) {
            if ('value' in output && (output as any).value?.content) {
                needSendResult.push({ content: (output as any).value.content });
            } else if ('result' in output && typeof (output as any).result === 'string') {
                needSendResult.push({
                    content: [{
                        type: 'image',
                        text: '',
                        data_type: 'base64',
                        data: (output as any).result,
                        mimeType: 'image/png',
                    }],
                });
            }
        }
    }
    if (needSendResult.length > 0) {
        const sender = onStream?.sender;
        const toolNames = toolResults.map(i => i.toolName).filter(name => providerMessageTools.includes(name));
        log.info(`start send tool result: ${toolNames.join(', ')}`);
        sender && await sendToolResult(needSendResult, sender, config);
        toolResults.forEach(({ toolName, output }) => {
            const shouldModify = providerMessageTools.includes(toolName);
            const hasError = output.type !== 'execution-denied' && 'value' in output
                && ((output.value as any)?.content ?? []).some((i: any) => i.type === 'error');
            if (shouldModify && !hasError) {
                if (output.type !== 'execution-denied' && 'value' in output) {
                    (output as any).value = { content: [{ type: 'text', text: 'Data has been sent to user already.' }] };
                } else if ('result' in output) {
                    (output as any).result = 'Image has been sent to user already.';
                }
            }
        });
    }
}

function handleResponseApiMessage(messages: LanguageModelV3Prompt) {
    for (const message of messages) {
        if (message.role === 'assistant' && Array.isArray(message.content)) {
            message.content = message.content.filter(i => i.type !== 'reasoning');
        }
    }
    return messages;
}
