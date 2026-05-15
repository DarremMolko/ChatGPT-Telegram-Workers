import type { AgentUserConfig } from '../config/env';
import type { AgentProvider } from './api_base';
import type { ASRRequestOptions, TTSRequestOptions } from './types';
import { log } from '../log';
import { buildProviderApiUrl } from './api_base';
import { resolveTTSInstructions } from './tts';

export interface OpenAIStyleProviderDescriptor {
    provider: AgentProvider;
    apiKey: (context: AgentUserConfig) => string;
    transcriptionFilename: string;
    requireNonEmptyTranscription?: boolean;
    speechDefaults?: Record<string, any>;
}

function configValue(context: AgentUserConfig, provider: AgentProvider, key: string) {
    return context[`${provider.toUpperCase()}_${key}`];
}

export function createOpenAIStyleHeaders(apiKey: string, extraHeaders: Record<string, string> = {}): Record<string, string> {
    return {
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
    };
}

export function buildOpenAIStyleTranscriptionFormData(descriptor: OpenAIStyleProviderDescriptor, audio: Blob, context: AgentUserConfig, options?: ASRRequestOptions): FormData {
    const formData = new FormData();
    formData.append('file', audio, descriptor.transcriptionFilename);
    formData.append('model', String(configValue(context, descriptor.provider, 'STT_MODEL') || ''));
    const prompt = options?.prompt?.trim();
    if (prompt) {
        formData.append('prompt', prompt);
    }
    const extraParams = (configValue(context, descriptor.provider, 'STT_EXTRA_PARAMS') || {}) as Record<string, string>;
    Object.entries(extraParams).forEach(([key, value]) => {
        formData.append(key, value);
    });
    formData.append('response_format', 'json');
    return formData;
}

function extractOpenAIStyleErrorMessage(resp: any): string | undefined {
    return resp?.error?.message || resp?.error || resp?.message;
}

function parseOpenAIStyleTranscriptionResponse(descriptor: OpenAIStyleProviderDescriptor, resp: any): string {
    const errorMessage = extractOpenAIStyleErrorMessage(resp);
    if (errorMessage) {
        throw new Error(errorMessage);
    }
    const text = resp?.text;
    const missingText = text === undefined || text === null || (descriptor.requireNonEmptyTranscription && text === '');
    if (missingText) {
        console.error(JSON.stringify(resp));
        throw new Error(JSON.stringify(resp));
    }
    return String(text);
}

export async function requestOpenAIStyleTranscription(descriptor: OpenAIStyleProviderDescriptor, audio: Blob, context: AgentUserConfig, options?: ASRRequestOptions): Promise<string> {
    const url = buildProviderApiUrl(descriptor.provider, context, '/audio/transcriptions');
    const resp = await fetch(url, {
        method: 'POST',
        headers: createOpenAIStyleHeaders(descriptor.apiKey(context), {
            Accept: 'application/json',
        }),
        body: buildOpenAIStyleTranscriptionFormData(descriptor, audio, context, options),
        redirect: 'follow',
    }).then(r => r.json());

    const text = parseOpenAIStyleTranscriptionResponse(descriptor, resp);
    log.info(`Transcription: ${text}`);
    return text;
}

export function buildOpenAIStyleSpeechBody(descriptor: OpenAIStyleProviderDescriptor, text: string, context: AgentUserConfig, options?: TTSRequestOptions): Record<string, any> {
    const instructions = resolveTTSInstructions(descriptor.provider, context, options);
    return {
        model: configValue(context, descriptor.provider, 'TTS_MODEL'),
        input: text,
        voice: configValue(context, descriptor.provider, 'TTS_VOICE'),
        ...(instructions ? { instructions } : {}),
        response_format: 'opus',
        ...(descriptor.speechDefaults || {}),
        ...((configValue(context, descriptor.provider, 'TTS_EXTRA_PARAMS') || {}) as Record<string, any>),
    };
}

export async function requestOpenAIStyleSpeech(descriptor: OpenAIStyleProviderDescriptor, text: string, context: AgentUserConfig, options?: TTSRequestOptions): Promise<Blob> {
    const url = buildProviderApiUrl(descriptor.provider, context, '/audio/speech');
    const resp = await fetch(url, {
        method: 'POST',
        headers: createOpenAIStyleHeaders(descriptor.apiKey(context), {
            'Content-Type': 'application/json',
        }),
        body: JSON.stringify(buildOpenAIStyleSpeechBody(descriptor, text, context, options)),
    });
    if (resp.ok) {
        return resp.blob();
    }
    const body = await resp.text();
    const parsed = tryParseJson(body);
    const detail = extractOpenAIStyleErrorMessage(parsed) || summarizeErrorBody(body);
    throw new Error(detail ? `${resp.status} ${resp.statusText}\n\n${detail}` : `${resp.status} ${resp.statusText}`);
}

function tryParseJson(value: string): unknown | undefined {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function summarizeErrorBody(body: string): string {
    const trimmed = body.trim();
    if (trimmed === '') {
        return '';
    }
    if (trimmed.startsWith('<')) {
        return trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return trimmed;
}
