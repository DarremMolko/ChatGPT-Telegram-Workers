const TABLE_MONOSPACE_MAX_WIDTH = 30;
const TABLE_MONOSPACE_MAX_COLUMNS = 3;
const TABLE_MONOSPACE_MAX_ROWS = 8;

interface ParsedTable {
    header: string[];
    rows: string[][];
    endIndex: number;
}

// Telegram does not currently provide native rendering for pipe tables.
// This transformer is a compatibility layer for MarkdownV2 output and should
// be revisited if Telegram adds first-class table support in the future.
export function transformPipeTables(text: string): string {
    if (!text.includes('|')) {
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

    return { header, rows, endIndex };
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
    return cell.trim().replace(/\\\|/g, '|');
}

function isSeparatorRow(line: string, expectedCells: number): boolean {
    const cells = parseTableRow(line);
    if (!cells || cells.length !== expectedCells) {
        return false;
    }
    return cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function renderTable(table: ParsedTable): string {
    return shouldUseMonospace(table) ? renderMonospaceTable(table) : renderCardTable(table);
}

function shouldUseMonospace(table: ParsedTable): boolean {
    if (table.header.length > TABLE_MONOSPACE_MAX_COLUMNS || table.rows.length > TABLE_MONOSPACE_MAX_ROWS) {
        return false;
    }

    const widths = getColumnWidths(table);
    const renderedWidth = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * 3;
    return renderedWidth <= TABLE_MONOSPACE_MAX_WIDTH;
}

function getColumnWidths(table: ParsedTable): number[] {
    return table.header.map((_, columnIndex) => {
        const values = [table.header[columnIndex], ...table.rows.map(row => row[columnIndex] || '')];
        return Math.max(...values.map(value => value.length), 3);
    });
}

function renderMonospaceTable(table: ParsedTable): string {
    const widths = getColumnWidths(table);
    const renderRow = (row: string[]) => row
        .map((cell, index) => cell.padEnd(widths[index], ' '))
        .join(' | ');

    const divider = widths.map(width => '-'.repeat(width)).join(' | ');
    const lines = [
        '```',
        renderRow(table.header),
        divider,
        ...table.rows.map(renderRow),
        '```',
    ];
    return lines.join('\n');
}

function renderCardTable(table: ParsedTable): string {
    const titleIndex = Math.max(0, table.header.findIndex(cell => cell !== ''));

    return table.rows.map((row, rowIndex) => {
        const titleLabel = sanitizeCardText(table.header[titleIndex]) || `Row ${rowIndex + 1}`;
        const titleValue = sanitizeCardText(row[titleIndex]) || `Row ${rowIndex + 1}`;
        const lines = [`**${titleLabel}: ${titleValue}**`];

        row.forEach((value, columnIndex) => {
            if (columnIndex === titleIndex) {
                return;
            }

            const label = sanitizeCardText(table.header[columnIndex]) || `Column ${columnIndex + 1}`;
            const safeValue = sanitizeCardText(value);
            if (safeValue === '') {
                lines.push(`- ${label}: -`);
                return;
            }
            lines.push(`- ${label}: ${safeValue}`);
        });

        return lines.join('\n');
    }).join('\n\n');
}

function isFenceLine(line: string): boolean {
    return line.trim().replace(/^>\s?/, '').startsWith('```');
}

function sanitizeCardText(text: string): string {
    return text
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/(^|\W)\*\*(\S|\S[^\n]*?\S)\*\*(?=$|\W)/g, '$1$2')
        .replace(/(^|\W)\*(\S|\S[^\n]*?\S)\*(?=$|\W)/g, '$1$2')
        .replace(/(^|\W)__(\S|\S[^\n]*?\S)__(?=$|\W)/g, '$1$2')
        .replace(/(^|\W)_(\S|\S[^\n]*?\S)_(?=$|\W)/g, '$1$2')
        .replace(/(^|\W)~~(\S|\S[^\n]*?\S)~~(?=$|\W)/g, '$1$2')
        .replace(/(^|\W)~(\S|\S[^\n]*?\S)~(?=$|\W)/g, '$1$2')
        .replace(/\s+/g, ' ')
        .trim();
}
