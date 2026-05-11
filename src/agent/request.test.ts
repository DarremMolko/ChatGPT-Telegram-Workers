import { describe, expect, it } from 'vitest';
import { renderResponseBreak, renderThinkingTag } from './thinking_format';

describe('renderThinkingTag', () => {
    it('starts a new line when previous streamed text already exists', () => {
        expect(renderThinkingTag('herramientas disponibles.')).toBe('\n>`Thinking\\.\\.\\.`');
    });

    it('does not add an extra newline after a segmentation boundary', () => {
        expect(renderThinkingTag('//SEGMENTATIONMARK//\n')).toBe('>`Thinking\\.\\.\\.`');
    });

    it('adds a blank line before thinking after prior tool chatter', () => {
        expect(renderThinkingTag('Voy a buscar herramientas.', '>`Thinking\\.\\.\\.`', { separateFromPrevious: true }))
            .toBe('\n\n>`Thinking\\.\\.\\.`');
    });
});

describe('renderResponseBreak', () => {
    it('adds a blank line before resumed final text after tool chatter', () => {
        expect(renderResponseBreak('Voy a extraer el contenido del articulo.')).toBe('\n\n');
    });

    it('reuses an existing trailing newline when present', () => {
        expect(renderResponseBreak('Voy a extraer el contenido del articulo.\n')).toBe('\n');
    });

    it('does not add a break after a segmentation boundary', () => {
        expect(renderResponseBreak('//SEGMENTATIONMARK//\n')).toBe('');
    });
});
