import { describe, expect, it } from 'vitest';
import { createImageFile } from '../utils';
import { buildOpenAIImageSettings, isOpenAIImageModel, resolveImageEditModel } from './openai_image';

const baseContext: any = {
    OPENAI_IMAGE_MODEL: 'gpt-image-2',
    OPENAI_IMAGE_BACKGROUND: 'auto',
    OPENAI_IMAGE_INPUT_FIDELITY: 'low',
    OPENAI_IMAGE_MODERATION: 'low',
    OPENAI_IMAGE_OUTPUT_COMPRESSION: 100,
    OPENAI_IMAGE_OUTPUT_FORMAT: 'png',
    OPENAI_IMAGE_QUALITY: 'high',
    OPENAI_IMAGE_SIZE: 'auto',
    OAILIKE_IMAGE_MODEL: 'gpt-image-2',
    OAILIKE_IMAGE_BACKGROUND: 'transparent',
    OAILIKE_IMAGE_INPUT_FIDELITY: 'high',
    OAILIKE_IMAGE_MODERATION: 'auto',
    OAILIKE_IMAGE_OUTPUT_COMPRESSION: 85,
    OAILIKE_IMAGE_OUTPUT_FORMAT: 'webp',
    OAILIKE_IMAGE_QUALITY: 'medium',
    OAILIKE_IMAGE_SIZE: '1024x1536',
};

describe('isOpenAIImageModel', () => {
    it('recognizes current OpenAI image model ids', () => {
        expect(isOpenAIImageModel('gpt-image-2')).toBe(true);
        expect(isOpenAIImageModel('gpt-image-1.5')).toBe(true);
        expect(isOpenAIImageModel('dall-e-3')).toBe(true);
        expect(isOpenAIImageModel('chatgpt-image-latest')).toBe(true);
        expect(isOpenAIImageModel('sdxl')).toBe(false);
    });
});

describe('buildOpenAIImageSettings', () => {
    it('only remaps edit models for the native OpenAI provider', () => {
        expect(resolveImageEditModel('openai', 'dall-e-3')).toBe('dall-e-2');
        expect(resolveImageEditModel('oailike', 'dall-e-3')).toBe('dall-e-3');
        expect(resolveImageEditModel('oailike', 'vendor/special-edit-model')).toBe('vendor/special-edit-model');
    });

    it('builds current generation params and omits auto-only fields from the request body', () => {
        const settings = buildOpenAIImageSettings('openai', baseContext);

        expect(settings.isEditMode).toBe(false);
        expect(settings.size).toBeUndefined();
        expect(settings.generationBody).toEqual({
            model: 'gpt-image-2',
            n: 1,
            background: 'auto',
            quality: 'high',
            output_format: 'png',
            moderation: 'low',
        });
        expect(settings.providerOptions).toEqual({
            openai: {
                background: 'auto',
                quality: 'high',
                outputFormat: 'png',
                moderation: 'low',
            },
        });
    });

    it('builds edit settings with edit-only provider options', () => {
        const settings = buildOpenAIImageSettings('oailike', baseContext, {
            referenceImages: ['abc123'],
            size: '1536x1024',
        });

        expect(settings.isEditMode).toBe(true);
        expect(settings.size).toBe('1536x1024');
        expect(settings.generationBody).toEqual({
            model: 'gpt-image-2',
            n: 1,
            size: '1536x1024',
            background: 'transparent',
            quality: 'medium',
            output_format: 'webp',
            output_compression: 85,
        });
        expect(settings.providerOptions).toEqual({
            openai: {
                background: 'transparent',
                quality: 'medium',
                outputFormat: 'webp',
                outputCompression: 85,
                inputFidelity: 'high',
            },
        });
    });
});

describe('createImageFile', () => {
    it('preserves the requested output format in generated filenames', () => {
        const file = createImageFile(new Uint8Array([1, 2, 3]), 'webp');

        expect(file).toBeInstanceOf(File);
        expect(file.type).toBe('image/webp');
        expect(file.name).toBe('image.webp');
    });
});
