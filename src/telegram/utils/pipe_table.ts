interface ParsedTableBlock {
    nextIndex: number;
    rows: string[][];
}

const TABLE_DELIMITER_REGEXP = /^:?-{3,}:?$/;
const TABLE_ESCAPE_SENTINEL = '\u0000';
const GENERIC_FIRST_COLUMN_HEADERS = new Set(['data', 'dato', 'item', 'name', 'label', 'periodo', 'period', 'horario', 'hora', 'time', 'hour']);

export function renderPipeTables(text: string): string {
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

        rendered.push(...renderTable(table.rows));
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
    if (!header || !delimiter || header.length < 1 || header.length !== delimiter.length) {
        return null;
    }

    if (!delimiter.every(cell => TABLE_DELIMITER_REGEXP.test(cell.trim()))) {
        return null;
    }

    const rows = [header];
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

    if (cells.length < 1 || cells.every(cell => cell === '')) {
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

function renderTable(rows: string[][]): string[] {
    const headers = rows[0];
    if (headers.length === 1) {
        return renderSingleColumnTable(rows.slice(1));
    }
    if (headers.length === 2) {
        return renderKeyValueTable(rows.slice(1));
    }
    return renderRecordTable(headers, rows.slice(1));
}

function renderSingleColumnTable(rows: string[][]): string[] {
    return rows
        .map(row => row[0]?.trim())
        .filter((value): value is string => Boolean(value))
        .map(value => `- ${value}`);
}

function renderKeyValueTable(rows: string[][]): string[] {
    return rows
        .map(([label, value]) => renderKeyValueLine(label, value))
        .filter((line): line is string => Boolean(line));
}

function renderRecordTable(headers: string[], rows: string[][]): string[] {
    const blocks: string[] = [];
    const firstHeader = cleanLabel(headers[0]);
    const useBareTitle = GENERIC_FIRST_COLUMN_HEADERS.has(firstHeader.toLowerCase());

    for (const [rowIndex, row] of rows.entries()) {
        const titleValue = row[0]?.trim();
        if (!titleValue) {
            continue;
        }

        if (rowIndex > 0) {
            blocks.push('');
        }

        blocks.push(useBareTitle ? `**${titleValue}**` : `**${firstHeader}: ${titleValue}**`);

        for (let index = 1; index < headers.length; index++) {
            const field = renderKeyValueLine(headers[index], row[index]);
            if (field) {
                blocks.push(field);
            }
        }
    }

    return blocks;
}

function renderKeyValueLine(label: string | undefined, value: string | undefined): string | null {
    const cleanValue = value?.trim();
    const cleanKey = cleanLabel(label);
    if (!cleanKey && !cleanValue) {
        return null;
    }
    if (!cleanValue) {
        return cleanKey ? `- **${cleanKey}**` : null;
    }
    if (!cleanKey) {
        return `- ${cleanValue}`;
    }
    return `- **${cleanKey}:** ${cleanValue}`;
}

function cleanLabel(text: string | undefined): string {
    let value = text?.trim() ?? '';
    if (!value) {
        return value;
    }

    for (const marker of ['**', '__', '`', '*', '_']) {
        if (value.startsWith(marker) && value.endsWith(marker) && value.length > marker.length * 2) {
            value = value.slice(marker.length, -marker.length).trim();
        }
    }

    return value;
}
