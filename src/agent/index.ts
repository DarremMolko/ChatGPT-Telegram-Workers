import type { AgentUserConfig } from '../config/env';
import type { ASRAgent, ChatAgent, ImageAgent, TTSAgent } from './types';
import { ENV } from '../config/env';
import { OpenAI, OpenAIASR, OpenAIImage, OpenAITTS } from './openai';
import { OpenAILike, OpenAILikeASR, OpenAILikeImage, OpenAILikeTTS } from './openailike';

export const CHAT_AGENTS: ChatAgent[] = [
    new OpenAI(),
    new OpenAILike(),
];

export function loadChatLLM(context: AgentUserConfig): ChatAgent {
    for (const llm of CHAT_AGENTS) {
        if (llm.name === context.AI_CHAT_PROVIDER) {
            if (!llm.enable(context)) {
                throw new Error(`Chat agent ${llm.name} api key is not set.`);
            }
            return llm;
        }
    }
    throw new Error(`Chat agent not found: ${context.AI_CHAT_PROVIDER}\nAvailable: ${CHAT_AGENTS.map(i => i.name).join(', ')}`);
}

export const IMAGE_AGENTS: ImageAgent[] = [
    new OpenAIImage(),
    new OpenAILikeImage(),
];

export function loadImageGen(context: AgentUserConfig): ImageAgent {
    for (const imgGen of IMAGE_AGENTS) {
        if (imgGen.name === context.AI_IMAGE_PROVIDER) {
            if (!imgGen.enable(context)) {
                throw new Error(`Image generator ${imgGen.name} api key is not set.`);
            }
            return imgGen;
        }
    }
    throw new Error(`Image generator not found: ${context.AI_IMAGE_PROVIDER}\nAvailable: ${IMAGE_AGENTS.map(i => i.name).join(', ')}`);
}

export const ASR_AGENTS: ASRAgent[] = [
    new OpenAIASR(),
    new OpenAILikeASR(),
];

export function loadASRLLM(context: AgentUserConfig) {
    for (const llm of ASR_AGENTS) {
        if (llm.name === context.AI_ASR_PROVIDER) {
            if (!llm.enable(context)) {
                throw new Error(`ASR agent ${llm.name} api key is not set.`);
            }
            return llm;
        }
    }
    throw new Error(`ASR agent not found: ${context.AI_ASR_PROVIDER}\nAvailable: ${ASR_AGENTS.map(i => i.name).join(', ')}`);
}

export const TTS_AGENTS: TTSAgent[] = [
    new OpenAITTS(),
    new OpenAILikeTTS(),
];

export function loadTTSLLM(context: AgentUserConfig) {
    for (const llm of TTS_AGENTS) {
        if (llm.name === context.AI_TTS_PROVIDER) {
            if (!llm.enable(context)) {
                throw new Error(`TTS agent ${llm.name} api key is not set.`);
            }
            return llm;
        }
    }
    throw new Error(`TTS agent not found: ${context.AI_TTS_PROVIDER}\nAvailable: ${TTS_AGENTS.map(i => i.name).join(', ')}`);
}

export async function customInfo(config: AgentUserConfig): Promise<string> {
    const prompt = config.SYSTEM_INIT_MESSAGE || '';
    const otherInfo = {
        mode: config.CURRENT_MODE,
        prompt: prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt,
        USE_MCP: config.USE_MCP.join(','),
        CONFIGURED_MCP: Object.keys(ENV.MCP_CONFIG).join('|'),
        USE_OPENAI_BUILDIN: config.USE_OPENAI_BUILDIN.join(','),
        CHAT_TRIGGER_PREFIX: ENV.CHAT_TRIGGER_PREFIX,
        MAX_STEPS: config.MAX_STEPS,
        MAX_RETRIES: config.MAX_RETRIES,
        SEND_IMAGE_AS_FILE: ENV.SEND_IMAGE_AS_FILE,
        SUPPORT_PROMPT_ROLE: Object.keys(config.PROMPT).join('|'),
        DISABLE_WEB_PREVIEW: ENV.DISABLE_WEB_PREVIEW,
        TEXT_OUTPUT: config.TEXT_OUTPUT,
        TEXT_HANDLE_TYPE: config.TEXT_HANDLE_TYPE,
        AUDIO_OUTPUT: config.AUDIO_OUTPUT,
        AUDIO_HANDLE_TYPE: config.AUDIO_HANDLE_TYPE,
        AUDIO_TEXT_FORMAT: ENV.AUDIO_TEXT_FORMAT,
        ENABLE_ALIAS: config.ENABLE_ALIAS,
        PARAMS_MODIFIER: config.PARAMS_MODIFIER.join('|'),
        MESSAGE_REPLACER: Object.keys(config.MESSAGE_REPLACER).join('|'),
    };
    return JSON.stringify(otherInfo, null, 2).split('\n').map(line => `\`${line}\``).join('\n');
}

export function blockAgent() {
    const agents = CHAT_AGENTS.filter(item => !ENV.BLOCK_AGENTS.includes(item.name));
    CHAT_AGENTS.length = 0;
    CHAT_AGENTS.push(...agents);
}
