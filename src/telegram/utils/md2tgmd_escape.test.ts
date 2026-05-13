import { describe, expect, it } from 'vitest';
import { escape, wrapExpandableLog } from './md2tgmd';

describe('escape snake case safety', () => {
    it('keeps plain snake_case escaped as literal text', () => {
        expect(escape('foo_bar_baz')).toBe('foo\\_bar\\_baz');
    });

    it('keeps double underscores inside words escaped as literal text', () => {
        expect(escape('some_text_with__double__underscores')).toBe('some\\_text\\_with\\_\\_double\\_\\_underscores');
    });

    it('still renders intentional italic markdown', () => {
        expect(escape('I can _help_ you.')).toBe('I can _help_ you\\.');
    });

    it('still renders intentional underline markdown', () => {
        expect(escape('This is __important__.')).toBe('This is __important__\\.');
    });
});

describe('wrapExpandableLog', () => {
    it('turns runtime log lines into an expandable block', () => {
        const message = `${wrapExpandableLog('kimi-k2.6 3.2s\nsearch_tools: ["trending movies"]')}\nanswer`;

        expect(escape(message)).toBe('>kimi\\-k2\\.6 3\\.2s\n>search\\_tools: \\["trending movies"\\]||\nanswer');
    });
});
