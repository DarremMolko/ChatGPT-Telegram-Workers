import { describe, expect, it } from 'vitest';
import { renderPipeTables } from './pipe_table';

describe('renderPipeTables', () => {
    it('renders two-column tables as key-value bullets', () => {
        const input = `Before

| Name | Role |
| --- | --- |
| Ada | Engineer |
| Bob | Research |

After`;

        const expected = `Before

- **Ada:** Engineer
- **Bob:** Research

After`;

        expect(renderPipeTables(input)).toBe(expected);
    });

    it('renders long two-column rows without code-block grids', () => {
        const input = `| Time | Forecast |
| --- | --- |
| 08:00 | Mostly sunny with a light coastal breeze through noon |`;

        const expected = `- **08:00:** Mostly sunny with a light coastal breeze through noon`;

        expect(renderPipeTables(input)).toBe(expected);
    });

    it('renders wide tables as row blocks with labeled fields', () => {
        const input = `| Horario | Temperatura | Condición | Humedad | Viento |
| --- | --- | --- | --- | --- |
| 00:00 - 03:00 | 14,7°C → 12,6°C | Parcialmente despejado → Despejado | 80-88% | 24-26 km/h |
| 04:00 - 08:00 | 12,1°C → 10,1°C | Despejado | 75-86% | 26-28 km/h |`;

        const expected = `**00:00 - 03:00**
- **Temperatura:** 14,7°C → 12,6°C
- **Condición:** Parcialmente despejado → Despejado
- **Humedad:** 80-88%
- **Viento:** 24-26 km/h

**04:00 - 08:00**
- **Temperatura:** 12,1°C → 10,1°C
- **Condición:** Despejado
- **Humedad:** 75-86%
- **Viento:** 26-28 km/h`;

        expect(renderPipeTables(input)).toBe(expected);
    });

    it('keeps non-generic first-column headers in the row title', () => {
        const input = `| Tramo | Viento | Riesgo |
| --- | --- | --- |
| Costa | 15 km/h | Bajo |`;

        const expected = `**Tramo: Costa**
- **Viento:** 15 km/h
- **Riesgo:** Bajo`;

        expect(renderPipeTables(input)).toBe(expected);
    });

    it('leaves table-looking content inside fenced code blocks untouched', () => {
        const input = `\`\`\`
| Name | Role |
| --- | --- |
| Ada | Engineer |
\`\`\``;

        expect(renderPipeTables(input)).toBe(input);
    });
});
