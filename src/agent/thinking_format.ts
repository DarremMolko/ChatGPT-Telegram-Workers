import { ENV } from '../config/env';
import { SEGMENTATION_MARK, wrapExpandableQuote } from '../telegram/utils/render_shared';

export function renderThinkingTag(
    content: string,
    thinkingTag = '>`Thinking...`',
    { separateFromPrevious = false }: { separateFromPrevious?: boolean } = {},
) {
    const trimmedContent = content.trimEnd();
    if (trimmedContent.length === 0) {
        return wrapExpandableQuote(thinkingTag, ENV.EXPANDABLE_THINKING);
    }
    if (trimmedContent.endsWith(SEGMENTATION_MARK) || trimmedContent.endsWith('>')) {
        return wrapExpandableQuote(thinkingTag, ENV.EXPANDABLE_THINKING);
    }
    if (separateFromPrevious) {
        return content.endsWith('\n')
            ? wrapExpandableQuote(thinkingTag, ENV.EXPANDABLE_THINKING)
            : wrapExpandableQuote(thinkingTag, ENV.EXPANDABLE_THINKING, true);
    }
    return wrapExpandableQuote(thinkingTag, ENV.EXPANDABLE_THINKING, true);
}

export function renderResponseBreak(content: string) {
    const trimmedContent = content.trimEnd();
    if (trimmedContent.length === 0 || trimmedContent.endsWith(SEGMENTATION_MARK)) {
        return '';
    }
    if (content.endsWith('\n')) {
        return '';
    }
    return '\n';
}

export function trimToolTransitionContent(content: string) {
    return content.replace(/\n\s*\n$/g, '').replace(/\n+$/g, '');
}

export function trimLeadingToolTransitionText(text: string) {
    return text.replace(/^\n+/, '');
}
