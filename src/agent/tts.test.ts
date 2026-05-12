import { describe, expect, it } from 'vitest';
import { resolveTTSInstructions, supportsTTSInstructions } from './tts';

function createContext(overrides: Record<string, any> = {}) {
    return {
        OPENAI_TTS_MODEL: 'gpt-4o-mini-tts',
        OPENAI_TTS_PROMPT: '',
        OAILIKE_TTS_MODEL: 'gpt-4o-mini-tts',
        OAILIKE_TTS_PROMPT: '',
        ...overrides,
    } as any;
}

describe('supportsTTSInstructions', () => {
    it('accepts current instruction-capable speech models', () => {
        expect(supportsTTSInstructions('gpt-4o-mini-tts')).toBe(true);
    });

    it('rejects legacy speech models that do not accept instructions', () => {
        expect(supportsTTSInstructions('tts-1')).toBe(false);
        expect(supportsTTSInstructions('tts-1-hd')).toBe(false);
    });
});

describe('resolveTTSInstructions', () => {
    it('prefers an explicit command override over stored prompt instructions', () => {
        const context = createContext({ OPENAI_TTS_PROMPT: 'stored prompt' });

        expect(resolveTTSInstructions('openai', context, { instructions: '  speak softly  ' })).toBe('speak softly');
    });

    it('allows an explicit empty override to suppress stored prompt instructions', () => {
        const context = createContext({ OPENAI_TTS_PROMPT: 'stored prompt' });

        expect(resolveTTSInstructions('openai', context, { instructions: '' })).toBeUndefined();
    });

    it('drops stored prompt instructions for unsupported models', () => {
        const context = createContext({
            OPENAI_TTS_MODEL: 'tts-1',
            OPENAI_TTS_PROMPT: 'stored prompt',
        });

        expect(resolveTTSInstructions('openai', context)).toBeUndefined();
    });

    it('rejects explicit command instructions for unsupported models', () => {
        const context = createContext({ OPENAI_TTS_MODEL: 'tts-1-hd' });

        expect(() => resolveTTSInstructions('openai', context, { instructions: 'narrate dramatically' }))
            .toThrow('TTS instructions are not supported by model tts-1-hd');
    });
});
