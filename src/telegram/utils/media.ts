import type { FilePart, ImagePart, UserModelMessage } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { ASRRequestOptions, ImageResult, TTSRequestOptions } from '../../agent/types';
import type { AgentUserConfig } from '../../config/env';
import type { MessageSender } from './send';
import { loadASRLLM, loadTTSLLM, TTS_AGENTS } from '../../agent';
import { canUseDocumentOcr, extractDocumentText } from '../../agent/document_ocr';
import { ENV } from '../../config/env';
import { getLog, log } from '../../log';
import { imageToBase64String } from '../../utils/image';
import { convertAudio } from '../../utils/others/audio';
import { SEGMENTATION_MARK, wrapExpandableQuote } from './render_shared';

export async function sendImages(img: ImageResult, sendAsFile: boolean, sender: MessageSender, config: AgentUserConfig) {
    if (img.url?.length === 0 && img.raw?.length === 0) {
        return sender.sendPlainText('ERROR: No image found');
    }

    const caption = img.caption?.map(t => t?.slice(0, 800)?.trim()) || [img.text?.slice(0, 800) || ''];
    if ((img.url?.length === 1 || img.raw?.length === 1) && sender.context.message_id) {
        return sender.editMessageMedia({
            type: sendAsFile ? 'document' : 'photo',
            media: img.url?.[0] || '',
            caption: mergeLogMessages(caption[0], config),
        }, ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode, img.raw?.[0] && new File([img.raw[0]], 'image.png', { type: 'image/png' }));
    }
    const medias = (img.url || img.raw)!.map((media: string | Blob, index: number) => ({
        type: sendAsFile ? 'document' : 'photo',
        media: typeof media === 'string' ? media : '',
        caption: caption[index],
        parse_mode: ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode,
    })) as Telegram.InputMedia[];

    if (img.raw && img.raw.length > 0) {
        const files = img.raw.map((_, i) => new File([img.raw![i]], 'image.png', { type: 'image/png' }));
        return sender.sendMediaGroup(medias, files);
    }
    return sender.sendMediaGroup(medias);
}

export async function tts(text: string, config: AgentUserConfig, options?: TTSRequestOptions): Promise<Blob> {
    const agent = loadTTSLLM(config);
    if (!agent) {
        throw new Error(`TTS agent ${config.AI_TTS_PROVIDER} not found, available: ${TTS_AGENTS.map(a => a.name).join(', ')}`);
    }
    return agent.request(text, config, options);
}

export async function stt(audio: Blob, config: AgentUserConfig, options?: ASRRequestOptions) {
    const agent = loadASRLLM(config);
    if (!agent) {
        throw new Error('ASR agent not found');
    }
    if (agent.name === 'oailike') {
        const start = Date.now();
        audio = await convertAudio({ file: audio, target: 'blob' }) as Blob;
        log.info(`transform audio time: ${((Date.now() - start) / 1000).toFixed(2)}s`);
    }
    return agent.request(audio, config, options);
}

export function mergeLogMessages(text: string, config: AgentUserConfig | undefined, { quoteInfo = false }: { quoteInfo?: boolean } = {}): string {
    const content = text.trim();
    if (!config?.ENABLE_SHOWINFO) {
        return content;
    }
    const info = getLog(config).trim();
    if (!info) {
        return content;
    }
    const formattedInfo = quoteInfo
        ? wrapExpandableQuote(info.split('\n').map(line => `> ${line}`).join('\n'), ENV.EXPANDABLE_BANNER)
        : info;
    if (ENV.LOG_POSITION_ON_TOP) {
        return `${formattedInfo}\n${SEGMENTATION_MARK}\n${content}`;
    }
    return `${content}\n${SEGMENTATION_MARK}\n${formattedInfo}`;
}

// MIME type mapping for common file extensions
const MIME_TYPE_MAP: Record<string, string> = {
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    aac: 'audio/aac',
    flac: 'audio/flac',
    // Image
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
};

function getMediaType(url: string, defaultType: string): string {
    const urlWithoutQuery = url.split('?')[0];
    const extension = urlWithoutQuery.split('.').pop()?.toLowerCase() || '';
    const mimeType = MIME_TYPE_MAP[extension] || `${defaultType}/${extension}`;
    log.info(`[getMediaType] extension: ${extension || 'unknown'}, mimeType: ${mimeType}`);
    return mimeType;
}

// v5: Breaking change in file type extraction logic.
// Manual download and explicit MIME type specification are now required.
export async function fileUrlToBase64Message({
    urls,
    type,
    mimeType,
    fileName,
    params,
    AUDIO_HANDLE_TYPE = 'chat',
    text,
}: {
    urls: string[];
    type: string;
    mimeType?: string;
    fileName?: string;
    params: UserModelMessage;
    AUDIO_HANDLE_TYPE: string;
    text: string;
}): Promise<any> {
    async function urlToBase64Message(type = 'image', targetUrls: string[] = urls) {
        log.info(`[urlToBase64Message] type: ${type}, count: ${targetUrls.length}`);
        const responses = await Promise.all(targetUrls.map(url => fetch(url))).then(r => r.filter(r => r.ok));
        const mediaTypes = targetUrls.map(url => getMediaType(url, type));
        log.info(`[urlToBase64Message] mediaTypes: ${JSON.stringify(mediaTypes)}`);
        let files: string[] = [];
        if (!responses.length) {
            throw new Error('Failed to fetch file data');
        }
        if (type === 'image') {
            const imageData = await Promise.all(targetUrls.map(url => imageToBase64String(url)));
            imageData.forEach(({ data, format }, i) => {
                mediaTypes[i] = format;
                files[i] = data;
            });
        }
        if (type === 'audio') {
            files = await Promise.all(responses.map(r => convertAudio({ file: r, target: 'base64' }))) as string[];
        }
        if (type === 'video') {
            files = await Promise.all(responses.map(r => r.arrayBuffer().then(buffer => Buffer.from(buffer).toString('base64'))));
        }
        return files.map((f, i) => ({
            type: type === 'image' || type === 'photo' ? 'image' : 'file',
            [type === 'image' ? 'image' : 'data']: f,
            mediaType: mediaTypes[i],
        })) as unknown as (FilePart | ImagePart)[];
    }
    switch (type) {
        case 'image':
        case 'photo':
        case 'sticker':
        {
            const images = await Promise.all(urls.map(async (url) => {
                const format = url.split('?')[0].split('.').pop()?.toLowerCase();
                const mediaTypePrefix = format === 'webm' ? 'video' : 'image';
                const parts = await urlToBase64Message(mediaTypePrefix, [url]);
                return parts;
            }));
            (params.content as any[]).push(...images.flat());
            break;
        }
        case 'video':
        case 'audio':
        case 'voice':
        {
            const t = type === 'video' ? 'video' : 'audio';
            const isChat = AUDIO_HANDLE_TYPE === 'chat';
            if (isChat || type === 'video') {
                const files = await urlToBase64Message(t);
                (params.content as any[]).push(...files);
            } else {
                const mediaTypes = urls.map(url => getMediaType(url, t));
                const files = await Promise.all(urls.map(async (audio) => {
                    const response = await fetch(audio);
                    if (!response.ok) {
                        throw new Error('Failed to fetch file data');
                    }
                    return new Uint8Array(await response.arrayBuffer());
                }));
                (params.content as any[]).push(...files.map((audio, i) => ({
                    type: 'file' as const,
                    data: audio,
                    mediaType: mediaTypes[i],
                })));
            }
            break;
        }
        case 'text':
        {
            const fileText = await Promise.all(urls.map(url => fetch(url).then(r => r.text()))).then(t => t.join('\n'));
            const fileContext = [
                'The user attached a text file.',
                fileName ? `Filename: ${fileName}` : '',
                mimeType ? `MIME type: ${mimeType}` : '',
                'File contents:',
                fileText,
            ].filter(Boolean).join('\n');
            params.content = [
                {
                    type: 'text',
                    text: [text, fileContext].filter(Boolean).join('\n\n').trim(),
                },
            ];
            break;
        }
        case 'document':
        {
            const supportsNativePdf = mimeType === 'application/pdf';
            const supportsOcr = canUseDocumentOcr(mimeType, fileName);
            if (!supportsNativePdf && !supportsOcr) {
                throw new Error(`Unsupported document type: ${mimeType || fileName || 'unknown'}. This bot accepts PDFs natively and broader document types through DOCUMENT_OCR_PROVIDER.`);
            }
            const [response] = await Promise.all(urls.map(url => fetch(url))).then(r => r.filter(item => item.ok));
            if (!response) {
                throw new Error('Failed to fetch document');
            }
            const documentData = new Uint8Array(await response.arrayBuffer());
            let ocrError: Error | null = null;
            if (supportsOcr) {
                try {
                    const extractedText = await extractDocumentText({
                        data: documentData,
                        mimeType: mimeType || 'application/octet-stream',
                        fileName,
                    });
                    if (extractedText?.trim()) {
                        const fileContext = [
                            supportsNativePdf ? 'The user attached a PDF document.' : 'The user attached a document.',
                            fileName ? `Filename: ${fileName}` : '',
                            `OCR provider: ${ENV.DOCUMENT_OCR_PROVIDER}`,
                            'Extracted text:',
                            extractedText.trim(),
                        ].filter(Boolean).join('\n');
                        params.content = [
                            {
                                type: 'text',
                                text: [text, fileContext].filter(Boolean).join('\n\n').trim(),
                            },
                        ];
                        break;
                    }
                } catch (error) {
                    ocrError = error as Error;
                    if (supportsNativePdf) {
                        log.warn(`[document-ocr] Falling back to native PDF file handling: ${(error as Error).message}`);
                    } else {
                        log.warn(`[document-ocr] OCR extraction failed for ${fileName || mimeType || 'document'}: ${(error as Error).message}`);
                    }
                }
            }
            if (supportsNativePdf) {
                (params.content as any[]).push({
                    type: 'file',
                    data: documentData,
                    mediaType: 'application/pdf',
                    filename: fileName || 'document.pdf',
                });
                break;
            }
            throw new Error(ocrError?.message || `Failed to extract document text from ${fileName || mimeType || 'document'}`);
        }
    }
    return params;
}
