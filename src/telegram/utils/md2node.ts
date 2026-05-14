import type { TelegraphNode } from './markdown_core';
import { parseMarkdownDocument, renderMarkdownDocumentToTelegraph } from './markdown_core';

export default function markdownToTelegraphNodes(markdown: string): TelegraphNode[] {
    return renderMarkdownDocumentToTelegraph(parseMarkdownDocument(markdown));
}
