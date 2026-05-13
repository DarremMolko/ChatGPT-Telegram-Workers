import { describe, expect, it } from 'vitest';
import { renderPipeTablesAsCodeBlocks } from './pipe_table';

describe('renderPipeTablesAsCodeBlocks', () => {
    it('renders markdown pipe tables as fenced code blocks', () => {
        const input = `Before

| Name | Role |
| --- | --- |
| Ada | Engineer |
| Bob | Research |

After`;

        const expected = `Before

\`\`\`
┌──────┬──────────┐
│ Name │ Role     │
├──────┼──────────┤
│ Ada  │ Engineer │
│ Bob  │ Research │
└──────┴──────────┘
\`\`\`

After`;

        expect(renderPipeTablesAsCodeBlocks(input)).toBe(expected);
    });

    it('wraps long cells to keep the rendered table readable', () => {
        const input = `| Time | Forecast |
| --- | --- |
| 08:00 | Mostly sunny with a light coastal breeze through noon |`;

        const expected = `\`\`\`
┌───────┬──────────────────────────────────────┐
│ Time  │ Forecast                             │
├───────┼──────────────────────────────────────┤
│ 08:00 │ Mostly sunny with a light coastal    │
│       │ breeze through noon                  │
└───────┴──────────────────────────────────────┘
\`\`\``;

        expect(renderPipeTablesAsCodeBlocks(input)).toBe(expected);
    });

    it('renders wide tables as stacked cards for mobile readability', () => {
        const input = `| Horario | Temperatura | Condición | Humedad | Viento |
| --- | --- | --- | --- | --- |
| 00:00 - 03:00 | 14,7°C → 12,6°C | Parcialmente despejado → Despejado | 80-88% | 24-26 km/h |
| 04:00 - 08:00 | 12,1°C → 10,1°C | Despejado | 75-86% | 26-28 km/h |`;

        const expected = `\`\`\`
┌────────────────────────────────────────────┐
│ Horario: 00:00 - 03:00                     │
│ Temperatura: 14,7°C → 12,6°C               │
│ Condición: Parcialmente despejado →        │
│ Despejado                                  │
│ Humedad: 80-88%                            │
│ Viento: 24-26 km/h                         │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Horario: 04:00 - 08:00                     │
│ Temperatura: 12,1°C → 10,1°C               │
│ Condición: Despejado                       │
│ Humedad: 75-86%                            │
│ Viento: 26-28 km/h                         │
└────────────────────────────────────────────┘
\`\`\``;

        expect(renderPipeTablesAsCodeBlocks(input)).toBe(expected);
    });

    it('leaves table-looking content inside fenced code blocks untouched', () => {
        const input = `\`\`\`
| Name | Role |
| --- | --- |
| Ada | Engineer |
\`\`\``;

        expect(renderPipeTablesAsCodeBlocks(input)).toBe(input);
    });
});
