import { describe, expect, it } from 'vitest';
import { normalizeSegmentationBoundaries, SEGMENTATION_MARK, stripSegmentationMarkerLines } from './render_shared';

describe('normalizeSegmentationBoundaries', () => {
    it('moves a streaming cursor onto a new line after a segmentation boundary', () => {
        expect(normalizeSegmentationBoundaries(`answer\n${SEGMENTATION_MARK}●`))
            .toBe(`answer\n${SEGMENTATION_MARK}\n●`);
    });
});

describe('stripSegmentationMarkerLines', () => {
    it('removes segmentation marker lines while preserving the surrounding break', () => {
        expect(stripSegmentationMarkerLines(`alpha\n${SEGMENTATION_MARK}\nbeta`))
            .toBe('alpha\n\nbeta');
    });
});
