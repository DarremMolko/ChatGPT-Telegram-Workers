import type { OpenAIStyleProviderDescriptor } from './openai_style';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, infoMock } = vi.hoisted(() => ({
    fetchMock: vi.fn(),
    infoMock: vi.fn(),
}));

vi.mock('../log', () => ({
    log: {
        info: infoMock,
    },
}));

vi.stubGlobal('fetch', fetchMock);

const {
    buildOpenAIStyleSpeechBody,
    buildOpenAIStyleTranscriptionFormData,
    createOpenAIStyleHeaders,
    requestOpenAIStyleSpeech,
    requestOpenAIStyleTranscription,
} = await import('./openai_style');

const openaiDescriptor: OpenAIStyleProviderDescriptor = {
    provider: 'openai',
    apiKey: context => context.OPENAI_API_KEY[0],
    requireNonEmptyTranscription: true,
    speechDefaults: { speed: 1 },
    transcriptionFilename: 'audio.ogg',
};

const oailikeDescriptor: OpenAIStyleProviderDescriptor = {
    provider: 'oailike',
    apiKey: context => context.OAILIKE_API_KEY || '',
    transcriptionFilename: 'audio.mp3',
};

function createContext(overrides: Record<string, any> = {}) {
    return {
        OPENAI_API_BASE: 'https://api.openai.com/v1',
        OPENAI_API_KEY: ['sk-openai'],
        OPENAI_STT_EXTRA_PARAMS: { language: 'en' },
        OPENAI_STT_MODEL: 'gpt-4o-mini-transcribe',
        OPENAI_TTS_EXTRA_PARAMS: { style: 'narration' },
        OPENAI_TTS_MODEL: 'gpt-4o-mini-tts',
        OPENAI_TTS_PROMPT: '',
        OPENAI_TTS_VOICE: 'alloy',
        OAILIKE_API_BASE: 'https://compat.example/v1',
        OAILIKE_API_KEY: 'sk-oailike',
        OAILIKE_STT_EXTRA_PARAMS: { temperature: '0' },
        OAILIKE_STT_MODEL: 'whisper-large-v3',
        OAILIKE_TTS_EXTRA_PARAMS: { tone: 'calm' },
        OAILIKE_TTS_MODEL: 'gpt-4o-mini-tts',
        OAILIKE_TTS_PROMPT: '',
        OAILIKE_TTS_VOICE: 'nova',
        ...overrides,
    } as any;
}

beforeEach(() => {
    fetchMock.mockReset();
    infoMock.mockReset();
});

describe('createOpenAIStyleHeaders', () => {
    it('builds bearer headers and merges extra fields', () => {
        expect(createOpenAIStyleHeaders('sk-test', { Accept: 'application/json' })).toEqual({
            Accept: 'application/json',
            Authorization: 'Bearer sk-test',
        });
    });
});

describe('buildOpenAIStyleTranscriptionFormData', () => {
    it('builds a provider-scoped transcription form body', () => {
        const context = createContext();
        const formData = buildOpenAIStyleTranscriptionFormData(openaiDescriptor, new Blob(['audio']), context);

        expect(formData.get('model')).toBe('gpt-4o-mini-transcribe');
        expect(formData.get('language')).toBe('en');
        expect(formData.get('response_format')).toBe('json');
        expect((formData.get('file') as File).name).toBe('audio.ogg');
    });
});

describe('buildOpenAIStyleSpeechBody', () => {
    it('includes provider defaults, config extras, and optional instructions', () => {
        const body = buildOpenAIStyleSpeechBody(openaiDescriptor, 'Narrate this', createContext(), {
            instructions: 'speak slowly',
        });

        expect(body).toEqual({
            input: 'Narrate this',
            instructions: 'speak slowly',
            model: 'gpt-4o-mini-tts',
            response_format: 'opus',
            speed: 1,
            style: 'narration',
            voice: 'alloy',
        });
    });
});

describe('requestOpenAIStyleSpeech', () => {
    it('sends oailike speech requests with provider-specific config and no OpenAI-only defaults', async () => {
        fetchMock.mockResolvedValue(new Response('audio', { status: 200 }));
        const context = createContext();

        const blob = await requestOpenAIStyleSpeech(oailikeDescriptor, 'Hello there', context);

        expect(blob).toBeInstanceOf(Blob);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://compat.example/v1/audio/speech');
        expect(init.headers).toEqual({
            'Authorization': 'Bearer sk-oailike',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(init.body as string)).toEqual({
            input: 'Hello there',
            model: 'gpt-4o-mini-tts',
            response_format: 'opus',
            tone: 'calm',
            voice: 'nova',
        });
    });
});

describe('requestOpenAIStyleTranscription', () => {
    it('returns the parsed transcription text and logs it', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: 'hello world' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        const result = await requestOpenAIStyleTranscription(oailikeDescriptor, new Blob(['audio']), createContext());

        expect(result).toBe('hello world');
        expect(infoMock).toHaveBeenCalledWith('Transcription: hello world');
    });

    it('throws provider error messages from JSON responses', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({
            error: { message: 'bad request' },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(requestOpenAIStyleTranscription(oailikeDescriptor, new Blob(['audio']), createContext()))
            .rejects
            .toThrow('bad request');
    });

    it('keeps OpenAI-style non-empty text validation', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: '' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(requestOpenAIStyleTranscription(openaiDescriptor, new Blob(['audio']), createContext()))
            .rejects
            .toThrow('{"text":""}');
    });
});
