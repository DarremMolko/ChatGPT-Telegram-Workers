import { SEGMENTATION_MARK } from '../telegram/utils/md2tgmd';

export function renderThinkingTag(content: string, thinkingTag = '>`Thinking\\.\\.\\.`') {
    const trimmedContent = content.trimEnd();
    if (trimmedContent.length === 0) {
        return thinkingTag;
    }
    if (trimmedContent.endsWith(SEGMENTATION_MARK) || trimmedContent.endsWith('>')) {
        return thinkingTag;
    }
    return `\n${thinkingTag}`;
}
