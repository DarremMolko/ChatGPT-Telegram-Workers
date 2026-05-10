import type { AgentUserConfig } from '../config/types';

export type AgentProvider = 'openai' | 'oailike';
export type LlmApiMode = 'chat' | 'responses';

const CHAT_COMPLETIONS_PATH = '/chat/completions';
const RESPONSES_PATH = '/responses';

const DEFAULT_LLM_API_MODE: Record<AgentProvider, LlmApiMode> = {
    openai: 'responses',
    oailike: 'chat',
};

export interface ResolvedProviderApiBase {
    llmMode: LlmApiMode;
    llmURL: string;
    rootURL: string;
}

function withoutTrailingSlash(url: string): string {
    return (url || '').trim().replace(/\/+$/, '');
}

function joinPath(baseURL: string, path: string): string {
    return `${withoutTrailingSlash(baseURL)}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveConfiguredApiBase(baseURL: string, defaultMode: LlmApiMode): ResolvedProviderApiBase {
    const normalizedBaseURL = withoutTrailingSlash(baseURL);

    if (normalizedBaseURL.endsWith(CHAT_COMPLETIONS_PATH)) {
        return {
            llmMode: 'chat',
            llmURL: normalizedBaseURL,
            rootURL: normalizedBaseURL.slice(0, -CHAT_COMPLETIONS_PATH.length),
        };
    }

    if (normalizedBaseURL.endsWith(RESPONSES_PATH)) {
        return {
            llmMode: 'responses',
            llmURL: normalizedBaseURL,
            rootURL: normalizedBaseURL.slice(0, -RESPONSES_PATH.length),
        };
    }

    return {
        llmMode: defaultMode,
        llmURL: joinPath(normalizedBaseURL, defaultMode === 'responses' ? RESPONSES_PATH : CHAT_COMPLETIONS_PATH),
        rootURL: normalizedBaseURL,
    };
}

export function resolveProviderApiBase(agent: AgentProvider, context: AgentUserConfig): ResolvedProviderApiBase {
    return resolveConfiguredApiBase(
        String(context[`${agent.toUpperCase()}_API_BASE`] || ''),
        DEFAULT_LLM_API_MODE[agent],
    );
}

export function buildProviderApiUrl(agent: AgentProvider, context: AgentUserConfig, path: string): string {
    return joinPath(resolveProviderApiBase(agent, context).rootURL, path);
}
