import type * as Telegram from 'telegram-bot-api-types';
import type { ExpandParams } from './render_shared';
import { ENV } from '../../config/env';
import { SEGMENTATION_MARK } from './render_shared';
import { transformPipeTables } from './table_render';

const MAX_CHUNK_SIZE = 4000;
const MIN_BREAK_SEARCH = 2400;

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

interface NormalizedMessage {
    text: string;
    quoteEntireMessage: boolean;
    quoteExpandable: boolean;
}

interface TokenDefinition {
    token: string;
    types: Telegram.MessageEntityType[];
    boundary?: 'word';
}

const ESCAPABLE_CHARS = new Set([
    '\\',
    '`',
    '*',
    '_',
    '{',
    '}',
    '[',
    ']',
    '(',
    ')',
    '#',
    '+',
    '-',
    '.',
    '!',
    '|',
    '~',
    '>',
]);

const INLINE_TOKENS: TokenDefinition[] = [
    { token: '***', types: ['bold', 'italic'] },
    { token: '**', types: ['bold'] },
    { token: '__', types: ['underline'], boundary: 'word' },
    { token: '~~', types: ['strikethrough'] },
    { token: '||', types: ['spoiler'] },
    { token: '*', types: ['italic'] },
    { token: '_', types: ['italic'], boundary: 'word' },
    { token: '~', types: ['strikethrough'] },
];

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
        transformPipeTables(
            message.replace(/<grok:[^>]*>/g, '').replace(/<\/grok:[^>]*>/g, ''),
            { enabled: ENV.TELEGRAM_RENDER_PIPE_TABLES },
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

export function markdownToEntities(input: string, options: Pick<NormalizedMessage, 'quoteEntireMessage' | 'quoteExpandable'> = { quoteEntireMessage: false, quoteExpandable: false }): RenderedText {
    const rendered = parseBlocks(input.split('\n'), options.quoteExpandable);
    if (options.quoteEntireMessage && rendered.text.length > 0) {
        rendered.entities = [
            {
                type: options.quoteExpandable ? 'expandable_blockquote' : 'blockquote',
                offset: 0,
                length: rendered.text.length,
            },
            ...(rendered.entities || []),
        ];
    }
    return finalizeRenderedText(rendered);
}

function normalizeMessage(message: string, expandParams: ExpandParams): NormalizedMessage {
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

function parseBlocks(lines: string[], quoteExpandable: boolean): RenderedText {
    let text = '';
    const entities: Telegram.MessageEntity[] = [];

    for (let index = 0; index < lines.length; index++) {
        const codeBlock = parseCodeBlock(lines, index);
        if (codeBlock) {
            const offset = text.length;
            text += codeBlock.text;
            entities.push(...shiftEntities(codeBlock.entities, offset));
            index = codeBlock.endIndex;
            if (index < lines.length - 1) {
                text += '\n';
            }
            continue;
        }

        const quoteBlock = parseQuoteBlock(lines, index, quoteExpandable);
        if (quoteBlock) {
            const offset = text.length;
            text += quoteBlock.text;
            entities.push(...shiftEntities(quoteBlock.entities, offset));
            index = quoteBlock.endIndex;
            if (index < lines.length - 1) {
                text += '\n';
            }
            continue;
        }

        const line = parseMarkdownLine(lines[index]);
        const offset = text.length;
        text += line.text;
        entities.push(...shiftEntities(line.entities, offset));
        if (index < lines.length - 1) {
            text += '\n';
        }
    }

    return finalizeRenderedText({ text, entities });
}

function parseCodeBlock(lines: string[], startIndex: number): { text: string; entities: Telegram.MessageEntity[]; endIndex: number } | null {
    const trimmed = lines[startIndex].trimStart();
    if (!trimmed.startsWith('```')) {
        return null;
    }

    const language = trimmed.slice(3).trim() || undefined;
    const codeLines: string[] = [];
    let endIndex = startIndex;

    for (let index = startIndex + 1; index < lines.length; index++) {
        if (/^\s*```\s*$/.test(lines[index])) {
            endIndex = index;
            break;
        }
        codeLines.push(lines[index]);
        endIndex = index;
    }

    const text = codeLines.join('\n');
    if (text.length === 0) {
        return { text, entities: [], endIndex };
    }

    return {
        text,
        endIndex,
        entities: [{
            type: 'pre',
            offset: 0,
            length: text.length,
            ...(language ? { language } : {}),
        }],
    };
}

function parseQuoteBlock(lines: string[], startIndex: number, quoteExpandable: boolean): { text: string; entities: Telegram.MessageEntity[]; endIndex: number } | null {
    if (!isBlockquoteLine(lines[startIndex])) {
        return null;
    }

    const quoteLines: string[] = [];
    let endIndex = startIndex;

    for (let index = startIndex; index < lines.length; index++) {
        if (!isBlockquoteLine(lines[index])) {
            break;
        }
        quoteLines.push(stripBlockquotePrefix(lines[index]));
        endIndex = index;
    }

    const inner = parseBlocks(quoteLines, quoteExpandable);
    if (inner.text.length === 0) {
        return { text: inner.text, entities: [], endIndex };
    }

    const rendered = finalizeRenderedText({
        text: inner.text,
        entities: [
            {
                type: quoteExpandable ? 'expandable_blockquote' : 'blockquote',
                offset: 0,
                length: inner.text.length,
            },
            ...(inner.entities || []),
        ],
    });

    return {
        text: rendered.text,
        entities: rendered.entities || [],
        endIndex,
    };
}

function parseMarkdownLine(line: string): RenderedText {
    const headingMatch = /^(\s{0,3})(#{1,6})\s+/.exec(line);
    if (headingMatch) {
        const prefix = `${headingMatch[1]}${headingMatch[2]} `;
        const content = parseInlineContent(line.slice(headingMatch[0].length));
        return finalizeRenderedText({
            text: `${prefix}${content.text}`,
            entities: [
                ...shiftEntities(content.entities, prefix.length),
                ...(content.text.length > 0
                    ? [{
                        type: 'bold',
                        offset: prefix.length,
                        length: content.text.length,
                    } satisfies Telegram.MessageEntity]
                    : []),
            ],
        });
    }

    const bulletMatch = /^(\s*)(?:-|\*)\s+/.exec(line);
    if (bulletMatch) {
        const prefix = `${bulletMatch[1]}• `;
        const content = parseInlineContent(line.slice(bulletMatch[0].length));
        return finalizeRenderedText({
            text: `${prefix}${content.text}`,
            entities: shiftEntities(content.entities, prefix.length),
        });
    }

    const orderedMatch = /^(\s*\d+\.\s+)/.exec(line);
    if (orderedMatch) {
        const content = parseInlineContent(line.slice(orderedMatch[0].length));
        return finalizeRenderedText({
            text: `${orderedMatch[1]}${content.text}`,
            entities: shiftEntities(content.entities, orderedMatch[1].length),
        });
    }

    return finalizeRenderedText(parseInlineContent(line));
}

function parseInlineContent(input: string, startIndex = 0, stopToken?: TokenDefinition | ']'): InlineParseResult {
    let text = '';
    const entities: Telegram.MessageEntity[] = [];
    let index = startIndex;

    while (index < input.length) {
        if (stopToken && matchesStopToken(input, index, stopToken)) {
            return {
                text,
                entities,
                nextIndex: index + (stopToken === ']' ? 1 : stopToken.token.length),
                closed: true,
            };
        }

        if (input[index] === '\\') {
            const decoded = decodeEscapedChar(input, index);
            text += decoded.char;
            index = decoded.nextIndex;
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
            const parsed = parseInlineContent(input, index + token.token.length, token);
            if (parsed.closed && parsed.text.length > 0) {
                const offset = text.length;
                text += parsed.text;
                entities.push(...shiftEntities(parsed.entities, offset));
                for (const type of token.types) {
                    entities.push({
                        type,
                        offset,
                        length: parsed.text.length,
                    });
                }
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
    for (let index = startIndex + 1; index < input.length; index++) {
        if (input[index] === '\\') {
            index++;
            continue;
        }
        if (input[index] === '`') {
            return {
                text: input.slice(startIndex + 1, index),
                nextIndex: index + 1,
            };
        }
    }
    return null;
}

function parseLink(input: string, startIndex: number): { text: string; entities: Telegram.MessageEntity[]; url: string; nextIndex: number } | null {
    const label = parseInlineContent(input, startIndex + 1, ']');
    if (!label.closed || input[label.nextIndex] !== '(') {
        return null;
    }

    const urlEnd = findLinkUrlEnd(input, label.nextIndex + 1);
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

function resolveInlineToken(input: string, index: number): TokenDefinition | null {
    for (const token of INLINE_TOKENS) {
        if (matchesToken(input, index, token, false)) {
            return token;
        }
    }
    return null;
}

function matchesStopToken(input: string, index: number, stopToken: TokenDefinition | ']'): boolean {
    if (stopToken === ']') {
        return input[index] === ']';
    }
    return matchesToken(input, index, stopToken, true);
}

function matchesToken(input: string, index: number, token: TokenDefinition, closing: boolean): boolean {
    if (!input.startsWith(token.token, index)) {
        return false;
    }
    if (token.token.length === 1 && (input[index - 1] === token.token || input[index + 1] === token.token)) {
        return false;
    }

    const previousChar = input[index - 1];
    const nextChar = input[index + token.token.length];

    if (closing) {
        if (!previousChar || /\s/.test(previousChar)) {
            return false;
        }
        if (token.boundary === 'word' && isWordChar(nextChar)) {
            return false;
        }
        return true;
    }

    if (!nextChar || /\s/.test(nextChar)) {
        return false;
    }
    if (token.boundary === 'word' && isWordChar(previousChar)) {
        return false;
    }
    return true;
}

function isBlockquoteLine(line: string): boolean {
    return /^\s{0,3}>/.test(line);
}

function stripBlockquotePrefix(line: string): string {
    return line.replace(/^\s{0,3}>\s?/, '');
}

function isWordChar(char?: string): boolean {
    return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function decodeEscapedChar(input: string, startIndex: number): { char: string; nextIndex: number } {
    const nextChar = input[startIndex + 1];
    if (!nextChar) {
        return { char: '\\', nextIndex: startIndex + 1 };
    }
    if (ESCAPABLE_CHARS.has(nextChar)) {
        return { char: nextChar, nextIndex: startIndex + 2 };
    }
    return { char: '\\', nextIndex: startIndex + 1 };
}

function decodeText(input: string): string {
    let text = '';
    for (let index = 0; index < input.length; index++) {
        if (input[index] === '\\') {
            const decoded = decodeEscapedChar(input, index);
            text += decoded.char;
            index = decoded.nextIndex - 1;
            continue;
        }
        text += input[index];
    }
    return text;
}

function findLinkUrlEnd(input: string, openParenIndex: number): number {
    let depth = 1;
    for (let index = openParenIndex + 1; index < input.length; index++) {
        if (input[index] === '\\') {
            index++;
            continue;
        }
        if (input[index] === '(') {
            depth++;
            continue;
        }
        if (input[index] === ')') {
            depth--;
            if (depth === 0) {
                return index;
            }
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
        if (/\s/.test(text[index])) {
            return index + 1;
        }
    }

    return end;
}

function shiftEntities(entities: Telegram.MessageEntity[] | undefined, offset: number): Telegram.MessageEntity[] {
    if (!entities || entities.length === 0) {
        return [];
    }
    if (offset === 0) {
        return entities.map(entity => ({ ...entity }));
    }
    return entities.map(entity => ({
        ...entity,
        offset: entity.offset + offset,
    }));
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
