interface ParsedTableBlock {
    nextIndex: number;
    rows: string[][];
}

const HEADER_ABBREVIATIONS = new Map([
    ['condicion', 'Cond'],
    ['condition', 'Cond'],
    ['forecast', 'Pron'],
    ['hour', 'Hora'],
    ['hora', 'Hora'],
    ['horario', 'Hora'],
    ['humedad', 'Hum'],
    ['humidity', 'Hum'],
    ['period', 'Periodo'],
    ['periodo', 'Periodo'],
    ['precipitacion', 'Prec'],
    ['precipitation', 'Prec'],
    ['probabilidad', 'Prob'],
    ['probability', 'Prob'],
    ['sensacion termica', 'Sens'],
    ['temperature', 'Temp'],
    ['temperatura', 'Temp'],
    ['time', 'Hora'],
    ['viento', 'Viento'],
    ['wind', 'Wind'],
]);
const INDENT = '  ';
const MAX_INLINE_LABEL_WIDTH = 14;
const MAX_RENDER_WIDTH = 34;
const TABLE_DELIMITER_REGEXP = /^:?-{3,}:?$/;
const TABLE_ESCAPE_SENTINEL = '\u0000';

export function renderPipeTablesAsMonospaceBlocks(text: string): string {
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
        rendered.push(...renderTable(table.rows));
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
    const normalizedRows = rows.map(row => row.map(cleanCellText));
    const headers = normalizedRows[0];
    const body = normalizedRows.slice(1);

    if (headers.length <= 2) {
        return renderPairTable(body);
    }
    return renderRecordTable(headers, body);
}

function renderPairTable(rows: string[][]): string[] {
    const inlineLabels = rows
        .map(([label]) => `${label.trim()}:`)
        .filter(label => label && displayWidth(label) <= MAX_INLINE_LABEL_WIDTH);
    const inlineLabelWidth = inlineLabels.length === 0
        ? 0
        : Math.max(...inlineLabels.map(displayWidth));
    const valueWidth = inlineLabelWidth > 0
        ? Math.max(12, MAX_RENDER_WIDTH - inlineLabelWidth - 1)
        : MAX_RENDER_WIDTH - INDENT.length;

    const lines: string[] = [];
    for (const [label, value] of rows) {
        const trimmedLabel = label.trim();
        const trimmedValue = value?.trim();
        if (!trimmedLabel && !trimmedValue) {
            continue;
        }

        const labelWithColon = trimmedLabel ? `${trimmedLabel}:` : '';
        if (!trimmedValue) {
            lines.push(labelWithColon || trimmedLabel);
            continue;
        }

        if (labelWithColon && displayWidth(labelWithColon) <= inlineLabelWidth) {
            const wrappedValue = wrapText(trimmedValue, valueWidth);
            const inlinePrefix = padRight(labelWithColon, inlineLabelWidth + 1);
            lines.push(`${inlinePrefix}${wrappedValue[0]}`);
            const continuationPrefix = ' '.repeat(inlineLabelWidth + 1);
            for (const part of wrappedValue.slice(1)) {
                lines.push(`${continuationPrefix}${part}`);
            }
            continue;
        }

        lines.push(labelWithColon || trimmedLabel);
        for (const part of wrapText(trimmedValue, MAX_RENDER_WIDTH - INDENT.length)) {
            lines.push(`${INDENT}${part}`);
        }
    }

    return lines;
}

function renderRecordTable(headers: string[], rows: string[][]): string[] {
    const fieldLabels = headers.slice(1).map(shortHeader);
    const labelWidth = fieldLabels.length === 0
        ? 0
        : Math.max(...fieldLabels.map(label => displayWidth(`${label}:`)));
    const valueWidth = Math.max(12, MAX_RENDER_WIDTH - INDENT.length - labelWidth - 1);
    const lines: string[] = [];

    for (const [rowIndex, row] of rows.entries()) {
        const title = row[0]?.trim();
        if (!title) {
            continue;
        }

        if (rowIndex > 0) {
            lines.push('');
        }
        lines.push(title);

        for (let index = 1; index < headers.length; index++) {
            const value = row[index]?.trim();
            if (!value) {
                continue;
            }

            const label = `${shortHeader(headers[index])}:`;
            const wrappedValue = wrapText(value, valueWidth);
            const inlinePrefix = `${INDENT}${padRight(label, labelWidth + 1)}`;
            lines.push(`${inlinePrefix}${wrappedValue[0]}`);
            const continuationPrefix = ' '.repeat(INDENT.length + labelWidth + 1);
            for (const part of wrappedValue.slice(1)) {
                lines.push(`${continuationPrefix}${part}`);
            }
        }
    }

    return lines;
}

function cleanCellText(text: string): string {
    return text
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/\\([|_*`~()[\]{}>#+\-=.!])/g, '$1')
        .replace(/(\*\*|__|~~|[`*_])/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function shortHeader(header: string): string {
    const cleaned = cleanCellText(header);
    const normalized = normalizeLookup(cleaned);
    const mapped = HEADER_ABBREVIATIONS.get(normalized);
    if (mapped) {
        return mapped;
    }

    const firstWord = cleaned.split(/\s+/)[0] || cleaned;
    if (displayWidth(firstWord) <= 8) {
        return firstWord;
    }

    return truncateText(firstWord, 8);
}

function normalizeLookup(text: string): string {
    return text
        .normalize('NFKD')
        .replace(/\p{Mark}/gu, '')
        .toLowerCase();
}

function truncateText(text: string, width: number): string {
    let result = '';
    for (const char of text) {
        if (displayWidth(result + char) > width) {
            break;
        }
        result += char;
    }
    return result || text;
}

function padRight(text: string, width: number): string {
    const padding = Math.max(0, width - displayWidth(text));
    return `${text}${' '.repeat(padding)}`;
}

function wrapText(text: string, width: number): string[] {
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
