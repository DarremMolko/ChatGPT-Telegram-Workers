export const SEGMENTATION_MARK = '//SEGMENTATIONMARK//';
export const EXPANDABLE_QUOTE_MARK = '//EXPANDABLEQUOTEMARK//';

export interface ExpandParams {
    addQuote: boolean;
    quoteExpandable: boolean;
}

export function wrapExpandableQuote(text: string, expandable: boolean, leadingNewline = false): string {
    if (!expandable) {
        return leadingNewline ? `\n${text}` : text;
    }
    return `${leadingNewline ? '\n' : ''}${EXPANDABLE_QUOTE_MARK}\n${text}`;
}
