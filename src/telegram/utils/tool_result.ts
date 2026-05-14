import type { AgentUserConfig } from '../../config/env';
import type { MessageSender } from './send';
import { ENV } from '../../config/env';
import { log } from '../../log/logger';
import { sendImages } from './media';

export type ToolResultType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'resource';

export interface TextToolResultContent {
    type: 'text';
    text: string;
    is_error?: boolean;
}

export interface ResourceToolResultContent {
    type: 'resource';
    resource: {
        uri: string;
        mimeType: string;
        text: string;
    };
}

export interface MediaToolResultContent {
    text: string;
    type: Exclude<ToolResultType, 'text' | 'resource'>;
    data_type: 'base64' | 'url' | 'blob';
    data: string | Blob;
    mimeType: string;
}

type ContentItem = TextToolResultContent | ResourceToolResultContent | MediaToolResultContent;

export interface ToolResult {
    content: Array<Extract<ContentItem, { type: ToolResultType }>>;
}

export async function sendToolResult(toolResult: ToolResult[], sender: MessageSender, config: AgentUserConfig) {
    const record = {
        message_id: sender.context.message_id,
        sentMessageIds: sender.context.sentMessageIds,
    };
    const clearMessageId = () => {
        sender.context.message_id = null;
        sender.context.sentMessageIds = [];
    };

    const collect: { type: ToolResultType; data: Array<Omit<ToolResult['content'][number], 'type'>> }[] = [];
    let index = 0;
    const content = toolResult.map(r => r.content).flat();
    for (const { type, ...result } of content) {
        if (collect[index]?.type === undefined) {
            collect[index] = { type, data: [result] };
        } else if (collect[index].type !== type) {
            collect[++index] = { type, data: [result] };
        } else {
            collect[index].data.push(result);
        }
    }

    const sendStatus = [];
    let sendResp: Response | null = null;
    for (const { type, data } of collect) {
        switch (type) {
            case 'image': {
                try {
                    const imageData = await base64OrUrlToBlob(data as MediaToolResultContent[]);
                    log.info(`[sendToolResult] Sending ${imageData.length} images, total size: ${imageData.reduce((sum, blob) => sum + blob.size, 0)} bytes`);
                    clearMessageId();
                    sendResp = await sendImages({
                        raw: imageData,
                        caption: (data as MediaToolResultContent[]).map(d => d.text),
                    }, ENV.SEND_IMAGE_AS_FILE, sender, config);
                } catch (error) {
                    log.error('[sendToolResult] Failed to send image:', error);
                    throw error;
                }
                break;
            }
            case 'video': {
                const videoData = await base64OrUrlToBlob(data as MediaToolResultContent[]);
                clearMessageId();
                sendResp = await sender.sendMediaGroup(videoData.map((_, i) => ({
                    type: 'video',
                    media: '',
                    caption: (data as MediaToolResultContent[])[i].text,
                    parse_mode: ENV.DEFAULT_PARSE_MODE as any,
                })), videoData.map(item => new File([item], 'video.mp4', { type: 'video/mp4' })));
                break;
            }
            case 'audio': {
                const audioData = await base64OrUrlToBlob(data as MediaToolResultContent[]);
                clearMessageId();
                const resp = await Promise.all(audioData.map((item, i) => sender.sendVoice(item, (data as MediaToolResultContent[])[i].text)));
                sendStatus.push(resp.map(r => r.statusText).join(', '));
                break;
            }
            case 'resource':
                clearMessageId();
                sendResp = await sender.sendRichText((data as ResourceToolResultContent[]).map(d => d.resource.text).join('\n'));
                break;
            case 'text':
            default:
                clearMessageId();
                if (!data.some((item: any) => item.is_error)) {
                    sendResp = await sender.sendRichText((data as TextToolResultContent[]).map(d => d.text).join('\n'));
                }
                break;
        }
        sendResp && sendStatus.push(sendResp.statusText);
    }

    log.info(`tool result send status: ${sendStatus.join(', ')}`);
    sender.context.message_id = record.message_id;
    sender.context.sentMessageIds = record.sentMessageIds;
}

async function base64OrUrlToBlob(data: MediaToolResultContent[]): Promise<Blob[]> {
    const mediaType = data[0].data_type ?? 'url';
    if (mediaType === 'url') {
        return Promise.all(data.map(item => fetch(item.data as string).then(r => r.blob())));
    }
    if (mediaType === 'base64') {
        return Promise.all(data.map((item) => {
            let base64Data = item.data as string;
            if (base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
            }
            return new Blob([Buffer.from(base64Data, 'base64')], { type: item.mimeType });
        }));
    }
    return data.map(item => item.data as Blob);
}
