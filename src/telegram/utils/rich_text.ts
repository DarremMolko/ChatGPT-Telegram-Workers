import type * as Telegram from 'telegram-bot-api-types';
import type { ExpandParams } from './md2tgmd';
import { ENV } from '../../config/env';
import { chunkDocument, escape } from './md2tgmd';
import { transformPipeTables } from './table_render';

export interface RenderedText {
    text: string;
    entities?: Telegram.MessageEntity[];
    useEntities?: boolean;
}

interface InlineParseResult {
    text: string;
    entities: Telegram.MessageEntity[];
    nextIndex: number;
    closed: boolean;
}

const escapableChars = new Set([
    '*',
    '_',
    '~',
    '|',
    '`',
    '\\',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '>',
    '#',
    '+',
    '-',
    '=',
    '.',
    '!',
    '?',
]);

export function renderSingleMessage(
    parseMode: Telegram.ParseMode | null,
    message: string,
    expandParams?: ExpandParams,
): RenderedText {
    return renderMessageChunks(parseMode, message, expandParams)[0] || { text: '', useEntities: parseMode === 'MarkdownV2' };
}

export function renderMessageChunks(
    parseMode: Telegram.ParseMode | null,
    message: string,
    expandParams?: ExpandParams,
): RenderedText[] {
    const cleanedMessage = transformPipeTables(
        message.replace(/<grok:[^>]*>/g, '').replace(/<\/grok:[^>]*>/g, ''),
        { enabled: ENV.TELEGRAM_RENDER_PIPE_TABLES },
    );
    const chunkMessage = chunkDocument(cleanedMessage);
    if (parseMode === 'MarkdownV2') {
        return chunkMessage.map(lines => ({
            ...markdownV2ToEntities(escape(lines, expandParams)),
            useEntities: true,
        }));
    }
    return chunkMessage.map(text => ({ text }));
}

export function markdownV2ToEntities(input: string): RenderedText {
    const lines = input.split('\n');
    let text = '';
    const entities: Telegram.MessageEntity[] = [];

    for (let index = 0; index < lines.length; index++) {
        const quoteBlock = parseQuoteBlock(lines, index);
        if (quoteBlock) {
            const offset = text.length;
            text += quoteBlock.text;
            if (quoteBlock.text.length > 0) {
                entities.push({
                    type: quoteBlock.expandable ? 'expandable_blockquote' : 'blockquote',
                    offset,
                    length: quoteBlock.text.length,
                });
                entities.push(...shiftEntities(quoteBlock.entities, offset));
            }
            index = quoteBlock.endIndex;
            if (index < lines.length - 1) {
                text += '\n';
            }
            continue;
        }

        const codeBlock = parseCodeBlock(lines, index);
        if (codeBlock) {
            const offset = text.length;
            text += codeBlock.text;
            if (codeBlock.text.length > 0) {
                entities.push({
                    type: 'pre',
                    offset,
                    length: codeBlock.text.length,
                    ...(codeBlock.language ? { language: codeBlock.language } : {}),
                });
            }
            index = codeBlock.endIndex;
            if (index < lines.length - 1) {
                text += '\n';
            }
            continue;
        }

        const parsedLine = parseInlineContent(lines[index]);
        text += parsedLine.text;
        entities.push(...shiftEntities(parsedLine.entities, text.length - parsedLine.text.length));
        if (index < lines.length - 1) {
            text += '\n';
        }
    }

    const normalizedEntities = normalizeEntities(entities);
    return normalizedEntities.length > 0 ? { text, entities: normalizedEntities } : { text };
}

function parseQuoteBlock(lines: string[], startIndex: number): { text: string; entities: Telegram.MessageEntity[]; endIndex: number; expandable: boolean } | null {
    const firstLine = lines[startIndex];
    if (!firstLine.startsWith('>') && !firstLine.startsWith('**>')) {
        return null;
    }

    const quoteLines: string[] = [];
    let expandable = firstLine.startsWith('**>');
    let endIndex = startIndex;

    for (let index = startIndex; index < lines.length; index++) {
        const line = lines[index];
        if (!line.startsWith('>') && !line.startsWith('**>')) {
            break;
        }
        if (line.startsWith('**>')) {
            expandable = true;
            quoteLines.push(line.slice(3));
        } else {
            quoteLines.push(line.slice(1));
        }
        endIndex = index;
    }

    if (expandable && quoteLines.length > 0) {
        quoteLines[quoteLines.length - 1] = quoteLines[quoteLines.length - 1].replace(/\|\|$/, '');
    }

    let text = '';
    const entities: Telegram.MessageEntity[] = [];
    quoteLines.forEach((line, index) => {
        const parsed = parseInlineContent(line);
        const offset = text.length;
        text += parsed.text;
        entities.push(...shiftEntities(parsed.entities, offset));
        if (index < quoteLines.length - 1) {
            text += '\n';
        }
    });

    return { text, entities, endIndex, expandable };
}

function parseCodeBlock(lines: string[], startIndex: number): { text: string; language: string | undefined; endIndex: number } | null {
    const line = lines[startIndex].trimStart();
    if (!line.startsWith('```')) {
        return null;
    }

    const language = line.slice(3).trim() || undefined;
    const codeLines: string[] = [];
    let endIndex = startIndex;

    for (let index = startIndex + 1; index < lines.length; index++) {
        if (lines[index].trim() === '```') {
            endIndex = index;
            return {
                text: decodeCodeBlockContent(codeLines.join('\n')),
                language,
                endIndex,
            };
        }
        codeLines.push(lines[index]);
        endIndex = index;
    }

    return {
        text: decodeCodeBlockContent(codeLines.join('\n')),
        language,
        endIndex,
    };
}

function parseInlineContent(input: string, startIndex = 0, stopToken?: string): InlineParseResult {
    let text = '';
    const entities: Telegram.MessageEntity[] = [];
    let index = startIndex;

    while (index < input.length) {
        if (stopToken && input.startsWith(stopToken, index)) {
            return {
                text,
                entities,
                nextIndex: index + stopToken.length,
                closed: true,
            };
        }

        if (input[index] === '\\') {
            const { char, nextIndex } = decodeEscapedChar(input, index);
            text += char;
            index = nextIndex;
            continue;
        }

        if (input[index] === '`') {
            const code = parseInlineCode(input, index);
            if (code) {
                const offset = text.length;
                text += code.text;
                entities.push({
                    type: 'code',
                    offset,
                    length: code.text.length,
                });
                index = code.nextIndex;
                continue;
            }
        }

        if (input[index] === '[') {
            const link = parseLink(input, index);
            if (link) {
                const offset = text.length;
                text += link.text;
                entities.push(...shiftEntities(link.entities, offset));
                if (link.text.length > 0) {
                    entities.push({
                        type: 'text_link',
                        offset,
                        length: link.text.length,
                        url: link.url,
                    });
                }
                index = link.nextIndex;
                continue;
            }
        }

        const token = resolveInlineToken(input, index);
        if (token) {
            const parsed = parseInlineContent(input, index + token.token.length, token.token);
            if (parsed.closed && parsed.text.length > 0) {
                const offset = text.length;
                text += parsed.text;
                entities.push(...shiftEntities(parsed.entities, offset));
                entities.push({
                    type: token.type,
                    offset,
                    length: parsed.text.length,
                });
                index = parsed.nextIndex;
                continue;
            }
        }

        text += input[index];
        index++;
    }

    return {
        text,
        entities,
        nextIndex: index,
        closed: false,
    };
}

function parseInlineCode(input: string, startIndex: number): { text: string; nextIndex: number } | null {
    const endIndex = findToken(input, '`', startIndex + 1);
    if (endIndex === -1) {
        return null;
    }
    return {
        text: input.slice(startIndex + 1, endIndex),
        nextIndex: endIndex + 1,
    };
}

function parseLink(input: string, startIndex: number): { text: string; entities: Telegram.MessageEntity[]; url: string; nextIndex: number } | null {
    const label = parseInlineContent(input, startIndex + 1, ']');
    if (!label.closed || input[label.nextIndex] !== '(') {
        return null;
    }

    const urlEnd = findToken(input, ')', label.nextIndex + 1);
    if (urlEnd === -1) {
        return null;
    }

    return {
        text: label.text,
        entities: label.entities,
        url: decodeText(input.slice(label.nextIndex + 1, urlEnd)),
        nextIndex: urlEnd + 1,
    };
}

function resolveInlineToken(input: string, index: number): { token: string; type: Telegram.MessageEntityType } | null {
    if (input.startsWith('||', index)) {
        return { token: '||', type: 'spoiler' };
    }
    if (input.startsWith('__', index)) {
        return { token: '__', type: 'underline' };
    }
    if (input[index] === '*') {
        return { token: '*', type: 'bold' };
    }
    if (input[index] === '_') {
        return { token: '_', type: 'italic' };
    }
    if (input[index] === '~') {
        return { token: '~', type: 'strikethrough' };
    }
    return null;
}

function decodeEscapedChar(input: string, startIndex: number): { char: string; nextIndex: number } {
    const nextChar = input[startIndex + 1];
    if (!nextChar) {
        return { char: '\\', nextIndex: startIndex + 1 };
    }
    if (escapableChars.has(nextChar)) {
        return { char: nextChar, nextIndex: startIndex + 2 };
    }
    return { char: '\\', nextIndex: startIndex + 1 };
}

function decodeText(input: string): string {
    let text = '';
    let index = 0;
    while (index < input.length) {
        if (input[index] === '\\') {
            const decoded = decodeEscapedChar(input, index);
            text += decoded.char;
            index = decoded.nextIndex;
            continue;
        }
        text += input[index];
        index++;
    }
    return text;
}

function decodeCodeBlockContent(input: string): string {
    return input.replace(/\\([\\`])/g, '$1');
}

function findToken(input: string, token: string, startIndex: number): number {
    for (let index = startIndex; index < input.length; index++) {
        if (input[index] === '\\') {
            index++;
            continue;
        }
        if (input.startsWith(token, index)) {
            return index;
        }
    }
    return -1;
}

function shiftEntities(entities: Telegram.MessageEntity[], offset: number): Telegram.MessageEntity[] {
    if (offset === 0) {
        return entities.map(entity => ({ ...entity }));
    }
    return entities.map(entity => ({
        ...entity,
        offset: entity.offset + offset,
    }));
}

function normalizeEntities(entities: Telegram.MessageEntity[]): Telegram.MessageEntity[] {
    return entities
        .filter(entity => entity.length > 0)
        .sort((left, right) => left.offset - right.offset || right.length - left.length);
}
