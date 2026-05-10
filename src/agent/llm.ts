/* eslint-disable no-case-declarations */
import type { MetadataExtractor } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { AgentUserConfig } from '../config/types';
import type { AgentProvider } from './api_base';
import { createOpenAI } from '@ai-sdk/openai';
import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible';
import { resolveProviderApiBase } from './api_base';

export type { AgentProvider } from './api_base';

type TaggedLanguageModel = LanguageModelV3 & {
    __agentProvider?: AgentProvider;
};

const AVAILABLE_AGENTS = new Set<AgentProvider>(['openai', 'oailike']);

export function getAgentProvider(model: LanguageModelV3): AgentProvider {
    const taggedProvider = (model as TaggedLanguageModel).__agentProvider;
    if (taggedProvider) {
        return taggedProvider;
    }
    return model.provider.startsWith('oailike') ? 'oailike' : 'openai';
}

function tagAgentProvider<T extends LanguageModelV3>(model: T, agent: AgentProvider): T {
    (model as TaggedLanguageModel).__agentProvider = agent;
    return model;
}

export function resolveLlmTarget(model: string, context: AgentUserConfig): { agent: AgentProvider; modelId: string; useResponsesApi: boolean } {
    let [agent, modelId] = model.includes(':') ? model.trim().split(':') : [context.AI_CHAT_PROVIDER, model];
    if (!AVAILABLE_AGENTS.has(agent as AgentProvider)) {
        modelId = model;
        agent = context.AI_CHAT_PROVIDER;
    }

    if (!modelId) {
        modelId = context[`${agent.toUpperCase()}_CHAT_MODEL`];
        if (!modelId) {
            throw new Error(`Model ${model} not found`);
        }
    }

    const responseMode = resolveProviderApiBase(agent as AgentProvider, context).llmMode;
    return {
        agent: agent as AgentProvider,
        modelId,
        useResponsesApi: responseMode === 'responses',
    };
}

export async function createLlmModel(model: string, context: AgentUserConfig): Promise<LanguageModelV3> {
    const { agent, modelId, useResponsesApi } = resolveLlmTarget(model, context);
    const apiBase = resolveProviderApiBase(agent, context);

    switch (agent) {
        case 'openai': {
            const provider = createOpenAI({
                baseURL: apiBase.rootURL,
                apiKey: context.OPENAI_API_KEY[Math.floor(Math.random() * context.OPENAI_API_KEY.length)],
                fetch: mockFetch(modelId, context, agent),
            });
            return tagAgentProvider(useResponsesApi ? provider.responses(modelId) : provider.chat(modelId), agent);
        }
        case 'oailike':
        default:
            if (useResponsesApi) {
                const provider = createOpenAI({
                    baseURL: apiBase.rootURL,
                    apiKey: context.OAILIKE_API_KEY || undefined,
                    fetch: mockFetch(modelId, context, agent),
                });
                return tagAgentProvider(provider.responses(modelId), agent);
            }
            return tagAgentProvider(new OpenAICompatibleChatLanguageModel(modelId, {
                provider: 'oailike',
                url: () => apiBase.llmURL,
                headers: () => ({
                    Authorization: `Bearer ${context.OAILIKE_API_KEY}`,
                }),
                includeUsage: true,
                metadataExtractor: extraMetadataExtractor(modelId),
                fetch: mockFetch(modelId, context, 'oailike'),
            }), agent);
    }
}

function extraMetadataExtractor(modelId: string): MetadataExtractor | undefined {
    const pplxModelPrefix = 'sonar';
    const type = modelId.startsWith(pplxModelPrefix)
        ? 'pplx'
        : 'openai';
    return {
        extractMetadata: ({ parsedBody }: { parsedBody: unknown }) => {
            const body = parsedBody as Record<string, any>;
            return Promise.resolve({
                [type]: {
                    citations: body.citations || body.choices?.[0]?.delta?.annotations,
                },
            });
        },
        createStreamExtractor: () => {
            const citations: string[] = [];
            return {
                processChunk: (parsedChunk: Record<string, any>) => {
                    if (citations.length > 0) {
                        return;
                    }
                    const chunkCitations = type === 'pplx'
                        ? parsedChunk.citations
                        : parsedChunk.choices?.[0]?.delta?.annotations;
                    if (chunkCitations && chunkCitations.length > 0) {
                        citations.push(...chunkCitations);
                    }
                },
                buildMetadata: () => ({
                    [type]: {
                        citations,
                    },
                }),
            };
        },
    };
}

export function paramsModifier(model: string, options: Record<string, any>, modifier: string[], extraParams: Record<string, Record<string, any>>) {
    const paramsHandler = (paths: string, value: any) => {
        const pathList = paths.split('.');
        let current = options;
        const isLast = (i: number) => i === pathList.length - 1;
        for (let i = 0; i < pathList.length; i++) {
            const key = pathList[i];
            if (isLast(i)) {
                current[key] = value;
            } else {
                if (!current[key]) {
                    current[key] = {};
                }
                current = current[key];
            }
        }
    };

    for (const [models, params] of Object.entries(extraParams)) {
        if (models.split(',').some(m => model.startsWith(m)) || models === '*') {
            Object.entries(params).forEach(([key, value]) => {
                paramsHandler(key, value);
            });
            break;
        }
    }
    if (modifier.length === 0) {
        return options;
    }
    const valueParser = (text: string) => {
        const numericParser = (value: string) => {
            const num = Number(value);
            return !Number.isNaN(num) && Number.isFinite(num) && String(num) === value.trim() ? num : value;
        };
        switch (text) {
            case 'true':
                return true;
            case 'false':
                return false;
            default:
                try {
                    return JSON.parse(text);
                } catch {
                    return numericParser(text);
                }
        }
    };
    for (const item of modifier) {
        const separator = item.indexOf(':');
        if (separator < 0) {
            continue;
        }
        const models = item.slice(0, separator).split(',');
        const values = item.slice(separator + 1).split('|');
        if (models.includes(model)) {
            values.forEach((text) => {
                switch (text[0]) {
                    case '+':
                        const [key, value] = text.slice(1).split('=');
                        options[key] = valueParser(value);
                        break;
                    case '-':
                        options[text.slice(1)] = undefined;
                        break;
                    default:
                        break;
                }
            });
            break;
        }
    }

    return options;
}

interface MockParams {
    modelId: string;
    config: AgentUserConfig;
    provider: string;
    options: Record<string, any>;
}

function mockParams({ modelId, config, provider, options }: MockParams) {
    const extraParams = (config[`${provider.toUpperCase()}_API_EXTRA_PARAMS` as keyof AgentUserConfig] as Record<string, Record<string, any>>) || {};
    const { PARAMS_MODIFIER: modifier } = config;

    if (provider === 'openai') {
        const searchModelRegex = /gpt-4o-(?:mini-)?search/;
        if (searchModelRegex.test(modelId)) {
            options.web_search_options = {};
        }
    }

    return paramsModifier(modelId, options, modifier, extraParams);
}

function mockFetch(modelId: string, config: AgentUserConfig, provider: string) {
    return async (url: RequestInfo | URL, options?: RequestInit) => {
        const init = options || {};
        if (init.body && typeof init.body === 'string') {
            const params = JSON.parse(init.body);
            init.body = JSON.stringify(mockParams({
                modelId,
                config,
                provider,
                options: params,
            }));
        }
        return fetch(url, init);
    };
}
