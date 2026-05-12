import type { AgentUserConfig } from '../config/env';

type ImageProvider = 'openai' | 'oailike';

export interface OpenAIImageSettings {
    modelId: string;
    n: number;
    size?: string;
    referenceImages?: any[];
    mask?: any;
    isEditMode: boolean;
    generationBody: Record<string, any>;
    providerOptions?: {
        openai: Record<string, any>;
    };
}

function configValue(context: AgentUserConfig, provider: ImageProvider, key: string) {
    return context[`${provider.toUpperCase()}_${key}`];
}

function optionalSize(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' && value !== 'auto' ? value : undefined;
}

function isCompressionFormat(value: unknown): value is 'jpeg' | 'webp' {
    return value === 'jpeg' || value === 'webp';
}

export function isOpenAIImageModel(modelId: string): boolean {
    const normalized = modelId.trim().toLowerCase();
    return normalized.startsWith('gpt-image-')
        || normalized.startsWith('dall-e-')
        || normalized.startsWith('chatgpt-image-');
}

export function buildOpenAIImageSettings(provider: ImageProvider, context: AgentUserConfig, extraParams: Record<string, any> = {}): OpenAIImageSettings {
    const modelId = String(extraParams.model || configValue(context, provider, 'IMAGE_MODEL') || '').trim();
    const referenceImages = extraParams.referenceImages as any[] | undefined;
    const mask = extraParams.mask;
    const isEditMode = (referenceImages?.length || 0) > 0 || Boolean(mask);
    const n = Number(extraParams.n ?? 1);
    const size = optionalSize(extraParams.size || configValue(context, provider, 'IMAGE_SIZE'));

    const providerOptions: Record<string, any> = {};
    const generationBody: Record<string, any> = {
        model: modelId,
        n,
    };

    if (size) {
        generationBody.size = size;
    }

    const background = extraParams.background ?? configValue(context, provider, 'IMAGE_BACKGROUND');
    if (background) {
        providerOptions.background = background;
        generationBody.background = background;
    }

    const quality = extraParams.quality ?? configValue(context, provider, 'IMAGE_QUALITY');
    if (quality) {
        providerOptions.quality = quality;
        generationBody.quality = quality;
    }

    const outputFormat = extraParams.outputFormat ?? configValue(context, provider, 'IMAGE_OUTPUT_FORMAT');
    if (outputFormat) {
        providerOptions.outputFormat = outputFormat;
        generationBody.output_format = outputFormat;
    }

    const outputCompression = extraParams.outputCompression ?? configValue(context, provider, 'IMAGE_OUTPUT_COMPRESSION');
    if (outputCompression !== undefined && outputCompression !== null && isCompressionFormat(outputFormat)) {
        providerOptions.outputCompression = outputCompression;
        generationBody.output_compression = outputCompression;
    }

    if (isEditMode) {
        const inputFidelity = extraParams.inputFidelity ?? configValue(context, provider, 'IMAGE_INPUT_FIDELITY');
        if (inputFidelity) {
            providerOptions.inputFidelity = inputFidelity;
        }
    } else {
        const moderation = extraParams.moderation ?? configValue(context, provider, 'IMAGE_MODERATION');
        if (moderation) {
            providerOptions.moderation = moderation;
            generationBody.moderation = moderation;
        }
    }

    return {
        modelId,
        n,
        size,
        referenceImages,
        mask,
        isEditMode,
        generationBody,
        ...(Object.keys(providerOptions).length > 0 ? { providerOptions: { openai: providerOptions } } : {}),
    };
}
