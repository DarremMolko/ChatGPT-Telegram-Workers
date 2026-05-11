import type { AgentUserConfig } from '../config/env';
import type { LLMChatRequestParams } from './types';

export function resolveOpenAIChatModel(ctx: AgentUserConfig, params?: LLMChatRequestParams): string {
    const msgType = Array.isArray(params?.content) ? params.content.at(-1)?.type : 'text';
    switch (msgType) {
        case 'image':
        case 'file':
            return ctx.OPENAI_VISION_MODEL;
        default:
            return ctx.OPENAI_CHAT_MODEL;
    }
}
