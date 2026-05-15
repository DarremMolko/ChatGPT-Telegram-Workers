import type { AgentUserConfig } from '../config/env';
import type { LLMChatRequestParams } from './types';

export function messageUsesVisionModel(params?: LLMChatRequestParams): boolean {
    if (!Array.isArray(params?.content)) {
        return false;
    }
    return params.content.some(part => part?.type === 'image' || part?.type === 'file');
}

export function resolveOpenAIChatModel(ctx: AgentUserConfig, params?: LLMChatRequestParams): string {
    return messageUsesVisionModel(params)
        ? ctx.OPENAI_VISION_MODEL
        : ctx.OPENAI_CHAT_MODEL;
}
