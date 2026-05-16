export const SEGMENTATION_MARK = '//SEGMENTATIONMARK//';
export const EXPANDABLE_QUOTE_MARK = '//EXPANDABLEQUOTEMARK//';

export interface ExpandParams {
    addQuote: boolean;
    quoteExpandable: boolean;
}

const SEGMENTATION_MARK_START_OF_LINE_WITH_SUFFIX = new RegExp(`(^|\\n)${escapeForRegex(SEGMENTATION_MARK)}(?=\\S)`, 'g');

export function wrapExpandableQuote(text: string, expandable: boolean, leadingNewline = false): string {
    if (!expandable) {
        return leadingNewline ? `\n${text}` : text;
    }
    return `${leadingNewline ? '\n' : ''}${EXPANDABLE_QUOTE_MARK}\n${text}`;
}

export function normalizeSegmentationBoundaries(text: string): string {
    return text.replace(SEGMENTATION_MARK_START_OF_LINE_WITH_SUFFIX, `$1${SEGMENTATION_MARK}\n`);
}

export function stripSegmentationMarkerLines(text: string): string {
    return text
        .split('\n')
        .map(line => line === SEGMENTATION_MARK ? '' : line)
        .join('\n');
}

function escapeForRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
