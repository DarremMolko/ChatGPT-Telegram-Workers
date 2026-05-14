import { escapedChars, escapedCharsReverseMap, escapedRegexp } from './markdown_escape';
import { SEGMENTATION_MARK } from './render_shared';

/* eslint-disable no-cond-assign */
/* eslint-disable style/brace-style */
interface Node {
    tag: string;
    attrs?: Record<string, any>;
    children?: (Node | string)[];
};

/**
 * @description: convert markdown to Telegraph nodes
 * Supports headings, unordered lists, bold, italic, underline, links, horizontal rules,
 * inline code, and fenced code blocks.
 * @param {string} markdown
 * @return {object[]}
 */
function markdownToTelegraphNodes(markdown: string): Node[] {
    markdown = markdown.replace(escapedRegexp, match => escapedChars[match as keyof typeof escapedChars]);
    const lines = markdown.split('\n').filter(line => line !== SEGMENTATION_MARK);
    const nodes = [];
    let inCodeBlock = 0;
    let codeBlockLanguage = '';
    let codeBlockContent = '';
    let codeMatch: RegExpMatchArray | null;

    for (let line of lines) {
        const codeRegex = /^```(.*)/;
        if ((codeMatch = codeRegex.exec(line.trim()))) {
            if (inCodeBlock === 1 && codeMatch[1] === '') {
                nodes.push({
                    tag: 'pre',
                    children: [
                        {
                            tag: 'code',
                            // attrs: codeBlockLanguage ? { class: `language-${codeBlockLanguage}` } : {},
                            attrs: codeBlockLanguage ? { class: codeBlockLanguage } : {},
                            children: [codeBlockContent.trim()],
                        },
                    ],
                });
                inCodeBlock--;
                codeBlockContent = '';
                codeBlockLanguage = '';
            } else if (inCodeBlock > 1 && codeMatch[1] === '') {
                inCodeBlock--;
                codeBlockContent += `${line}\n`;
            } else if (inCodeBlock > 0 && codeMatch[1] !== '') {
                inCodeBlock++;
                codeBlockContent += `${line}\n`;
            } else {
                // Start a code block.
                inCodeBlock++;
                codeBlockLanguage = codeMatch[1];
            }
            continue;
        }

        if (inCodeBlock > 0) {
            codeBlockContent += `${line}\n`;
            continue;
        }

        const _line = line.trim();
        if (!_line)
            continue;

        // Heading
        if (_line.startsWith('#')) {
            const titleRegex = /^#+/;
            const match = titleRegex.exec(_line);
            let level = match ? match[0].length : 0;
            level = level <= 2 ? 3 : 4; // Telegraph only supports h3 and h4.
            const text = line.replace(/^#+\s*/, '');
            nodes.push({ tag: `h${level}`, children: processInlineElements(text) });
        }
        // Blockquote
        else if (_line.startsWith('>')) {
            const text = line.slice(1);
            nodes.push({ tag: 'blockquote', children: processInlineElements(text) });
        }
        // Horizontal rule
        else if (_line === '---' || _line === '***') {
            nodes.push({ tag: 'hr' });
        }
        // Paragraph
        else {
            const matches = /^(\s*)(?:-|\*)\s/.exec(line);
            if (matches) {
                line = `${matches[1]}•\x20${line.slice(matches[0].length)}`;
            }
            nodes.push({ tag: 'p', children: processInlineElements(line) });
        }
    }

    // Handle potentially unclosed code blocks.
    if (inCodeBlock > 0) {
        nodes.push({
            tag: 'pre',
            children: [
                {
                    tag: 'code',
                    attrs: codeBlockLanguage ? { class: codeBlockLanguage } : {},
                    children: [codeBlockContent.trim() + (inCodeBlock > 1 ? '```\n'.repeat(inCodeBlock - 1) : '')],
                },
            ],
        });
    }
    // Merge adjacent nodes of the same type.
    function mergeSameNode(nodes: Node[]): Node[] {
        const mergedNodes: Node[] = [];
        for (let i = 0; i < nodes.length; i++) {
            if (i === 0) {
                mergedNodes.push(nodes[i]);
                continue;
            }
            const lastNode = mergedNodes.at(-1);
            if (lastNode && lastNode.tag === nodes[i].tag && lastNode.children) {
                const children = nodes[i].children || [];
                lastNode.children.push(...(['\n', ...children]));
            } else {
                mergedNodes.push(nodes[i]);
            }
        }
        return mergedNodes;
    }
    // Restore escaped characters.
    return revertEscapedChar(mergeSameNode(nodes));
}

function revertEscapedChar(nodes: Node[]): Node[] {
    const revertEscapeReg = new RegExp(Object.values(escapedChars).join('|'), 'g');
    return nodes.map((node): Node => {
        return JSON.parse(JSON.stringify(node).replace(revertEscapeReg, p1 => escapedCharsReverseMap.get(p1)?.substring(1) ?? p1));
    });
}

function processInlineElements(text: string) {
    const children = [];

    // Handle links.
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match = null;
    let index = 0;

    while (true) {
        match = linkRegex.exec(text);
        if (match === null)
            break;

        if (match.index > index) {
            children.push(...processInlineStyles(text.slice(index, match.index)));
        }
        children.push({
            tag: 'a',
            attrs: { href: match[2] },
            children: [match[1]],
        });
        index = match.index + match[0].length;
    }

    if (index < text.length) {
        children.push(...processInlineStyles(text.slice(index)));
    }

    return children;
}

function processInlineStyles(text: string): (string | { tag: string; children: any[] })[] {
    const children = [];

    // Handle inline code, bold, underline, italic, and strikethrough.
    const styleRegex = /(`|\*\*|\*|__|_|~~|~)(.+?)\1/g;
    let lastIndex = 0;
    let match;
    while (true) {
        match = styleRegex.exec(text);
        if (match === null)
            break;
        // Bold text may be immediately followed by italic text.
        if (match[1] === '**' && match[2].startsWith('*') && text.substring(styleRegex.lastIndex).startsWith('*')) {
            match[2] += '*';
            styleRegex.lastIndex += 1;
        }

        if (match.index > lastIndex) {
            children.push(text.slice(lastIndex, match.index));
        }
        let tag = '';
        switch (match[1]) {
            case '`':
                tag = 'code';
                break;
            case '**':
                tag = 'strong';
                break;
            case '__':
                tag = 'u';
                break;
            case '_':
            case '*':
                tag = 'i';
                break;
            case '~~':
            case '~':
                tag = 's';
                break;
            default:
                tag = 'span';
                break;
        }
        children.push({
            tag,
            children: tag === 'code' ? [match[2]] : processInlineStyles(match[2]),
        });
        lastIndex = styleRegex.lastIndex;
    }
    if (lastIndex < text.length) {
        children.push(text.slice(lastIndex));
    }

    return children;
}

export default markdownToTelegraphNodes;
