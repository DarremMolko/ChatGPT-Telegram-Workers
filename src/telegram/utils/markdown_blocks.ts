import type { InlineNode, MarkdownBlock } from './markdown_types';
import { isDigit, isWhitespaceChar, readLeadingSpaces, stripLeadingSpaces, stripUpToThreeSpaces } from './markdown_chars';
import { parseInlineNodes } from './markdown_inline';
import { EXPANDABLE_QUOTE_MARK } from './render_shared';

export function parseMarkdownDocument(text: string): MarkdownBlock[] {
    const lines = text.split('\n');
    const blocks: MarkdownBlock[] = [];
    let nextQuoteExpandable = false;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        if (line === EXPANDABLE_QUOTE_MARK) {
            nextQuoteExpandable = true;
            continue;
        }

        if (isFenceStartLine(line)) {
            const codeBlock = parseCodeBlock(lines, index);
            blocks.push(codeBlock.block);
            index = codeBlock.endIndex;
            continue;
        }

        if (isQuoteLine(line)) {
            const quoteBlock = parseQuoteBlock(lines, index, nextQuoteExpandable ? true : undefined);
            nextQuoteExpandable = false;
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

function parseQuoteBlock(lines: string[], startIndex: number, expandable?: boolean): { block: MarkdownBlock; endIndex: number } {
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
            ...(expandable ? { expandable } : {}),
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
