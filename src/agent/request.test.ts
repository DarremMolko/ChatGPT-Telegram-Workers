import { describe, expect, it } from 'vitest';
import { renderResponseBreak, renderThinkingTag, trimLeadingToolTransitionText, trimToolTransitionContent } from './thinking_format';

describe('renderThinkingTag', () => {
    it('starts a new line when previous streamed text already exists', () => {
        expect(renderThinkingTag('herramientas disponibles.')).toBe('\n>`Thinking\\.\\.\\.`');
    });

    it('does not add an extra newline after a segmentation boundary', () => {
        expect(renderThinkingTag('//SEGMENTATIONMARK//\n')).toBe('>`Thinking\\.\\.\\.`');
    });

    it('adds a blank line before thinking after prior tool chatter', () => {
        expect(renderThinkingTag('Voy a buscar herramientas.', '>`Thinking\\.\\.\\.`', { separateFromPrevious: true }))
            .toBe('\n>`Thinking\\.\\.\\.`');
    });
});

describe('renderResponseBreak', () => {
    it('adds a single newline before resumed final text after tool chatter', () => {
        expect(renderResponseBreak('Voy a extraer el contenido del articulo.')).toBe('\n');
    });

    it('reuses an existing trailing newline when present', () => {
        expect(renderResponseBreak('Voy a extraer el contenido del articulo.\n')).toBe('');
    });

    it('does not add a break after a segmentation boundary', () => {
        expect(renderResponseBreak('//SEGMENTATIONMARK//\n')).toBe('');
    });
});

describe('trimToolTransitionContent', () => {
    it('removes trailing blank lines before resumed tool output', () => {
        expect(trimToolTransitionContent('Voy a buscar herramientas.\n\n')).toBe('Voy a buscar herramientas.');
    });

    it('preserves inner line breaks', () => {
        expect(trimToolTransitionContent('Linea 1\nLinea 2\n\n')).toBe('Linea 1\nLinea 2');
    });
});

describe('trimLeadingToolTransitionText', () => {
    it('removes leading blank lines from resumed tool-step chatter', () => {
        expect(trimLeadingToolTransitionText('\n\nVoy a obtener el pronostico.')).toBe('Voy a obtener el pronostico.');
    });

    it('preserves non-leading line breaks', () => {
        expect(trimLeadingToolTransitionText('Linea 1\nLinea 2')).toBe('Linea 1\nLinea 2');
    });
});
