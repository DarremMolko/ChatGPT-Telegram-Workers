import type { AgentUserConfig } from '../config/env';
import type { LLMChatRequestParams } from './types';

export function messageUsesVisionModel(params?: LLMChatRequestParams): boolean {
    if (!Array.isArray(params?.content)) {
        return false;
    }
    return params.content.some(part => part?.type === 'image' || part?.type === 'file');
}

function resolveVisionModel(ctx: AgentUserConfig, provider: 'openai' | 'oailike'): string {
    if (ctx.VISION_MODEL?.trim()) {
        return ctx.VISION_MODEL.trim();
    }
    return provider === 'openai'
        ? ctx.OPENAI_VISION_MODEL
        : ctx.OAILIKE_VISION_MODEL;
}

export function resolveOpenAIChatModel(ctx: AgentUserConfig, params?: LLMChatRequestParams): string {
    return messageUsesVisionModel(params)
        ? resolveVisionModel(ctx, 'openai')
        : ctx.OPENAI_CHAT_MODEL;
}

export function resolveOpenAILikeChatModel(ctx: AgentUserConfig, params?: LLMChatRequestParams): string {
    return messageUsesVisionModel(params)
        ? resolveVisionModel(ctx, 'oailike')
        : ctx.OAILIKE_CHAT_MODEL;
}
