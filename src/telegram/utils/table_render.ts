import { parseInlineNodes, renderInlineNodesToPlainText } from './markdown_core';

interface ParsedTable {
    header: string[];
    rows: string[][];
    alignments: TableAlignment[];
    endIndex: number;
}

type TableAlignment = 'left' | 'center' | 'right' | 'default';

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
    const widths = header.map((cell, index) => Math.max(
        measureCellWidth(cell),
        ...rows.map(row => measureCellWidth(row[index] || '')),
    ));
    const lines = [
        renderBorder('┌', '┬', '┐', widths),
        renderRow(header, widths, table.alignments),
        renderBorder('├', '┼', '┤', widths),
        ...rows.map(row => renderRow(row, widths, table.alignments)),
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
    return Array.from(text).length;
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
