import type { AgentUserConfig } from '../config/env';
import type { TTSRequestOptions } from './types';

type TTSProviderName = 'openai' | 'oailike';

const UNSUPPORTED_TTS_INSTRUCTION_MODELS = new Set([
    'tts-1',
    'tts-1-hd',
]);

function getTTSModel(provider: TTSProviderName, context: AgentUserConfig): string {
    return provider === 'openai' ? context.OPENAI_TTS_MODEL : context.OAILIKE_TTS_MODEL;
}

function getConfiguredTTSInstructions(provider: TTSProviderName, context: AgentUserConfig): string {
    return provider === 'openai' ? context.OPENAI_TTS_PROMPT : context.OAILIKE_TTS_PROMPT;
}

export function supportsTTSInstructions(model: string): boolean {
    const normalizedModel = model.trim().toLowerCase();
    return normalizedModel !== '' && !UNSUPPORTED_TTS_INSTRUCTION_MODELS.has(normalizedModel);
}

export function resolveTTSInstructions(provider: TTSProviderName, context: AgentUserConfig, options?: TTSRequestOptions): string | undefined {
    const model = getTTSModel(provider, context);
    if (options && 'instructions' in options) {
        const explicitInstructions = options.instructions?.trim() ?? '';
        if (explicitInstructions !== '' && !supportsTTSInstructions(model)) {
            throw new Error(`TTS instructions are not supported by model ${model}`);
        }
        return explicitInstructions || undefined;
    }
    const configuredInstructions = getConfiguredTTSInstructions(provider, context).trim();
    if (configuredInstructions === '' || !supportsTTSInstructions(model)) {
        return undefined;
    }
    return configuredInstructions;
}
