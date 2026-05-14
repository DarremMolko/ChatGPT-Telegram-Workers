import type * as Telegram from 'telegram-bot-api-types';
import type { RenderedText as CoreRenderedText } from './markdown_core';
import type { ExpandParams } from './render_shared';
import { ENV } from '../../config/env';
import {
    isQuoteLine,
    isWhitespaceChar,
    parseMarkdownDocument,
    renderMarkdownDocumentToTelegram,
    stripBlockquotePrefix,
} from './markdown_core';
import { EXPANDABLE_QUOTE_MARK, SEGMENTATION_MARK } from './render_shared';
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
        transformPipeTables(message, { enabled: ENV.TELEGRAM_RENDER_PIPE_TABLES }).trim(),
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
            text: lines.map(line => line === SEGMENTATION_MARK ? '' : line).join('\n').trim(),
            quoteEntireMessage: false,
            quoteExpandable: expandParams.quoteExpandable,
        };
    }

    const quotedSegments = splitQuotedSegments(lines)
        .map(segment => renderQuotedSegment(segment))
        .filter(segment => segment.length > 0)
        .join('\n\n')
        .trim();

    return {
        text: quotedSegments,
        quoteEntireMessage: false,
        quoteExpandable: expandParams.quoteExpandable,
    };
}

function splitQuotedSegments(lines: string[]): string[][] {
    const segments: string[][] = [[]];
    for (const line of lines) {
        if (line === SEGMENTATION_MARK) {
            if (segments[segments.length - 1].length > 0) {
                segments.push([]);
            }
            continue;
        }
        segments[segments.length - 1].push(isQuoteLine(line) ? stripBlockquotePrefix(line) : line);
    }
    return segments;
}

function renderQuotedSegment(lines: string[]): string {
    const start = findFirstMeaningfulLine(lines);
    if (start === -1) {
        return '';
    }
    const end = findLastMeaningfulLine(lines);
    return lines
        .slice(start, end + 1)
        .map(line => line === EXPANDABLE_QUOTE_MARK ? line : line === '' ? '>' : `> ${line}`)
        .join('\n');
}

function findFirstMeaningfulLine(lines: string[]): number {
    for (let index = 0; index < lines.length; index++) {
        if (lines[index].trim() !== '') {
            return index;
        }
    }
    return -1;
}

function findLastMeaningfulLine(lines: string[]): number {
    for (let index = lines.length - 1; index >= 0; index--) {
        if (lines[index].trim() !== '') {
            return index;
        }
    }
    return -1;
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
