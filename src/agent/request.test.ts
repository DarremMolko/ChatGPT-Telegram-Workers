import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../config/env';
import { EXPANDABLE_QUOTE_MARK } from '../telegram/utils/render_shared';
import { extractLeadingStreamedAnswerText, extractPreservedToolPreamble, prependPreservedPreamble, reconcileStreamedAnswerText, renderResponseBreak, renderThinkingTag, stripStreamedAnswerText, trimLeadingToolTransitionText, trimToolTransitionContent } from './thinking_format';

const previousExpandableThinking = ENV.EXPANDABLE_THINKING;

beforeAll(() => {
    ENV.EXPANDABLE_THINKING = true;
});

afterAll(() => {
    ENV.EXPANDABLE_THINKING = previousExpandableThinking;
});

describe('renderThinkingTag', () => {
    it('starts a new line when previous streamed text already exists', () => {
        expect(renderThinkingTag('herramientas disponibles.')).toBe(`\n${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
    });

    it('does not add an extra newline after a segmentation boundary', () => {
        expect(renderThinkingTag('//SEGMENTATIONMARK//\n')).toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
    });

    it('adds a blank line before thinking after prior tool chatter', () => {
        expect(renderThinkingTag('Voy a buscar herramientas.', '>`Thinking...`', { separateFromPrevious: true }))
            .toBe(`\n${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\``);
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

describe('stripStreamedAnswerText', () => {
    it('drops streamed answer text while preserving prior reasoning blocks', () => {
        expect(stripStreamedAnswerText(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\`\n> revisar\n>✹\n//SEGMENTATIONMARK//\nDéjame buscar eso para ti.`))
            .toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\`\n> revisar\n>✹\n//SEGMENTATIONMARK//\n`);
    });

    it('clears the content when no segmentation boundary exists', () => {
        expect(stripStreamedAnswerText('Déjame buscar eso para ti.')).toBe('');
    });
});

describe('extractLeadingStreamedAnswerText', () => {
    it('keeps only the first pre-tool paragraph', () => {
        expect(extractLeadingStreamedAnswerText('Ok, I will look that up for you.\n\nActually, let me compare the tools first.'))
            .toBe('Ok, I will look that up for you.');
    });

    it('extracts the first answer sentence after the reasoning segmentation boundary', () => {
        expect(extractLeadingStreamedAnswerText(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\`\n> revisar\n>✹\n//SEGMENTATIONMARK//\nThe user wants the weather forecast. Let me inspect both tools first.`))
            .toBe('The user wants the weather forecast.');
    });
});

describe('extractPreservedToolPreamble', () => {
    it('ignores a pure quoted thinking placeholder before any answer text exists', () => {
        expect(extractPreservedToolPreamble('>`Thinking...`')).toBe('');
    });

    it('keeps reasoning context together with the first answer paragraph', () => {
        expect(extractPreservedToolPreamble('>`Thinking...`\n> revisar\n>✹\n//SEGMENTATIONMARK//\nThe user wants the weather forecast.\n\nActually, let me compare tools.'))
            .toBe('>`Thinking...`\n> revisar\n>✹\n//SEGMENTATIONMARK//\nThe user wants the weather forecast.');
    });
});

describe('prependPreservedPreamble', () => {
    it('keeps the first preamble ahead of the final answer', () => {
        expect(prependPreservedPreamble('El clima hoy está despejado.', 'Ok, I will look that up for you.'))
            .toBe('Ok, I will look that up for you.\n\nEl clima hoy está despejado.');
    });

    it('does not duplicate the preamble when the final content already starts with it', () => {
        expect(prependPreservedPreamble('Ok, I will look that up for you.\n\nEl clima hoy está despejado.', 'Ok, I will look that up for you.'))
            .toBe('Ok, I will look that up for you.\n\nEl clima hoy está despejado.');
    });

    it('preserves multiline reasoning-heavy preambles intact', () => {
        expect(prependPreservedPreamble('El clima hoy está despejado.', 'Thinking aloud...\n\nOk, I will look that up for you.'))
            .toBe('Thinking aloud...\n\nOk, I will look that up for you.\n\nEl clima hoy está despejado.');
    });
});

describe('reconcileStreamedAnswerText', () => {
    it('replaces only the final answer segment after the last segmentation marker', () => {
        expect(reconcileStreamedAnswerText(
            `${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\`\n> revisar\n>✹\n//SEGMENTATIONMARK//\nDéjame buscar eso para ti.`,
            'El clima hoy está despejado.',
        )).toBe(`${EXPANDABLE_QUOTE_MARK}\n>\`Thinking...\`\n> revisar\n>✹\n//SEGMENTATIONMARK//\nEl clima hoy está despejado.`);
    });

    it('falls back to the authoritative text when no segmentation marker exists', () => {
        expect(reconcileStreamedAnswerText('Déjame buscar eso para ti.', 'El clima hoy está despejado.'))
            .toBe('El clima hoy está despejado.');
    });
});
