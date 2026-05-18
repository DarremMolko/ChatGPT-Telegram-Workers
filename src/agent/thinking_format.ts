import { ENV } from '../config/env';
import { EXPANDABLE_QUOTE_MARK, SEGMENTATION_MARK, wrapExpandableQuote } from '../telegram/utils/render_shared';

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

function findLatestSegmentationBoundary(content: string) {
    const directIndex = content.lastIndexOf(SEGMENTATION_MARK);
    if (directIndex < 0) {
        return -1;
    }
    let boundaryEnd = directIndex + SEGMENTATION_MARK.length;
    if (content.charAt(boundaryEnd) === '\n') {
        boundaryEnd++;
    }
    return boundaryEnd;
}

export function stripStreamedAnswerText(content: string) {
    const boundaryEnd = findLatestSegmentationBoundary(content);
    if (boundaryEnd < 0) {
        return '';
    }
    return content.slice(0, boundaryEnd);
}

export function extractLeadingStreamedAnswerText(content: string) {
    const boundaryEnd = findLatestSegmentationBoundary(content);
    const candidate = (boundaryEnd < 0 ? content : content.slice(boundaryEnd)).trim();
    if (!candidate) {
        return '';
    }
    const firstParagraph = candidate
        .split(/\n\s*\n/)
        .map(part => part.trim())
        .find(Boolean) || '';
    const firstLine = firstParagraph
        .split('\n')
        .map(part => part.trim())
        .find(Boolean) || '';
    const compactLine = firstLine.replace(/\s+/g, ' ').trim();
    const firstSentence = compactLine.match(/^(.+?[.!?…。！？])(?:\s+|$)/u)?.[1]?.trim();
    return firstSentence || compactLine;
}

function extractFirstParagraph(text: string) {
    return text
        .replace(/^\n+/, '')
        .split(/\n\s*\n/)
        .map(part => part.trim())
        .find(Boolean) || '';
}

function splitVisibleParagraphs(content: string) {
    return content
        .trim()
        .split(/\n\s*\n/)
        .map(part => part.trim())
        .filter(Boolean);
}

function getParagraphVisibleLines(paragraph: string) {
    return paragraph
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
}

function isQuotedParagraph(paragraph: string) {
    const visibleLines = getParagraphVisibleLines(paragraph)
        .filter(line => line !== EXPANDABLE_QUOTE_MARK);
    return visibleLines.length > 0 && visibleLines.every(line => line.startsWith('>'));
}

function normalizeQuotedLine(line: string) {
    return line
        .replace(/^>+\s*/, '')
        .trim()
        .replace(/^`(.+)`$/u, '$1')
        .trim();
}

function isPlaceholderQuotedLine(line: string) {
    if (!line || line === '✹' || line === SEGMENTATION_MARK) {
        return true;
    }
    return /^thinking\.\.\.$/iu.test(line)
        || /^thought for [\d.]+ seconds$/iu.test(line);
}

function hasMeaningfulQuotedLine(paragraph: string) {
    return getParagraphVisibleLines(paragraph)
        .filter(line => line.startsWith('>'))
        .map(normalizeQuotedLine)
        .some(line => !isPlaceholderQuotedLine(line));
}

function hasNonQuotedVisibleLine(content: string) {
    return getParagraphVisibleLines(content)
        .some(line => line !== EXPANDABLE_QUOTE_MARK && !line.startsWith('>'));
}

export function extractPreservedToolPreamble(content: string) {
    const boundaryEnd = findLatestSegmentationBoundary(content);
    if (boundaryEnd >= 0) {
        const prefix = content.slice(0, boundaryEnd);
        const firstParagraph = extractFirstParagraph(content.slice(boundaryEnd));
        if (!firstParagraph) {
            return '';
        }
        return `${prefix}${firstParagraph}`.trimEnd();
    }
    const paragraphs = splitVisibleParagraphs(content);
    if (paragraphs.length === 0) {
        return '';
    }
    const firstParagraph = paragraphs[0];
    if (isQuotedParagraph(firstParagraph)) {
        if (!hasMeaningfulQuotedLine(firstParagraph)) {
            return paragraphs.find((paragraph, index) => index > 0 && (
                hasNonQuotedVisibleLine(paragraph) || hasMeaningfulQuotedLine(paragraph)
            )) || '';
        }
        const nextParagraph = paragraphs[1];
        if (nextParagraph && hasNonQuotedVisibleLine(nextParagraph)) {
            return `${firstParagraph}\n\n${nextParagraph}`.trimEnd();
        }
        return firstParagraph.trimEnd();
    }
    if (!hasNonQuotedVisibleLine(content)) {
        return '';
    }
    return firstParagraph;
}

export function prependPreservedPreamble(content: string, preamble?: string) {
    const preserved = `${preamble || ''}`.trim();
    if (!preserved) {
        return content;
    }
    const nextContent = `${content || ''}`.trim();
    if (!nextContent) {
        return preserved;
    }
    if (nextContent.startsWith(preserved)) {
        return nextContent;
    }
    return `${preserved}\n\n${nextContent}`;
}

export function reconcileStreamedAnswerText(content: string, authoritativeText: string) {
    const finalText = `${authoritativeText || ''}`.trim();
    if (!finalText) {
        return content;
    }
    const boundaryEnd = findLatestSegmentationBoundary(content);
    if (boundaryEnd < 0) {
        return finalText;
    }
    return `${content.slice(0, boundaryEnd)}${finalText.trimStart()}`;
}
