import type { ImageModelV3 } from '@ai-sdk/provider';
import type { UserModelMessage } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { ASRAgent, ChatAgent, ChatStreamTextHandler, ImageAgent, ImageResult, LLMChatParams, LLMChatRequestParams, ResponseMessage, TTSRequestOptions } from './types';
import { createOpenAI } from '@ai-sdk/openai';
import { generateImage } from 'ai';
import { Logger } from '../log';
import { buildProviderApiUrl, resolveProviderApiBase } from './api_base';
import { requestText2Image } from './image';
import { createLlmModel } from './llm';
import { warpLLMParams } from './model_middleware';
import { renderImage } from './openai';
import { buildOpenAIImageSettings, isOpenAIImageModel } from './openai_image';
import { createOpenAIStyleHeaders, requestOpenAIStyleSpeech, requestOpenAIStyleTranscription } from './openai_style';
import { requestChatCompletionsV2 } from './request';

function resolveOpenAILikeApiKey(context: AgentUserConfig): string {
    return context.OAILIKE_API_KEY || '';
}

const OAILIKE_AUDIO_PROVIDER = {
    provider: 'oailike',
    apiKey: resolveOpenAILikeApiKey,
    transcriptionFilename: 'audio.mp3',
} as const;

export class OpenAILikeBase {
    readonly name = 'oailike';

    readonly enable = (context: AgentUserConfig): boolean => {
        return !!context.OAILIKE_API_KEY;
    };
}

export class OpenAILike extends OpenAILikeBase implements ChatAgent {
    readonly modelKey = 'OAILIKE_CHAT_MODEL';

    readonly enable = (context: AgentUserConfig): boolean => {
        return !!context.OAILIKE_API_KEY;
    };

    readonly model = (ctx: AgentUserConfig, params?: LLMChatRequestParams): string => {
        const msgType = Array.isArray(params?.content) ? params.content.at(-1)?.type : 'text';
        return msgType === 'text' ? ctx.OAILIKE_CHAT_MODEL : ctx.OAILIKE_VISION_MODEL;
    };

    readonly request = async (params: LLMChatParams, context: AgentUserConfig, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string }> => {
        const modelId = this.model(context, params.messages.at(-1) as UserModelMessage);
        const model = await createLlmModel(modelId, context);
        return requestChatCompletionsV2(await warpLLMParams({
            model,
            system: params.system,
            messages: params.messages,
            cache: params.cache,
            abortSignal: params.abortSignal,
        }, context), onStream);
    };
}

export class OpenAILikeImage extends OpenAILikeBase implements ImageAgent {
    readonly modelKey = 'OAILIKE_IMAGE_MODEL';

    model = (ctx: AgentUserConfig): string => {
        return ctx.OAILIKE_IMAGE_MODEL;
    };

    @Logger
    request = async (prompt: string, context: AgentUserConfig, extraParams?: Record<string, any>): Promise<ImageResult> => {
        const {
            modelId,
            n,
            size,
            referenceImages,
            mask,
            isEditMode,
            generationBody,
            providerOptions,
        } = buildOpenAIImageSettings('oailike', context, extraParams);
        const supportsOpenAIImageFlow = isOpenAIImageModel(modelId);

        if (isEditMode) {
            if (!supportsOpenAIImageFlow) {
                throw new Error('Image editing on the oailike provider requires a gpt-image-* or dall-e-* model.');
            }

            const actualModel = modelId === 'dall-e-3' ? 'dall-e-2' : modelId;
            const openaiApiBase = resolveProviderApiBase('oailike', context).rootURL;
            const generatePrompt = referenceImages && referenceImages.length > 0
                ? { text: prompt, images: referenceImages, ...(mask && { mask }) }
                : prompt;

            const { images } = await generateImage({
                model: createOpenAI({
                    apiKey: context.OAILIKE_API_KEY || undefined,
                    baseURL: openaiApiBase,
                }).image(actualModel) as unknown as ImageModelV3,
                prompt: generatePrompt,
                n,
                ...(size ? { size: size as any } : {}),
                ...(providerOptions ? { providerOptions } : {}),
            });

            return {
                raw: images.map(img => new Blob([Buffer.from(img.uint8Array)], { type: 'image/png' })),
                text: prompt,
            };
        }

        const url = buildProviderApiUrl('oailike', context, '/images/generations');
        const header = createOpenAIStyleHeaders(resolveOpenAILikeApiKey(context), {
            'Content-Type': 'application/json',
        });

        if (supportsOpenAIImageFlow) {
            return requestText2Image(url, header, {
                prompt,
                ...generationBody,
                model: modelId,
            }, this.render);
        }

        const body: any = {
            prompt,
            image_size: extraParams?.size || context.OAILIKE_IMAGE_SIZE,
            model: modelId,
            // num_inference_steps: 10,
            batch_size: n,
            ...context.OAILIKE_API_EXTRA_PARAMS,
        };
        return requestText2Image(url, header, body, this.render);
    };

    readonly render = renderImage;
}

export class OpenAILikeASR extends OpenAILikeBase implements ASRAgent {
    readonly modelKey = 'OAILIKE_STT_MODEL';

    model = (ctx: AgentUserConfig): string => {
        return ctx.OAILIKE_STT_MODEL;
    };

    @Logger
    request = async (audio: Blob, context: AgentUserConfig): Promise<string> => {
        return requestOpenAIStyleTranscription(OAILIKE_AUDIO_PROVIDER, audio, context);
    };
}

export class OpenAILikeTTS extends OpenAILikeBase {
    readonly modelKey = 'OAILIKE_TTS_MODEL';

    model = (ctx: AgentUserConfig): string => {
        return ctx.OAILIKE_TTS_MODEL;
    };

    readonly request = async (text: string, context: AgentUserConfig, options?: TTSRequestOptions): Promise<Blob> => {
        return requestOpenAIStyleSpeech(OAILIKE_AUDIO_PROVIDER, text, context, options);
    };
}
