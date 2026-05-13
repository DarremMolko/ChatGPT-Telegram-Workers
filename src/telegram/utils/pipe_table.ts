interface ParsedTableBlock {
    nextIndex: number;
}

const TABLE_DELIMITER_REGEXP = /^:?-{3,}:?$/;
const TABLE_ESCAPE_SENTINEL = '\u0000';

export function wrapPipeTablesInCodeBlocks(text: string): string {
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
        rendered.push(...lines.slice(index, table.nextIndex));
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

    let nextIndex = startIndex + 2;
    while (nextIndex < lines.length) {
        const row = parseTableRow(lines[nextIndex]);
        if (!row) {
            break;
        }
        nextIndex++;
    }

    return { nextIndex };
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
