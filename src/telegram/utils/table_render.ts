import { parseInlineNodes, renderInlineNodesToPlainText } from './markdown_core';

interface ParsedTable {
    header: string[];
    rows: string[][];
    alignments: TableAlignment[];
    endIndex: number;
}

type TableAlignment = 'left' | 'center' | 'right' | 'default';

interface ColumnProfile {
    kind: 'index' | 'numeric' | 'path' | 'title' | 'text';
    alignment: TableAlignment;
    minWidth: number;
    maxWidth: number;
}

const MAX_TABLE_WIDTH = 52;
const ELLIPSIS = '…';
const ELLIPSIS_WIDTH = 1;

// Telegram does not currently provide native rendering for pipe tables.
// This transformer converts them into boxed monospace tables.
export function transformPipeTables(text: string, { enabled = true }: { enabled?: boolean } = {}): string {
    if (!enabled || !text.includes('|')) {
        return text;
    }

    const lines = text.split('\n');
    const result: string[] = [];
    let inFence = false;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (isFenceLine(line)) {
            inFence = !inFence;
            result.push(line);
            continue;
        }

        if (!inFence) {
            const table = parseTable(lines, index);
            if (table) {
                result.push(renderTable(table));
                index = table.endIndex;
                continue;
            }
        }

        result.push(line);
    }

    return result.join('\n');
}

function parseTable(lines: string[], startIndex: number): ParsedTable | null {
    const header = parseTableRow(lines[startIndex]);
    if (!header || header.length < 2) {
        return null;
    }

    const separatorLine = lines[startIndex + 1];
    if (!separatorLine) {
        return null;
    }

    if (!isSeparatorRow(separatorLine, header.length)) {
        return null;
    }

    const separator = parseSeparatorRow(separatorLine, header.length);
    if (!separator) {
        return null;
    }

    const rows: string[][] = [];
    let endIndex = startIndex + 1;

    for (let index = startIndex + 2; index < lines.length; index++) {
        const row = parseTableRow(lines[index]);
        if (!row || row.length !== header.length) {
            break;
        }
        rows.push(row);
        endIndex = index;
    }

    if (rows.length === 0) {
        return null;
    }

    return { header, rows, alignments: separator, endIndex };
}

function parseTableRow(line: string): string[] | null {
    const trimmed = line.trim();
    if (trimmed === '' || !trimmed.includes('|')) {
        return null;
    }

    const working = trimOuterPipes(trimmed);
    if (!working.includes('|')) {
        return null;
    }

    const cells: string[] = [];
    let current = '';
    let escaped = false;
    let inCode = false;

    for (const char of working) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            current += char;
            escaped = true;
            continue;
        }
        if (char === '`') {
            inCode = !inCode;
            current += char;
            continue;
        }
        if (char === '|' && !inCode) {
            cells.push(normalizeCell(current));
            current = '';
            continue;
        }
        current += char;
    }

    cells.push(normalizeCell(current));

    return cells.length >= 2 ? cells : null;
}

function trimOuterPipes(line: string): string {
    let output = line;
    if (output.startsWith('|')) {
        output = output.slice(1);
    }
    if (output.endsWith('|')) {
        output = output.slice(0, -1);
    }
    return output;
}

function normalizeCell(cell: string): string {
    let output = '';
    for (let index = 0; index < cell.length; index++) {
        if (cell[index] === '\\' && cell[index + 1] === '|') {
            output += '|';
            index++;
            continue;
        }
        output += cell[index];
    }
    return collapseWhitespace(output.trim());
}

function isSeparatorRow(line: string, expectedCells: number): boolean {
    return parseSeparatorRow(line, expectedCells) !== null;
}

function parseSeparatorRow(line: string, expectedCells: number): TableAlignment[] | null {
    const cells = parseTableRow(line);
    if (!cells || cells.length !== expectedCells) {
        return null;
    }
    const alignments = cells.map((cell) => {
        if (!isSeparatorCell(cell)) {
            return null;
        }
        const hasLeft = cell.startsWith(':');
        const hasRight = cell.endsWith(':');
        if (hasLeft && hasRight) {
            return 'center';
        }
        if (hasLeft) {
            return 'left';
        }
        if (hasRight) {
            return 'right';
        }
        return 'default';
    });
    return alignments.includes(null) ? null : alignments as TableAlignment[];
}

function isSeparatorCell(cell: string): boolean {
    let start = 0;
    let end = cell.length - 1;
    if (cell[start] === ':') {
        start++;
    }
    if (cell[end] === ':') {
        end--;
    }
    if (end - start + 1 < 3) {
        return false;
    }
    for (let index = start; index <= end; index++) {
        if (cell[index] !== '-') {
            return false;
        }
    }
    return true;
}

function renderTable(table: ParsedTable): string {
    const header = table.header.map((cell, index) => sanitizeTableCell(cell) || `Column ${index + 1}`);
    const rows = table.rows.map(row => row.map(cell => sanitizeTableCell(cell)));
    const profiles = header.map((cell, index) => getColumnProfile(cell, rows.map(row => row[index] || ''), table.alignments[index]));
    const widths = fitTableWidths(
        header.map((cell, index) => Math.max(
            measureCellWidth(cell),
            ...rows.map(row => measureCellWidth(row[index] || '')),
        )),
        profiles,
    );
    const clippedHeader = header.map((cell, index) => truncateToWidth(cell, widths[index]));
    const clippedRows = rows.map(row => row.map((cell, index) => truncateToWidth(cell, widths[index])));
    const lines = [
        renderBorder('┌', '┬', '┐', widths),
        renderRow(clippedHeader, widths, profiles.map(profile => profile.alignment)),
        renderBorder('├', '┼', '┤', widths),
        ...clippedRows.map(row => renderRow(row, widths, profiles.map(profile => profile.alignment))),
        renderBorder('└', '┴', '┘', widths),
    ];
    return `\`\`\`text\n${lines.join('\n')}\n\`\`\``;
}

function isFenceLine(line: string): boolean {
    let index = 0;
    while (index < line.length && line[index] === ' ') {
        index++;
    }
    if (line[index] === '>') {
        index++;
        if (line[index] === ' ') {
            index++;
        }
    }
    return line.slice(index).startsWith('```');
}

function sanitizeTableCell(text: string): string {
    return collapseWhitespace(renderInlineNodesToPlainText(parseInlineNodes(text).nodes));
}

function renderBorder(left: string, join: string, right: string, widths: number[]): string {
    return `${left}${widths.map(width => '─'.repeat(width + 2)).join(join)}${right}`;
}

function renderRow(values: string[], widths: number[], alignments: TableAlignment[]): string {
    return `│ ${values.map((value, index) => padCell(value, widths[index], alignments[index])).join(' │ ')} │`;
}

function padCell(value: string, width: number, alignment: TableAlignment): string {
    const cellWidth = measureCellWidth(value);
    const gap = Math.max(0, width - cellWidth);
    switch (alignment) {
        case 'right':
            return `${' '.repeat(gap)}${value}`;
        case 'center': {
            const left = Math.floor(gap / 2);
            const right = gap - left;
            return `${' '.repeat(left)}${value}${' '.repeat(right)}`;
        }
        default:
            return `${value}${' '.repeat(gap)}`;
    }
}

function measureCellWidth(text: string): number {
    let width = 0;
    for (const char of Array.from(text)) {
        width += getDisplayWidth(char);
    }
    return width;
}

function getDisplayWidth(char: string): number {
    if (char === '') {
        return 0;
    }
    if (/\p{Mark}/u.test(char) || char === '\uFE0F') {
        return 0;
    }
    if (/\p{Extended_Pictographic}/u.test(char)) {
        return 2;
    }
    const codePoint = char.codePointAt(0) || 0;
    if (
        codePoint >= 0x1100
        && (
            codePoint <= 0x115F
            || codePoint === 0x2329
            || codePoint === 0x232A
            || (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F)
            || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
            || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
            || (codePoint >= 0xFE10 && codePoint <= 0xFE19)
            || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
            || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
            || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
        )
    ) {
        return 2;
    }
    return 1;
}

function getColumnProfile(header: string, values: string[], alignment: TableAlignment): ColumnProfile {
    const lowerHeader = header.toLowerCase();
    const nonEmptyValues = values.filter(Boolean);
    const numericMatches = nonEmptyValues.filter(value => isNumericLike(value)).length;
    const mostlyNumeric = nonEmptyValues.length > 0 && numericMatches / nonEmptyValues.length >= 0.8;

    if (lowerHeader === '#' || lowerHeader === 'n' || lowerHeader === 'no' || lowerHeader === 'id') {
        return { kind: 'index', alignment: 'right', minWidth: 1, maxWidth: 3 };
    }
    if (alignment === 'right' || mostlyNumeric || /score|upvotes?|downvotes?|comments?|count|points?|age|rank|total/.test(lowerHeader)) {
        return { kind: 'numeric', alignment: 'right', minWidth: 4, maxWidth: 8 };
    }
    if (/subreddit|forum|source/.test(lowerHeader) || nonEmptyValues.every(value => value.startsWith('r/'))) {
        return { kind: 'path', alignment: 'left', minWidth: 8, maxWidth: 12 };
    }
    if (/title|titulo|headline|subject|name/.test(lowerHeader)) {
        return { kind: 'title', alignment: 'left', minWidth: 12, maxWidth: 20 };
    }
    return { kind: 'text', alignment: alignment === 'center' ? 'center' : 'left', minWidth: 6, maxWidth: 14 };
}

function fitTableWidths(widths: number[], profiles: ColumnProfile[]): number[] {
    const fitted = widths.map((width, index) => Math.min(width, profiles[index].maxWidth));
    while (calculateTableWidth(fitted) > MAX_TABLE_WIDTH) {
        const candidateIndex = pickShrinkColumn(fitted, profiles);
        if (candidateIndex === -1) {
            break;
        }
        fitted[candidateIndex]--;
    }
    return fitted;
}

function calculateTableWidth(widths: number[]): number {
    return widths.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1;
}

function pickShrinkColumn(widths: number[], profiles: ColumnProfile[]): number {
    let bestIndex = -1;
    let bestScore = -1;
    for (let index = 0; index < widths.length; index++) {
        const spare = widths[index] - profiles[index].minWidth;
        if (spare <= 0) {
            continue;
        }
        const score = spare * 100 + widths[index];
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }
    return bestIndex;
}

function truncateToWidth(text: string, width: number): string {
    if (measureCellWidth(text) <= width) {
        return text;
    }
    if (width <= ELLIPSIS_WIDTH) {
        return ELLIPSIS;
    }
    let output = '';
    let currentWidth = 0;
    for (const char of Array.from(text)) {
        const charWidth = getDisplayWidth(char);
        if (currentWidth + charWidth > width - ELLIPSIS_WIDTH) {
            break;
        }
        output += char;
        currentWidth += charWidth;
    }
    return `${output.trimEnd()}${ELLIPSIS}`;
}

function isNumericLike(value: string): boolean {
    return /^[\d\s.,%+-]+$/.test(value.trim());
}

function collapseWhitespace(text: string): string {
    let output = '';
    let inSpace = false;
    for (const char of text.trim()) {
        if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v') {
            if (!inSpace) {
                output += ' ';
                inSpace = true;
            }
            continue;
        }
        output += char;
        inSpace = false;
    }
    return output.trim();
}
