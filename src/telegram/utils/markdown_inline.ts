import type * as Telegram from 'telegram-bot-api-types';
import type { InlineNode } from './markdown_types';
import { isWhitespaceChar, isWordChar } from './markdown_chars';

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
