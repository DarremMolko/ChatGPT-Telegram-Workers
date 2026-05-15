import { describe, expect, it } from 'vitest';
import { transformPipeTables } from './table_render';

describe('transformPipeTables', () => {
    it('renders wide tables as boxed tables', () => {
        const input = [
            'Users:',
            '| User | Age | City | Favorite Food |',
            '| --- | --- | --- | --- |',
            '| Juan | 30 | Cucuta | Arepas con queso |',
            '| Ana | 25 | Bogota | Ajiaco santafereno |',
            'Done.',
        ].join('\n');

        expect(transformPipeTables(input)).toBe([
            'Users:',
            '```text',
            '┌──────┬─────┬────────┬────────────────┐',
            '│ User │ Age │ City   │ Favorite Food  │',
            '├──────┼─────┼────────┼────────────────┤',
            '│ Juan │  30 │ Cucuta │ Arepas con qu… │',
            '│ Ana  │  25 │ Bogota │ Ajiaco santaf… │',
            '└──────┴─────┴────────┴────────────────┘',
            '```',
            'Done.',
        ].join('\n'));
    });

    it('flattens markdown inside table cells to plain text', () => {
        const input = [
            '| Aspecto | Desafio |',
            '| --- | --- |',
            '| **Energias inaccesibles** | Para probar `directamente` con [aceleradores](https://example.com) |',
        ].join('\n');

        expect(transformPipeTables(input)).toBe([
            '```text',
            '┌────────────────┬────────────────┐',
            '│ Aspecto        │ Desafio        │',
            '├────────────────┼────────────────┤',
            '│ Energias inac… │ Para probar d… │',
            '└────────────────┴────────────────┘',
            '```',
        ].join('\n'));
    });

    it('renders small tables as boxed tables too', () => {
        const input = [
            '| Key | Value |',
            '| --- | --- |',
            '| A | 1 |',
            '| B | 2 |',
        ].join('\n');

        expect(transformPipeTables(input)).toBe([
            '```text',
            '┌─────┬───────┐',
            '│ Key │ Value │',
            '├─────┼───────┤',
            '│ A   │     1 │',
            '│ B   │     2 │',
            '└─────┴───────┘',
            '```',
        ].join('\n'));
    });

    it('does not touch tables inside fenced code blocks', () => {
        const input = [
            '```md',
            '| Key | Value |',
            '| --- | --- |',
            '| A | 1 |',
            '```',
        ].join('\n');

        expect(transformPipeTables(input)).toBe(input);
    });

    it('does not touch tables inside quoted fenced code blocks', () => {
        const input = [
            '> ```md',
            '> | Key | Value |',
            '> | --- | --- |',
            '> | A | 1 |',
            '> ```',
        ].join('\n');

        expect(transformPipeTables(input)).toBe(input);
    });

    it('ignores incomplete table fragments', () => {
        const input = [
            '| Key | Value |',
            '| --- | --- |',
        ].join('\n');

        expect(transformPipeTables(input)).toBe(input);
    });
});
