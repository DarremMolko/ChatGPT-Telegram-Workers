import type { ImageModelV3 } from '@ai-sdk/provider';
import type { UserModelMessage } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { ASRAgent, ChatAgent, ChatStreamTextHandler, GeneratedImage, ImageAgent, ImageResult, LLMChatParams, LLMChatRequestParams, ResponseMessage, TTSAgent, TTSRequestOptions } from './types';
import { createOpenAI } from '@ai-sdk/openai';
import { generateImage } from 'ai';
import { Logger } from '../log';
import { base64StringToBlob } from '../utils';
import { buildProviderApiUrl, resolveProviderApiBase } from './api_base';
import { requestText2Image } from './image';
import { createLlmModel } from './llm';
import { warpLLMParams } from './model_middleware';
import { resolveOpenAIChatModel } from './model_selector';
import { buildOpenAIImageSettings, resolveImageEditModel } from './openai_image';
import { createOpenAIStyleHeaders, requestOpenAIStyleSpeech, requestOpenAIStyleTranscription } from './openai_style';
import { requestChatCompletionsV2 } from './request';

function pickOpenAIApiKey(context: AgentUserConfig): string {
    const length = context.OPENAI_API_KEY.length;
    return context.OPENAI_API_KEY[Math.floor(Math.random() * length)];
}

const OPENAI_AUDIO_PROVIDER = {
    provider: 'openai',
    apiKey: pickOpenAIApiKey,
    requireNonEmptyTranscription: true,
    speechDefaults: { speed: 1 },
    transcriptionFilename: 'audio.ogg',
} as const;

export class OpenAIBase {
    readonly name = 'openai';
    readonly enable = (context: AgentUserConfig): boolean => {
        return context.OPENAI_API_KEY.length > 0;
    };

    apikey = pickOpenAIApiKey;
}

export class OpenAI extends OpenAIBase implements ChatAgent {
    readonly modelKey = 'OPENAI_CHAT_MODEL';

    readonly model = (ctx: AgentUserConfig, params?: LLMChatRequestParams): string => {
        return resolveOpenAIChatModel(ctx, params);
    };

    readonly request = async (params: LLMChatParams, context: AgentUserConfig, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string }> => {
        const modelId = this.model(context, params.messages.at(-1) as UserModelMessage);
        const model = await createLlmModel(modelId, context);

        return requestChatCompletionsV2(await warpLLMParams({
            model,
            system: params.system,
            messages: params.messages,
            abortSignal: params.abortSignal,
        }, context), onStream);
    };
}

export class OpenAIImage extends OpenAIBase implements ImageAgent {
    readonly modelKey = 'OPENAI_IMAGE_MODEL';

    model = (ctx: AgentUserConfig): string => {
        return ctx.OPENAI_IMAGE_MODEL;
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
        } = buildOpenAIImageSettings('openai', context, extraParams);

        // 智能选择模型：
        // - 编辑模式：只有 dall-e-2 和 gpt-image-* 支持编辑
        // - 生成模式：使用配置的模型
        const actualModel = isEditMode
            ? resolveImageEditModel('openai', modelId) // dall-e-3 不支持编辑，降级到 dall-e-2
            : modelId;
        const openaiApiBase = resolveProviderApiBase('openai', context).rootURL;

        // 如果是编辑模式，使用新的 AI SDK
        if (isEditMode) {
            // Build prompt
            const generatePrompt = referenceImages && referenceImages.length > 0
                ? { text: prompt, images: referenceImages, ...(mask && { mask }) }
                : prompt;

            const { images } = await generateImage({
                model: createOpenAI({
                    apiKey: this.apikey(context),
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

        // 纯生成模式：保持原有实现
        const url = buildProviderApiUrl('openai', context, '/images/generations');
        const header = createOpenAIStyleHeaders(this.apikey(context), {
            'Content-Type': 'application/json',
        });
        const body: any = {
            prompt,
            ...generationBody,
            model: actualModel,
        };
        return requestText2Image(url, header, body, this.render);
    };

    readonly render = renderImage;
}

export class OpenAIASR extends OpenAIBase implements ASRAgent {
    readonly modelKey = 'OPENAI_STT_MODEL';

    model = (ctx: AgentUserConfig): string => {
        return ctx.OPENAI_STT_MODEL;
    };

    @Logger
    request = async (audio: Blob, context: AgentUserConfig): Promise<string> => {
        return requestOpenAIStyleTranscription(OPENAI_AUDIO_PROVIDER, audio, context);
    };
}

export class OpenAITTS extends OpenAIBase implements TTSAgent {
    readonly modelKey = 'OPENAI_TTS_MODEL';

    model = (ctx: AgentUserConfig): string => {
        return ctx.OPENAI_TTS_MODEL;
    };

    request = async (text: string, context: AgentUserConfig, options?: TTSRequestOptions): Promise<Blob> => {
        return requestOpenAIStyleSpeech(OPENAI_AUDIO_PROVIDER, text, context, options);
    };
}

export async function renderImage(response: Response | GeneratedImage[] | string[], prompt: string): Promise<ImageResult> {
    const resp = response as Response;
    if (!resp.ok)
        throw new Error(await resp.text());
    const respJson = await resp.json();
    if (respJson.error?.message) {
        throw new Error(respJson.error.message);
    }
    const image_type = respJson.data?.[0]?.b64_json ? 'b64' : 'url';
    let data: (string | Blob)[] = [];
    respJson.data?.forEach(({ url, b64_json }: { url: string; b64_json: string }) => data.push(url ?? (b64_json)));
    if (image_type === 'b64') {
        data = await Promise.all(data.map(b64_json => base64StringToBlob(b64_json as string)));
    }
    return { [image_type === 'b64' ? 'raw' : 'url']: data, text: prompt };
};
