import type * as Telegram from 'telegram-bot-api-types';
import type { RenderedText as CoreRenderedText } from './markdown_core';
import type { ExpandParams } from './render_shared';
import { ENV } from '../../config/env';
import { parseMarkdownDocument, renderMarkdownDocumentToTelegram } from './markdown_core';
import { SEGMENTATION_MARK } from './render_shared';
import { transformPipeTables } from './table_render';

const MAX_CHUNK_SIZE = 4000;
const MIN_BREAK_SEARCH = 2400;

export interface RenderedText extends CoreRenderedText {
    useEntities?: boolean;
}

export function renderSingleMessage(
    parseMode: Telegram.ParseMode | null,
    message: string,
    expandParams: ExpandParams = { addQuote: false, quoteExpandable: false },
): RenderedText {
    return renderMessageChunks(parseMode, message, expandParams)[0] || { text: '', useEntities: parseMode === 'MarkdownV2' };
}

export function renderMessageChunks(
    parseMode: Telegram.ParseMode | null,
    message: string,
    expandParams: ExpandParams = { addQuote: false, quoteExpandable: false },
): RenderedText[] {
    const normalized = normalizeMessage(
        stripGrokTags(
            transformPipeTables(message, { enabled: ENV.TELEGRAM_RENDER_PIPE_TABLES }),
        ).trim(),
        expandParams,
    );

    if (parseMode === 'MarkdownV2') {
        const rendered = markdownToEntities(normalized.text, normalized);
        return splitRenderedText(rendered, MAX_CHUNK_SIZE).map(chunk => ({
            ...chunk,
            useEntities: true,
        }));
    }

    return splitPlainText(normalized.text, MAX_CHUNK_SIZE).map(text => ({ text }));
}

export function markdownToEntities(
    input: string,
    options: { quoteEntireMessage?: boolean; quoteExpandable?: boolean } = { quoteEntireMessage: false, quoteExpandable: false },
): RenderedText {
    return renderMarkdownDocumentToTelegram(parseMarkdownDocument(input), options);
}

function normalizeMessage(message: string, expandParams: ExpandParams): { text: string; quoteEntireMessage: boolean; quoteExpandable: boolean } {
    const lines = message.split('\n');
    if (!expandParams.addQuote) {
        return {
            text: lines.filter(line => line !== SEGMENTATION_MARK).join('\n').trim(),
            quoteEntireMessage: false,
            quoteExpandable: expandParams.quoteExpandable,
        };
    }

    return {
        text: lines.map((line) => {
            if (line === SEGMENTATION_MARK) {
                return '';
            }
            return isBlockquoteLine(line) ? stripBlockquotePrefix(line) : line;
        }).join('\n').trim(),
        quoteEntireMessage: true,
        quoteExpandable: expandParams.quoteExpandable,
    };
}

function stripGrokTags(message: string): string {
    let index = 0;
    let text = '';
    while (index < message.length) {
        if (message.startsWith('<grok:', index) || message.startsWith('</grok:', index)) {
            const closeIndex = message.indexOf('>', index);
            index = closeIndex === -1 ? message.length : closeIndex + 1;
            continue;
        }
        text += message[index];
        index++;
    }
    return text;
}

function isBlockquoteLine(line: string): boolean {
    return stripUpToThreeSpaces(line).startsWith('>');
}

function stripBlockquotePrefix(line: string): string {
    let index = 0;
    while (index < line.length && index < 3 && line[index] === ' ') {
        index++;
    }
    if (line[index] !== '>') {
        return line;
    }
    index++;
    if (line[index] === ' ') {
        index++;
    }
    return line.slice(index);
}

function stripUpToThreeSpaces(line: string): string {
    let index = 0;
    while (index < line.length && index < 3 && line[index] === ' ') {
        index++;
    }
    return line.slice(index);
}

function splitRenderedText(rendered: RenderedText, chunkSize: number): RenderedText[] {
    if (rendered.text.length <= chunkSize) {
        return [finalizeRenderedText(rendered)];
    }

    const chunks: RenderedText[] = [];
    let start = 0;

    while (start < rendered.text.length) {
        let end = Math.min(start + chunkSize, rendered.text.length);
        if (end < rendered.text.length) {
            const breakPoint = findPreferredBreak(rendered.text, start, end);
            if (breakPoint > start) {
                end = breakPoint;
            }
        }
        chunks.push(sliceRenderedText(rendered, start, end));
        start = end;
    }

    return chunks;
}

function sliceRenderedText(rendered: RenderedText, start: number, end: number): RenderedText {
    const text = rendered.text.slice(start, end);
    const entities = (rendered.entities || [])
        .map((entity) => {
            const entityEnd = entity.offset + entity.length;
            const overlapStart = Math.max(start, entity.offset);
            const overlapEnd = Math.min(end, entityEnd);
            if (overlapEnd <= overlapStart) {
                return null;
            }
            return {
                ...entity,
                offset: overlapStart - start,
                length: overlapEnd - overlapStart,
            };
        })
        .filter(Boolean) as Telegram.MessageEntity[];

    return finalizeRenderedText({ text, entities });
}

function splitPlainText(text: string, chunkSize: number): string[] {
    if (text.length <= chunkSize) {
        return [text];
    }

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + chunkSize, text.length);
        if (end < text.length) {
            const breakPoint = findPreferredBreak(text, start, end);
            if (breakPoint > start) {
                end = breakPoint;
            }
        }
        chunks.push(text.slice(start, end));
        start = end;
    }
    return chunks;
}

function findPreferredBreak(text: string, start: number, end: number): number {
    const minIndex = Math.max(start + 1, MIN_BREAK_SEARCH > end - start ? start + 1 : end - MIN_BREAK_SEARCH);
    for (let index = end - 1; index >= minIndex; index--) {
        if (text[index] === '\n') {
            return index + 1;
        }
    }
    for (let index = end - 1; index >= minIndex; index--) {
        if (isWhitespaceChar(text[index])) {
            return index + 1;
        }
    }

    return end;
}

function isWhitespaceChar(char: string | undefined): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

function finalizeRenderedText(rendered: RenderedText): RenderedText {
    const entities = (rendered.entities || [])
        .filter(entity => entity.length > 0)
        .sort((left, right) => left.offset - right.offset || right.length - left.length);

    if (entities.length === 0) {
        return { text: rendered.text };
    }
    return {
        text: rendered.text,
        entities,
    };
}
