import { describe, expect, it } from 'vitest';
import { renderThinkingTag } from './thinking_format';

describe('renderThinkingTag', () => {
    it('starts a new line when previous streamed text already exists', () => {
        expect(renderThinkingTag('herramientas disponibles.')).toBe('\n>`Thinking\\.\\.\\.`');
    });

    it('does not add an extra newline after a segmentation boundary', () => {
        expect(renderThinkingTag('//SEGMENTATIONMARK//\n')).toBe('>`Thinking\\.\\.\\.`');
    });
});
