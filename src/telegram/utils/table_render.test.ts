import { describe, expect, it } from 'vitest';
import { transformPipeTables } from './table_render';

describe('transformPipeTables', () => {
    it('renders wide tables as semantic cards', () => {
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
            '**User: Juan**',
            '- Age: 30',
            '- City: Cucuta',
            '- Favorite Food: Arepas con queso',
            '',
            '**User: Ana**',
            '- Age: 25',
            '- City: Bogota',
            '- Favorite Food: Ajiaco santafereno',
            'Done.',
        ].join('\n'));
    });

    it('flattens markdown inside card cells to plain text', () => {
        const input = [
            '| Aspecto | Desafio |',
            '| --- | --- |',
            '| **Energias inaccesibles** | Para probar `directamente` con [aceleradores](https://example.com) |',
        ].join('\n');

        expect(transformPipeTables(input)).toBe([
            '**Aspecto: Energias inaccesibles**',
            '- Desafio: Para probar directamente con aceleradores (https://example.com)',
        ].join('\n'));
    });

    it('renders small tables as cards too', () => {
        const input = [
            '| Key | Value |',
            '| --- | --- |',
            '| A | 1 |',
            '| B | 2 |',
        ].join('\n');

        expect(transformPipeTables(input)).toBe([
            '**Key: A**',
            '- Value: 1',
            '',
            '**Key: B**',
            '- Value: 2',
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
