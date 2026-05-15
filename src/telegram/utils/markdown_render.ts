import type * as Telegram from 'telegram-bot-api-types';
import type { InlineNode, MarkdownBlock, RenderedText, TelegraphNode } from './markdown_types';

export function renderMarkdownDocumentToTelegram(
    blocks: MarkdownBlock[],
    options: { quoteEntireMessage?: boolean; quoteExpandable?: boolean } = {},
): RenderedText {
    const rendered = renderTelegramBlocks(blocks, options.quoteExpandable ?? false);
    if (options.quoteEntireMessage && rendered.text.length > 0) {
        rendered.entities = [
            {
                type: options.quoteExpandable ? 'expandable_blockquote' : 'blockquote',
                offset: 0,
                length: rendered.text.length,
            },
            ...(rendered.entities || []),
        ];
    }
    return finalizeRenderedText(rendered);
}

export function renderMarkdownDocumentToTelegraph(blocks: MarkdownBlock[]): TelegraphNode[] {
    return mergeAdjacentNodes(blocks.flatMap(renderTelegraphBlock));
}

function renderTelegramBlocks(blocks: MarkdownBlock[], quoteExpandable: boolean): RenderedText {
    let text = '';
    const entities: Telegram.MessageEntity[] = [];

    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (index > 0) {
            text += '\n';
        }
        const offset = text.length;
        const rendered = renderTelegramBlock(block, quoteExpandable);
        text += rendered.text;
        entities.push(...shiftEntities(rendered.entities, offset));
    }

    return { text, entities };
}

function renderTelegramBlock(block: MarkdownBlock, quoteExpandable: boolean): RenderedText {
    switch (block.kind) {
        case 'paragraph':
            return renderTelegramInline(block.content);
        case 'prefixed': {
            const content = renderTelegramInline(block.content);
            return {
                text: `${block.prefix}${content.text}`,
                entities: shiftEntities(content.entities, block.prefix.length),
            };
        }
        case 'heading': {
            const content = renderTelegramInline(block.content);
            return {
                text: `${block.prefix}${content.text}`,
                entities: [
                    ...shiftEntities(content.entities, block.prefix.length),
                    ...(content.text.length > 0
                        ? [{
                            type: 'bold',
                            offset: block.prefix.length,
                            length: content.text.length,
                        } satisfies Telegram.MessageEntity]
                        : []),
                ],
            };
        }
        case 'blockquote': {
            const inner = renderTelegramBlocks(block.blocks, quoteExpandable);
            if (inner.text.length === 0) {
                return { text: '' };
            }
            return {
                text: inner.text,
                entities: [
                    {
                        type: (block.expandable ?? quoteExpandable) ? 'expandable_blockquote' : 'blockquote',
                        offset: 0,
                        length: inner.text.length,
                    },
                    ...(inner.entities || []),
                ],
            };
        }
        case 'code': {
            if (block.text.length === 0) {
                return { text: '' };
            }
            return {
                text: block.text,
                entities: [{
                    type: 'pre',
                    offset: 0,
                    length: block.text.length,
                    ...(block.language ? { language: block.language } : {}),
                }],
            };
        }
        case 'hr':
            return { text: '---' };
    }
}

function renderTelegramInline(nodes: InlineNode[]): RenderedText {
    let text = '';
    const entities: Telegram.MessageEntity[] = [];

    for (const node of nodes) {
        const rendered = renderTelegramInlineNode(node);
        if (rendered.text.length === 0) {
            continue;
        }
        const offset = text.length;
        text += rendered.text;
        entities.push(...shiftEntities(rendered.entities, offset));
    }

    return { text, entities };
}

function renderTelegramInlineNode(node: InlineNode): RenderedText {
    switch (node.kind) {
        case 'text':
            return { text: node.text };
        case 'code':
            return {
                text: node.text,
                entities: [{
                    type: 'code',
                    offset: 0,
                    length: node.text.length,
                }],
            };
        case 'style': {
            const rendered = renderTelegramInline(node.children);
            if (rendered.text.length === 0) {
                return { text: '' };
            }
            return {
                text: rendered.text,
                entities: [
                    ...(rendered.entities || []),
                    ...node.styles.map(type => ({
                        type,
                        offset: 0,
                        length: rendered.text.length,
                    } satisfies Telegram.MessageEntity)),
                ],
            };
        }
        case 'link': {
            if (!isSupportedTelegramUrl(node.url)) {
                return { text: node.raw };
            }
            const rendered = renderTelegramInline(node.text);
            if (rendered.text.length === 0) {
                return { text: node.raw };
            }
            return {
                text: rendered.text,
                entities: [
                    ...(rendered.entities || []),
                    {
                        type: 'text_link',
                        offset: 0,
                        length: rendered.text.length,
                        url: node.url,
                    },
                ],
            };
        }
    }
}

function renderTelegraphBlock(block: MarkdownBlock): TelegraphNode[] {
    switch (block.kind) {
        case 'paragraph':
            return [createTelegraphNode('p', renderTelegraphInlineChildren(block.content))];
        case 'prefixed':
            return [createTelegraphNode('p', [block.prefix, ...renderTelegraphInlineChildren(block.content)])];
        case 'heading': {
            const level = block.level <= 2 ? 3 : 4;
            return [createTelegraphNode(`h${level}`, renderTelegraphInlineChildren(block.content))];
        }
        case 'blockquote':
            return [createTelegraphNode('blockquote', renderMarkdownDocumentToTelegraph(block.blocks))];
        case 'code':
            return [{
                tag: 'pre',
                children: [{
                    tag: 'code',
                    attrs: block.language ? { class: block.language } : {},
                    children: [block.text.trim()],
                }],
            }];
        case 'hr':
            return [{ tag: 'hr' }];
    }
}

function renderTelegraphInlineChildren(nodes: InlineNode[]): (TelegraphNode | string)[] {
    const children: (TelegraphNode | string)[] = [];

    for (const node of nodes) {
        children.push(...renderTelegraphInlineNode(node));
    }

    return children;
}

function renderTelegraphInlineNode(node: InlineNode): (TelegraphNode | string)[] {
    switch (node.kind) {
        case 'text':
            return [node.text];
        case 'code':
            return [{
                tag: 'code',
                children: [node.text],
            }];
        case 'style':
            return renderTelegraphStyledNode(node.styles, renderTelegraphInlineChildren(node.children));
        case 'link':
            return [{
                tag: 'a',
                attrs: { href: node.url },
                children: renderTelegraphInlineChildren(node.text),
            }];
    }
}

function renderTelegraphStyledNode(styles: Telegram.MessageEntityType[], children: (TelegraphNode | string)[]): (TelegraphNode | string)[] {
    let output = children;
    for (const style of styles) {
        const tag = styleToTelegraphTag(style);
        if (!tag) {
            continue;
        }
        output = [{
            tag,
            children: output,
        }];
    }
    return output;
}

function styleToTelegraphTag(style: Telegram.MessageEntityType): string | null {
    switch (style) {
        case 'bold':
            return 'strong';
        case 'italic':
            return 'i';
        case 'underline':
            return 'u';
        case 'strikethrough':
            return 's';
        default:
            return null;
    }
}

function createTelegraphNode(tag: string, children: (TelegraphNode | string)[]): TelegraphNode {
    return { tag, children };
}

function mergeAdjacentNodes(nodes: TelegraphNode[]): TelegraphNode[] {
    const merged: TelegraphNode[] = [];
    for (const node of nodes) {
        const last = merged.at(-1);
        if (last && last.tag === node.tag && sameAttrs(last.attrs, node.attrs) && last.children && node.children) {
            last.children.push('\n', ...node.children);
            continue;
        }
        merged.push(node);
    }
    return merged;
}

function sameAttrs(left?: Record<string, any>, right?: Record<string, any>): boolean {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function isSupportedTelegramUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'tg:';
    } catch {
        return false;
    }
}

function shiftEntities(entities: Telegram.MessageEntity[] | undefined, offset: number): Telegram.MessageEntity[] {
    if (!entities || entities.length === 0) {
        return [];
    }
    if (offset === 0) {
        return entities.map(entity => ({ ...entity }));
    }
    return entities.map(entity => ({
        ...entity,
        offset: entity.offset + offset,
    }));
}

function finalizeRenderedText(rendered: RenderedText): RenderedText {
    const entities = (rendered.entities || [])
        .filter(entity => entity.length > 0)
        .sort((left, right) => left.offset - right.offset || right.length - left.length);

    if (entities.length === 0) {
        return { text: rendered.text };
    }
    return {
        text: rendered.text,
        entities,
    };
}
