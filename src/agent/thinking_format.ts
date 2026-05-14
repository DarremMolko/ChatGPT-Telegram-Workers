import { SEGMENTATION_MARK } from '../telegram/utils/render_shared';

export function renderThinkingTag(
    content: string,
    thinkingTag = '>`Thinking...`',
    { separateFromPrevious = false }: { separateFromPrevious?: boolean } = {},
) {
    const trimmedContent = content.trimEnd();
    if (trimmedContent.length === 0) {
        return thinkingTag;
    }
    if (trimmedContent.endsWith(SEGMENTATION_MARK) || trimmedContent.endsWith('>')) {
        return thinkingTag;
    }
    if (separateFromPrevious) {
        return content.endsWith('\n') ? thinkingTag : `\n${thinkingTag}`;
    }
    return `\n${thinkingTag}`;
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
