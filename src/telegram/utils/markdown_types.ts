import type * as Telegram from 'telegram-bot-api-types';

export interface RenderedText {
    text: string;
    entities?: Telegram.MessageEntity[];
}

export interface TelegraphNode {
    tag: string;
    attrs?: Record<string, any>;
    children?: (TelegraphNode | string)[];
}

export type MarkdownBlock
    = | { kind: 'paragraph'; content: InlineNode[] }
        | { kind: 'prefixed'; prefix: string; content: InlineNode[] }
        | { kind: 'heading'; level: number; prefix: string; content: InlineNode[] }
        | { kind: 'blockquote'; blocks: MarkdownBlock[]; expandable?: boolean }
        | { kind: 'code'; language?: string; text: string }
        | { kind: 'hr' };

export type InlineNode
    = | { kind: 'text'; text: string }
        | { kind: 'code'; text: string }
        | { kind: 'style'; styles: Telegram.MessageEntityType[]; children: InlineNode[] }
        | { kind: 'link'; text: InlineNode[]; url: string; raw: string };
