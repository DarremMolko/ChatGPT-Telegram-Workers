import type { MessageSender } from '../utils/send';
import { formatErrorAsMarkdown } from '../../utils/error';

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function formatCommandErrorMessage(error: unknown, { redactions = [] }: { redactions?: string[] } = {}): string {
    return formatErrorAsMarkdown(error, { redactions, maxLength: TELEGRAM_MESSAGE_LIMIT });
}

export function sendCommandError(sender: MessageSender, error: unknown, { redactions = [] }: { redactions?: string[] } = {}) {
    return sender.sendRichText(formatCommandErrorMessage(error, { redactions }), undefined, 'tip');
}
