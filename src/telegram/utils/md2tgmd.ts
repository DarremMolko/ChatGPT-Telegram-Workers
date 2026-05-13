/* eslint-disable regexp/no-super-linear-backtracking */
const escapeChars = /[_*[\]()\\~`>#+\-=|{}.!]/g;
export const SEGMENTATION_MARK = '//SEGMENTATIONMARK//';
export const escapedChars = {
    '\\*': 'ESCAPEASTERISK',
    '\\_': 'ESCAPEUNDERSCORE',
    '\\~': 'ESCAPETILDE',
    '\\|': 'ESCAPEPIP',
    '\\`': 'ESCAPEBACKTICK',
    '\\\\': 'ESCAPEBACKSLASH',
    '\\(': 'ESCAPELEFTPARENTHESIS',
    '\\)': 'ESCAPERIGHTPARENTHESIS',
    '\\[': 'ESCAPELEFTBRACKET',
    '\\]': 'ESCAPERIGHTBRACKET',
    '\\{': 'ESCAPELEFTBRACE',
    '\\}': 'ESCAPERIGHTBRACE',
    '\\>': 'ESCAPEGREATERTHAN',
    '\\#': 'ESCAPEHASH',
    '\\+': 'ESCAPEPLUS',
    '\\-': 'ESCAPEMINUS',
    '\\=': 'ESCAPEEQUAL',
    '\\.': 'ESCAPEDOT',
    '\\!': 'ESCAPEEXCLAMATION',
    '\\?': 'ESCAPEQUESTION',
};
export const escapedRegexp = /\\[*_~|`\\()[\]{}>#+\-=.!]/g;
const reverseCodeRegexp = /\\`\\`\\`([\s\S]+)\\`\\`\\`$/g;
const inlineCodeRegexp = /`[^\n]*?`/g;
const linkRegexp = /\\\[([^\]\n]+?)\\\]\\\((.+?)\\\)/g;
const escapeRegexpMatch = [
    // bold & italic
    {
        regex: /(\\\*\\\*\\\*)(\S|\S[^\n]*?\S)\1/g,
        value: '*_$2_*',
    },
    // bold
    {
        regex: /(\\\*\\\*)(\S|\S[^\n]*?\S)\1/g,
        value: '*$2*',
    },
    // underline
    {
        regex: /(^|[^\\\w])\\_\\_(\S|\S[^\n]*?\S)\\_\\_\b/g,
        value: '$1__$2__',
    },
    // italic
    {
        regex: /(^|[^\\\w])\\([_*])(\S|\S[^\n]*?\S)\\\2(?!\w)/g,
        value: '$1_$3_',
    },
    // strikethrough
    {
        regex: /\\~(\S|\S[^\n]*?\S)\\~/g,
        value: '~$1~',
    },
    // spoiler
    {
        regex: /\\\|\\\|(\S|\S[^\n]*?\S)\\\|\\\|/g,
        value: '||$1||',
    },
    // quote
    {
        regex: /^(\x20*(?:\\\*\\\*)?)\\>\x20?([^\n]*)$/gm,
        value: '$1>$2',
    },
    // item
    {
        regex: /^(>?\x20*)\\(?:-|\*)\s+([^\n]*)$/gm,
        value: '$1•\x20$2',
    },
    // number sign
    {
        regex: /^(>?\x20*(?:\\#){1,6})\x20+([^\n]+)$/gm,
        value: '$1\x20*$2*',
    },
];

export const escapedCharsReverseMap = new Map(Object.entries(escapedChars).map(([key, value]) => [value, key]));

export function escape(text: string, expandParams: ExpandParams = { addQuote: false, quoteExpandable: false }): string {
    const lines = text.split('\n');
    const codeStack: number[] = [];
    const result: string[] = [];
    let lineTrim = '';
    let textStartIndex = 0;

    for (const [i, line] of lines.entries()) {
        lineTrim = line.trim();
        let startIndex: number | undefined;
        // if line starts with ```xx, push current line index to codeStack
        if (/^>?```.+/.test(lineTrim)) {
            codeStack.push(i);
            if (textStartIndex < i) {
                result.push(handleEscape(lines.slice(textStartIndex, i).join('\n'), 'text', expandParams));
            }
        } else if (/^>?```$/.test(lineTrim)) {
            // if line is ```, and codeStack is not empty, pop last element from codeStack
            if (codeStack.length > 0) {
                startIndex = codeStack.pop();
                // if codeStack is empty now, push content to result and handle code escape
                if (codeStack.length === 0) {
                    const content = lines.slice(startIndex, i + 1).join('\n');
                    result.push(handleEscape(content, 'code', expandParams));
                    textStartIndex = i + 1;
                }
            } else {
                // code start
                codeStack.push(i);
                if (textStartIndex < i) {
                    result.push(handleEscape(lines.slice(textStartIndex, i).join('\n'), 'text', expandParams));
                }
            }
        }
    }
    if (codeStack.length > 0) {
        const last = `${lines.slice(codeStack[0]).join('\n')}\n\`\`\``;
        result.push(handleEscape(last, 'code', expandParams));
    } else if (textStartIndex < lines.length) {
        result.push(handleEscape(lines.slice(textStartIndex).join('\n'), 'text', expandParams));
    }
    return addExpandable(result.join('\n'), expandParams.quoteExpandable);
}

function handleEscape(text: string, type: 'text' | 'code', { addQuote }: ExpandParams): string {
    if (!text.trim()) {
        return text;
    }
    text = text.replace(escapedRegexp, match => escapedChars[match as keyof typeof escapedChars]);
    if (type === 'text') {
        const markd: Record<string, string> = {};
        text = markData(text, markd).text;
        text = text.replace(escapeChars, match => `\\${match}`);
        text = markData(text, markd, 'LINK').text;

        escapeRegexpMatch.forEach(item => text = text.replace(item.regex, item.value));
        Object.entries(markd).forEach(([key, value]) => {
            text = text.replace(key, value);
        });
    } else {
        // Remove extra leading whitespace from code blocks.
        const codeBlank = text.length - text.trimStart().length;
        if (codeBlank > 0) {
            const blankReg = new RegExp(`^\\s{${codeBlank}}`, 'gm');
            text = text.replace(blankReg, '');
        }
        // Non-quoted code block
        if ((!addQuote && !text.trimStart().startsWith('>'))) {
            text = text
                .trimEnd()
                .replace(/([\\`])/g, '\\$1')
                .replace(reverseCodeRegexp, '```$1```'); // code block
        } else {
            text = text.replace(escapeChars, match => `\\${match}`).replace(/^\\>/gm, '>');
        }
    }
    text = quoteMessage(text, addQuote);
    return text.replace(
        new RegExp(Object.values(escapedChars).join('|'), 'g'),
        match => escapedCharsReverseMap.get(match) ?? match,
    );
}
export function chunkDocument(text: string, chunkSize: number = 4000): string[] {
    const cleanText = text.trim();
    const textList = lineSegment(cleanText);
    const chunks: string[][] = [[]];
    let chunkIndex = 0;
    const codeStack: string[] = [];
    for (const line of textList) {
        if (chunks[chunkIndex].join('\n').length + line.length > chunkSize) {
            chunkIndex++;
            chunks.push([]);
            if (codeStack.length > 0) {
                // If a chunk ends on a code-fence start, close and reopen fences across chunk boundaries.
                // There is already some redundancy in this edge case, so keep the logic simple.
                const lastLineIsCodeStart = chunks[chunkIndex - 1].at(-1)?.trimStart()?.startsWith('```');
                lastLineIsCodeStart && chunks[chunkIndex - 1].pop();
                // Insert closing fences.
                const closingFenceCount = lastLineIsCodeStart ? codeStack.length - 1 : codeStack.length;
                for (let i = 0; i < closingFenceCount; i++) {
                    chunks[chunkIndex - 1].push('```');
                }

                if (line.trim() === '```') {
                    codeStack.pop();
                    // Insert opening fences into the new chunk.
                    chunks[chunkIndex].unshift(...codeStack);
                    continue;
                }
                // Insert opening fences into the new chunk.
                chunks[chunkIndex].unshift(...codeStack);
            }

            chunks[chunkIndex].push(line);
            continue;
        }
        if (/^```.+/.test(line.trimStart())) {
            codeStack.push(line);
        } else if (line.trim() === '```') {
            if (codeStack.length) {
                codeStack.pop();
            } else {
                codeStack.push(line);
            }
        }

        chunks[chunkIndex].push(line);
    }
    if (codeStack.length) {
        chunks[chunkIndex].push(...Array.from({ length: codeStack.length }).fill('```') as string[]);
    }
    return chunks.map(c => c.join('\n'));
}

function lineSegment(text: string, chunkSize: number = 4000): string[] {
    const chunkText = (text: string) => {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            // add quote
            const isNeedAddQuote = i > 0 && text.trimStart().startsWith('>');
            chunks.push((isNeedAddQuote ? '>' : '') + text.slice(i, i + chunkSize));
        }
        return chunks;
    };

    const newLines: string[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.length > chunkSize) {
            newLines.push(...chunkText(line));
            continue;
        }
        newLines.push(line);
    }
    return newLines;
}

function markData(text: string, markd: Record<string, string>, type: 'INCODE' | 'LINK' = 'INCODE') {
    const isIncode = type === 'INCODE';
    const matches = text.matchAll(isIncode ? inlineCodeRegexp : linkRegexp);
    let i = 0;
    for (const match of matches) {
        markd[`${type} ${i}`] = isIncode ? match[0] : `[${match[1]}](${match[2]})`;
        text = text.replace(match[0], `${type} ${i}`);
        i++;
    }
    return {
        text,
        markd,
    };
}

export function addExpandable(text: string, quoteExpandable: boolean): string {
    // Match all quote blocks (multi-line blocks starting with > or **>)
    return text.replace(/^((?:\*\*)?>[^\n]*(?:\n>[^\n]*)*)(\n|$)/gm, (match, content, lineEnd) => {
        // Check if this block already starts with **>
        const isExpandable = content.trimStart().startsWith('**>');

        // If block is already expandable (has **>), or if quoteExpandable is true, ensure it has ||
        if (isExpandable || quoteExpandable) {
            // Check if already has || at the end
            if (content.trimEnd().endsWith('||')) {
                return match; // Already properly formatted
            }

            // Add || marker
            if (isExpandable) {
                // Already has **, just add ||
                return `${content.trimEnd()}||${lineEnd}`;
            } else {
                // Add both ** and ||
                return `**${content.trimEnd()}||${lineEnd}`;
            }
        }

        // Not expandable, return as-is
        return match;
    });
}

export interface ExpandParams {
    addQuote: boolean;
    quoteExpandable: boolean;
}

function quoteMessage(text: string, addQuote: boolean) {
    // When quotes are disabled, remove both the segmentation marker and newline if the next line is not quoted;
    // otherwise remove only the marker.
    if (!addQuote) {
        return text.replace(new RegExp(`^${SEGMENTATION_MARK}(?:\n([^>]))?`, 'gm'), '$1');
    }
    const textList = text.split('\n');
    textList.forEach((line, index) => {
        if (line === SEGMENTATION_MARK) {
            textList[index] = '';
        } else {
            !line.startsWith('>') && (textList[index] = `>${line}`);
        }
    });
    return textList.join('\n');
}
