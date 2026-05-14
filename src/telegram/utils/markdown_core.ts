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
        | { kind: 'blockquote'; blocks: MarkdownBlock[] }
        | { kind: 'code'; language?: string; text: string }
        | { kind: 'hr' };

export type InlineNode
    = | { kind: 'text'; text: string }
        | { kind: 'code'; text: string }
        | { kind: 'style'; styles: Telegram.MessageEntityType[]; children: InlineNode[] }
        | { kind: 'link'; text: InlineNode[]; url: string; raw: string };

interface InlineParseResult {
    nodes: InlineNode[];
    nextIndex: number;
    closed: boolean;
}

interface InlineToken {
    token: string;
    styles: Telegram.MessageEntityType[];
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

const INLINE_TOKENS: InlineToken[] = [
    { token: '***', styles: ['bold', 'italic'] },
    { token: '**', styles: ['bold'] },
    { token: '__', styles: ['underline'], boundary: 'word' },
    { token: '~~', styles: ['strikethrough'] },
    { token: '||', styles: ['spoiler'] },
    { token: '*', styles: ['italic'] },
    { token: '_', styles: ['italic'], boundary: 'word' },
    { token: '~', styles: ['strikethrough'] },
];

export function parseMarkdownDocument(text: string): MarkdownBlock[] {
    const lines = text.split('\n');
    const blocks: MarkdownBlock[] = [];

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        if (isFenceStartLine(line)) {
            const codeBlock = parseCodeBlock(lines, index);
            blocks.push(codeBlock.block);
            index = codeBlock.endIndex;
            continue;
        }

        if (isQuoteLine(line)) {
            const quoteBlock = parseQuoteBlock(lines, index);
            blocks.push(quoteBlock.block);
            index = quoteBlock.endIndex;
            continue;
        }

        const heading = parseHeadingLine(line);
        if (heading) {
            blocks.push({ kind: 'heading', ...heading });
            continue;
        }

        if (isHorizontalRuleLine(line)) {
            blocks.push({ kind: 'hr' });
            continue;
        }

        const prefixed = parsePrefixedLine(line);
        if (prefixed) {
            blocks.push({ kind: 'prefixed', ...prefixed });
            continue;
        }

        blocks.push({ kind: 'paragraph', content: parseInlineNodes(line).nodes });
    }

    return blocks;
}

export function renderMarkdownDocumentToTelegram(
    blocks: MarkdownBlock[],
    options: { quoteEntireMessage?: boolean; quoteExpandable?: boolean } = {},
): RenderedText {
    const rendered = renderTelegramBlocks(blocks, options.quoteExpandable ?? false);
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

export function renderMarkdownDocumentToTelegraph(blocks: MarkdownBlock[]): TelegraphNode[] {
    return mergeAdjacentNodes(blocks.flatMap(renderTelegraphBlock));
}

export function renderInlineNodesToPlainText(nodes: InlineNode[]): string {
    let text = '';
    for (const node of nodes) {
        text += renderInlineNodeToPlainText(node);
    }
    return text;
}

export function parseInlineNodes(text: string, startIndex = 0, stopToken?: InlineToken | ']'): InlineParseResult {
    let index = startIndex;
    let buffer = '';
    const nodes: InlineNode[] = [];

    const flushBuffer = () => {
        if (buffer.length > 0) {
            nodes.push({ kind: 'text', text: buffer });
            buffer = '';
        }
    };

    while (index < text.length) {
        if (stopToken && matchesStopToken(text, index, stopToken)) {
            flushBuffer();
            return {
                nodes,
                nextIndex: index + (stopToken === ']' ? 1 : stopToken.token.length),
                closed: true,
            };
        }

        if (text[index] === '\\') {
            const escaped = decodeEscapedChar(text, index);
            buffer += escaped.char;
            index = escaped.nextIndex;
            continue;
        }

        if (text[index] === '`') {
            const code = parseInlineCode(text, index);
            if (code) {
                flushBuffer();
                nodes.push({ kind: 'code', text: code.text });
                index = code.nextIndex;
                continue;
            }
        }

        if (text[index] === '[') {
            const link = parseLink(text, index);
            if (link) {
                flushBuffer();
                nodes.push(link.node);
                index = link.nextIndex;
                continue;
            }
        }

        const token = resolveInlineToken(text, index);
        if (token) {
            const parsed = parseInlineNodes(text, index + token.token.length, token);
            if (parsed.closed && hasVisibleInlineContent(parsed.nodes)) {
                flushBuffer();
                nodes.push({
                    kind: 'style',
                    styles: token.styles,
                    children: parsed.nodes,
                });
                index = parsed.nextIndex;
                continue;
            }
        }

        buffer += text[index];
        index++;
    }

    flushBuffer();
    return {
        nodes,
        nextIndex: index,
        closed: false,
    };
}

function renderTelegramBlocks(blocks: MarkdownBlock[], quoteExpandable: boolean): RenderedText {
    let text = '';
    const entities: Telegram.MessageEntity[] = [];

    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (index > 0) {
            text += '\n';
        }
        const offset = text.length;
        const rendered = renderTelegramBlock(block, quoteExpandable);
        text += rendered.text;
        entities.push(...shiftEntities(rendered.entities, offset));
    }

    return { text, entities };
}

function renderTelegramBlock(block: MarkdownBlock, quoteExpandable: boolean): RenderedText {
    switch (block.kind) {
        case 'paragraph':
            return renderTelegramInline(block.content);
        case 'prefixed': {
            const content = renderTelegramInline(block.content);
            return {
                text: `${block.prefix}${content.text}`,
                entities: shiftEntities(content.entities, block.prefix.length),
            };
        }
        case 'heading': {
            const content = renderTelegramInline(block.content);
            return {
                text: `${block.prefix}${content.text}`,
                entities: [
                    ...shiftEntities(content.entities, block.prefix.length),
                    ...(content.text.length > 0
                        ? [{
                            type: 'bold',
                            offset: block.prefix.length,
                            length: content.text.length,
                        } satisfies Telegram.MessageEntity]
                        : []),
                ],
            };
        }
        case 'blockquote': {
            const inner = renderTelegramBlocks(block.blocks, quoteExpandable);
            if (inner.text.length === 0) {
                return { text: '' };
            }
            return {
                text: inner.text,
                entities: [
                    {
                        type: quoteExpandable ? 'expandable_blockquote' : 'blockquote',
                        offset: 0,
                        length: inner.text.length,
                    },
                    ...(inner.entities || []),
                ],
            };
        }
        case 'code': {
            if (block.text.length === 0) {
                return { text: '' };
            }
            return {
                text: block.text,
                entities: [{
                    type: 'pre',
                    offset: 0,
                    length: block.text.length,
                    ...(block.language ? { language: block.language } : {}),
                }],
            };
        }
        case 'hr':
            return { text: '---' };
    }
}

function renderTelegramInline(nodes: InlineNode[]): RenderedText {
    let text = '';
    const entities: Telegram.MessageEntity[] = [];

    for (const node of nodes) {
        const rendered = renderTelegramInlineNode(node);
        if (rendered.text.length === 0) {
            continue;
        }
        const offset = text.length;
        text += rendered.text;
        entities.push(...shiftEntities(rendered.entities, offset));
    }

    return { text, entities };
}

function renderTelegramInlineNode(node: InlineNode): RenderedText {
    switch (node.kind) {
        case 'text':
            return { text: node.text };
        case 'code':
            return {
                text: node.text,
                entities: [{
                    type: 'code',
                    offset: 0,
                    length: node.text.length,
                }],
            };
        case 'style': {
            const rendered = renderTelegramInline(node.children);
            if (rendered.text.length === 0) {
                return { text: '' };
            }
            return {
                text: rendered.text,
                entities: [
                    ...(rendered.entities || []),
                    ...node.styles.map(type => ({
                        type,
                        offset: 0,
                        length: rendered.text.length,
                    } satisfies Telegram.MessageEntity)),
                ],
            };
        }
        case 'link': {
            if (!isSupportedTelegramUrl(node.url)) {
                return { text: node.raw };
            }
            const rendered = renderTelegramInline(node.text);
            if (rendered.text.length === 0) {
                return { text: node.raw };
            }
            return {
                text: rendered.text,
                entities: [
                    ...(rendered.entities || []),
                    {
                        type: 'text_link',
                        offset: 0,
                        length: rendered.text.length,
                        url: node.url,
                    },
                ],
            };
        }
    }
}

function renderTelegraphBlock(block: MarkdownBlock): TelegraphNode[] {
    switch (block.kind) {
        case 'paragraph':
            return [createTelegraphNode('p', renderTelegraphInlineChildren(block.content))];
        case 'prefixed':
            return [createTelegraphNode('p', [block.prefix, ...renderTelegraphInlineChildren(block.content)])];
        case 'heading': {
            const level = block.level <= 2 ? 3 : 4;
            return [createTelegraphNode(`h${level}`, renderTelegraphInlineChildren(block.content))];
        }
        case 'blockquote':
            return [createTelegraphNode('blockquote', renderMarkdownDocumentToTelegraph(block.blocks))];
        case 'code':
            return [{
                tag: 'pre',
                children: [{
                    tag: 'code',
                    attrs: block.language ? { class: block.language } : {},
                    children: [block.text.trim()],
                }],
            }];
        case 'hr':
            return [{ tag: 'hr' }];
    }
}

function renderTelegraphInlineChildren(nodes: InlineNode[]): (TelegraphNode | string)[] {
    const children: (TelegraphNode | string)[] = [];

    for (const node of nodes) {
        children.push(...renderTelegraphInlineNode(node));
    }

    return children;
}

function renderTelegraphInlineNode(node: InlineNode): (TelegraphNode | string)[] {
    switch (node.kind) {
        case 'text':
            return [node.text];
        case 'code':
            return [{
                tag: 'code',
                children: [node.text],
            }];
        case 'style':
            return renderTelegraphStyledNode(node.styles, renderTelegraphInlineChildren(node.children));
        case 'link':
            return [{
                tag: 'a',
                attrs: { href: node.url },
                children: renderTelegraphInlineChildren(node.text),
            }];
    }
}

function renderTelegraphStyledNode(styles: Telegram.MessageEntityType[], children: (TelegraphNode | string)[]): (TelegraphNode | string)[] {
    let output = children;
    for (const style of styles) {
        const tag = styleToTelegraphTag(style);
        if (!tag) {
            continue;
        }
        output = [{
            tag,
            children: output,
        }];
    }
    return output;
}

function styleToTelegraphTag(style: Telegram.MessageEntityType): string | null {
    switch (style) {
        case 'bold':
            return 'strong';
        case 'italic':
            return 'i';
        case 'underline':
            return 'u';
        case 'strikethrough':
            return 's';
        default:
            return null;
    }
}

function createTelegraphNode(tag: string, children: (TelegraphNode | string)[]): TelegraphNode {
    return { tag, children };
}

function mergeAdjacentNodes(nodes: TelegraphNode[]): TelegraphNode[] {
    const merged: TelegraphNode[] = [];
    for (const node of nodes) {
        const last = merged.at(-1);
        if (last && last.tag === node.tag && sameAttrs(last.attrs, node.attrs) && last.children && node.children) {
            last.children.push('\n', ...node.children);
            continue;
        }
        merged.push(node);
    }
    return merged;
}

function sameAttrs(left?: Record<string, any>, right?: Record<string, any>): boolean {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function isFenceStartLine(line: string): boolean {
    return stripLeadingSpaces(line).startsWith('```');
}

function parseCodeBlock(lines: string[], startIndex: number): { block: MarkdownBlock; endIndex: number } {
    const startLine = stripLeadingSpaces(lines[startIndex]);
    const language = startLine.slice(3).trim() || undefined;
    const codeLines: string[] = [];
    let endIndex = startIndex;

    for (let index = startIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        if (isFenceCloseLine(line)) {
            endIndex = index;
            break;
        }
        codeLines.push(line);
        endIndex = index;
    }

    return {
        block: {
            kind: 'code',
            language,
            text: codeLines.join('\n'),
        },
        endIndex,
    };
}

function isFenceCloseLine(line: string): boolean {
    return line.trim() === '```';
}

export function isQuoteLine(line: string): boolean {
    const stripped = stripUpToThreeSpaces(line);
    return stripped.startsWith('>');
}

export function stripBlockquotePrefix(line: string): string {
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

function parseQuoteBlock(lines: string[], startIndex: number): { block: MarkdownBlock; endIndex: number } {
    const quoteLines: string[] = [];
    let endIndex = startIndex;

    for (let index = startIndex; index < lines.length; index++) {
        if (!isQuoteLine(lines[index])) {
            break;
        }
        quoteLines.push(stripBlockquotePrefix(lines[index]));
        endIndex = index;
    }

    return {
        block: {
            kind: 'blockquote',
            blocks: parseMarkdownDocument(quoteLines.join('\n')),
        },
        endIndex,
    };
}

function parseHeadingLine(line: string): { level: number; prefix: string; content: InlineNode[] } | null {
    const { offset, value } = readLeadingSpaces(line, 3);
    let index = offset;
    let level = 0;
    while (index < line.length && line[index] === '#' && level < 6) {
        level++;
        index++;
    }
    if (level === 0 || index >= line.length || !isWhitespaceChar(line[index])) {
        return null;
    }
    while (index < line.length && isWhitespaceChar(line[index])) {
        index++;
    }
    const prefix = `${value}${'#'.repeat(level)} `;
    return {
        level,
        prefix,
        content: parseInlineNodes(line.slice(index)).nodes,
    };
}

function parsePrefixedLine(line: string): { prefix: string; content: InlineNode[] } | null {
    const bullet = parseBulletLine(line);
    if (bullet) {
        return bullet;
    }
    return parseOrderedLine(line);
}

function parseBulletLine(line: string): { prefix: string; content: InlineNode[] } | null {
    const { offset, value } = readLeadingSpaces(line, 3);
    const marker = line[offset];
    if (marker !== '-' && marker !== '*') {
        return null;
    }
    let index = offset + 1;
    if (index >= line.length || !isWhitespaceChar(line[index])) {
        return null;
    }
    while (index < line.length && isWhitespaceChar(line[index])) {
        index++;
    }
    return {
        prefix: `${value}• `,
        content: parseInlineNodes(line.slice(index)).nodes,
    };
}

function parseOrderedLine(line: string): { prefix: string; content: InlineNode[] } | null {
    const { offset, value } = readLeadingSpaces(line, 3);
    let index = offset;
    let hasDigits = false;
    while (index < line.length && isDigit(line[index])) {
        hasDigits = true;
        index++;
    }
    if (!hasDigits || line[index] !== '.') {
        return null;
    }
    index++;
    if (index >= line.length || !isWhitespaceChar(line[index])) {
        return null;
    }
    while (index < line.length && isWhitespaceChar(line[index])) {
        index++;
    }
    return {
        prefix: `${value}${line.slice(offset, index)}`,
        content: parseInlineNodes(line.slice(index)).nodes,
    };
}

function isHorizontalRuleLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed === '---' || trimmed === '***';
}

function resolveInlineToken(input: string, index: number): InlineToken | null {
    for (const token of INLINE_TOKENS) {
        if (matchesToken(input, index, token, false)) {
            return token;
        }
    }
    return null;
}

function matchesStopToken(input: string, index: number, stopToken: InlineToken | ']'): boolean {
    if (stopToken === ']') {
        return input[index] === ']';
    }
    return matchesToken(input, index, stopToken, true);
}

function matchesToken(input: string, index: number, token: InlineToken, closing: boolean): boolean {
    if (!input.startsWith(token.token, index)) {
        return false;
    }
    if (token.token.length === 1 && (input[index - 1] === token.token || input[index + 1] === token.token)) {
        return false;
    }

    const previousChar = input[index - 1];
    const nextChar = input[index + token.token.length];

    if (closing) {
        if (!previousChar || isWhitespaceChar(previousChar)) {
            return false;
        }
        if (token.boundary === 'word' && isWordChar(nextChar)) {
            return false;
        }
        return true;
    }

    if (!nextChar || isWhitespaceChar(nextChar)) {
        return false;
    }
    if (token.boundary === 'word' && isWordChar(previousChar)) {
        return false;
    }
    return true;
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

function parseLink(input: string, startIndex: number): { node: InlineNode & { kind: 'link' }; nextIndex: number } | null {
    const label = parseInlineNodes(input, startIndex + 1, ']');
    if (!label.closed || input[label.nextIndex] !== '(') {
        return null;
    }

    const urlEnd = findLinkUrlEnd(input, label.nextIndex + 1);
    if (urlEnd === -1) {
        return null;
    }

    const url = decodeText(input.slice(label.nextIndex + 1, urlEnd));
    return {
        node: {
            kind: 'link',
            text: label.nodes,
            url,
            raw: input.slice(startIndex, urlEnd + 1),
        },
        nextIndex: urlEnd + 1,
    };
}

function findLinkUrlEnd(input: string, openParenIndex: number): number {
    let depth = 1;
    for (let index = openParenIndex; index < input.length; index++) {
        const char = input[index];
        if (char === '\\') {
            index++;
            continue;
        }
        if (char === '(') {
            depth++;
            continue;
        }
        if (char === ')') {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
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

function isSupportedTelegramUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'tg:';
    } catch {
        return false;
    }
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

function hasVisibleInlineContent(nodes: InlineNode[]): boolean {
    for (const node of nodes) {
        if (node.kind === 'text' && node.text.length > 0) {
            return true;
        }
        if (node.kind === 'code' && node.text.length > 0) {
            return true;
        }
        if (node.kind === 'style' && hasVisibleInlineContent(node.children)) {
            return true;
        }
        if (node.kind === 'link' && (hasVisibleInlineContent(node.text) || node.raw.length > 0)) {
            return true;
        }
    }
    return false;
}

function renderInlineNodeToPlainText(node: InlineNode): string {
    switch (node.kind) {
        case 'text':
        case 'code':
            return node.text;
        case 'style':
            return renderInlineNodesToPlainText(node.children);
        case 'link': {
            const label = renderInlineNodesToPlainText(node.text);
            return label ? `${label} (${node.url})` : node.url;
        }
    }
}

function stripLeadingSpaces(line: string): string {
    let index = 0;
    while (index < line.length && line[index] === ' ') {
        index++;
    }
    return line.slice(index);
}

export function stripUpToThreeSpaces(line: string): string {
    let index = 0;
    while (index < line.length && index < 3 && line[index] === ' ') {
        index++;
    }
    return line.slice(index);
}

function readLeadingSpaces(line: string, limit: number): { offset: number; value: string } {
    let index = 0;
    while (index < line.length && index < limit && line[index] === ' ') {
        index++;
    }
    return {
        offset: index,
        value: line.slice(0, index),
    };
}

export function isWhitespaceChar(char: string | undefined): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

function isDigit(char: string | undefined): boolean {
    if (!char) {
        return false;
    }
    const code = char.charCodeAt(0);
    return code >= 48 && code <= 57;
}

function isWordChar(char: string | undefined): boolean {
    if (!char) {
        return false;
    }
    const code = char.charCodeAt(0);
    return char === '_'
        || (code >= 48 && code <= 57)
        || (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122)
        || code > 127;
}
