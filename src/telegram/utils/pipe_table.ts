type TableAlignment = 'left' | 'center' | 'right';

interface ParsedTableBlock {
    alignments: TableAlignment[];
    nextIndex: number;
    rows: string[][];
}

const COLUMN_PADDING = 1;
const MAX_COLUMN_WIDTH = 36;
const MAX_TABLE_WIDTH = 72;
const MIN_COLUMN_WIDTH = 4;
const TABLE_DELIMITER_REGEXP = /^:?-{3,}:?$/;
const TABLE_ESCAPE_SENTINEL = '\u0000';

export function renderPipeTablesAsCodeBlocks(text: string): string {
    const lines = text.split('\n');
    const rendered: string[] = [];
    let inCodeBlock = false;

    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim();
        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            rendered.push(lines[index]);
            continue;
        }

        if (inCodeBlock) {
            rendered.push(lines[index]);
            continue;
        }

        const table = parseTableBlock(lines, index);
        if (!table) {
            rendered.push(lines[index]);
            continue;
        }

        rendered.push('```');
        rendered.push(...renderTable(table.rows, table.alignments));
        rendered.push('```');
        index = table.nextIndex - 1;
    }

    return rendered.join('\n');
}

function parseTableBlock(lines: string[], startIndex: number): ParsedTableBlock | null {
    if (startIndex + 1 >= lines.length) {
        return null;
    }

    const header = parseTableRow(lines[startIndex]);
    const delimiter = parseTableRow(lines[startIndex + 1]);
    if (!header || !delimiter || header.length < 2 || header.length !== delimiter.length) {
        return null;
    }

    if (!delimiter.every(cell => TABLE_DELIMITER_REGEXP.test(cell.trim()))) {
        return null;
    }

    const rows = [header];
    const alignments = delimiter.map(parseAlignment);
    let nextIndex = startIndex + 2;

    while (nextIndex < lines.length) {
        const row = parseTableRow(lines[nextIndex]);
        if (!row) {
            break;
        }

        rows.push(normalizeRow(row, header.length));
        nextIndex++;
    }

    return {
        alignments,
        nextIndex,
        rows,
    };
}

function parseTableRow(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('|') || trimmed.startsWith('>')) {
        return null;
    }

    const escapedLine = trimmed.replaceAll('\\|', TABLE_ESCAPE_SENTINEL);
    let cells = escapedLine.split('|').map(cell => cell.replaceAll(TABLE_ESCAPE_SENTINEL, '|').trim());

    if (trimmed.startsWith('|')) {
        cells = cells.slice(1);
    }
    if (trimmed.endsWith('|')) {
        cells = cells.slice(0, -1);
    }

    if (cells.length < 2 || cells.every(cell => cell === '')) {
        return null;
    }

    return cells;
}

function normalizeRow(row: string[], columnCount: number): string[] {
    const normalized = row.slice(0, columnCount);
    while (normalized.length < columnCount) {
        normalized.push('');
    }
    return normalized;
}

function parseAlignment(cell: string): TableAlignment {
    const trimmed = cell.trim();
    const isLeft = trimmed.startsWith(':');
    const isRight = trimmed.endsWith(':');
    if (isLeft && isRight) {
        return 'center';
    }
    if (isRight) {
        return 'right';
    }
    return 'left';
}

function renderTable(rows: string[][], alignments: TableAlignment[]): string[] {
    const columnCount = rows[0].length;
    const widths = resolveColumnWidths(rows, columnCount);
    const table: string[] = [];

    table.push(buildBorder(widths, '┌', '┬', '┐'));
    table.push(...renderRow(rows[0], widths, alignments));
    table.push(buildBorder(widths, '├', '┼', '┤'));

    for (const row of rows.slice(1)) {
        table.push(...renderRow(row, widths, alignments));
    }

    table.push(buildBorder(widths, '└', '┴', '┘'));
    return table;
}

function resolveColumnWidths(rows: string[][], columnCount: number): number[] {
    const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
        const maxWidth = Math.max(...rows.map(row => displayWidth(row[columnIndex] ?? '')));
        return Math.max(MIN_COLUMN_WIDTH, Math.min(maxWidth, MAX_COLUMN_WIDTH));
    });

    let totalWidth = getTableWidth(widths);
    while (totalWidth > MAX_TABLE_WIDTH) {
        const targetIndex = widths.findLastIndex(width => width > MIN_COLUMN_WIDTH);
        if (targetIndex < 0) {
            break;
        }
        widths[targetIndex]--;
        totalWidth = getTableWidth(widths);
    }

    return widths;
}

function getTableWidth(widths: number[]): number {
    return widths.reduce((total, width) => total + width + COLUMN_PADDING * 2 + 1, 1);
}

function buildBorder(widths: number[], left: string, middle: string, right: string): string {
    return left + widths.map(width => '─'.repeat(width + COLUMN_PADDING * 2)).join(middle) + right;
}

function renderRow(row: string[], widths: number[], alignments: TableAlignment[]): string[] {
    const wrappedCells = row.map((cell, index) => wrapCell(cell, widths[index]));
    const rowHeight = Math.max(...wrappedCells.map(lines => lines.length));
    const lines: string[] = [];

    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
        const line = widths.map((width, columnIndex) => {
            const cellLine = wrappedCells[columnIndex][lineIndex] ?? '';
            return ` ${padCell(cellLine, width, alignments[columnIndex])} `;
        }).join('│');
        lines.push(`│${line}│`);
    }

    return lines;
}

function wrapCell(text: string, width: number): string[] {
    const normalized = text.trim();
    if (!normalized) {
        return [''];
    }

    const words = normalized.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (displayWidth(candidate) <= width) {
            current = candidate;
            continue;
        }

        if (current) {
            lines.push(current);
            current = '';
        }

        if (displayWidth(word) <= width) {
            current = word;
            continue;
        }

        const segments = wrapLongToken(word, width);
        lines.push(...segments.slice(0, -1));
        current = segments.at(-1) ?? '';
    }

    if (current) {
        lines.push(current);
    }

    return lines.length ? lines : [''];
}

function wrapLongToken(token: string, width: number): string[] {
    if (displayWidth(token) <= width) {
        return [token];
    }

    const segments: string[] = [];
    let current = '';
    for (const char of token) {
        if (current && displayWidth(current + char) > width) {
            segments.push(current);
            current = char;
            continue;
        }
        current += char;
    }

    if (current) {
        segments.push(current);
    }

    return segments;
}

function padCell(text: string, width: number, alignment: TableAlignment): string {
    const padding = Math.max(0, width - displayWidth(text));
    if (alignment === 'right') {
        return `${' '.repeat(padding)}${text}`;
    }
    if (alignment === 'center') {
        const leftPadding = Math.floor(padding / 2);
        const rightPadding = padding - leftPadding;
        return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
    }
    return `${text}${' '.repeat(padding)}`;
}

function displayWidth(text: string): number {
    let width = 0;
    for (const char of text) {
        width += characterWidth(char);
    }
    return width;
}

function characterWidth(char: string): number {
    const codePoint = char.codePointAt(0);
    if (!codePoint || codePoint === 0x200D || codePoint === 0xFE0E || codePoint === 0xFE0F || /\p{Mark}/u.test(char)) {
        return 0;
    }

    if (isFullWidthCodePoint(codePoint)) {
        return 2;
    }

    return 1;
}

function isFullWidthCodePoint(codePoint: number): boolean {
    return codePoint >= 0x1100 && (
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
        || (codePoint >= 0x1F300 && codePoint <= 0x1FAFF)
        || (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
    );
}
