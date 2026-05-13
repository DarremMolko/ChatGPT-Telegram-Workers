import { describe, expect, it } from 'vitest';
import { renderPipeTablesAsMonospaceBlocks } from './pipe_table';

describe('renderPipeTablesAsMonospaceBlocks', () => {
    it('renders two-column tables as compact monospace pairs', () => {
        const input = `Before

| Dato | Valor |
| --- | --- |
| **Máxima** | **17.9°C** (18:00 hs) |
| **Mínima** | **10.1°C** (09:00-11:00 hs) |
| **Sensación térmica más baja** | Entre 7.3°C y 15.3°C |

After`;

        const expected = `Before

\`\`\`
Máxima: 17.9°C (18:00 hs)
Mínima: 10.1°C (09:00-11:00 hs)
Sensación térmica más baja:
  Entre 7.3°C y 15.3°C
\`\`\`

After`;

        expect(renderPipeTablesAsMonospaceBlocks(input)).toBe(expected);
    });

    it('renders wide tables as borderless row records', () => {
        const input = `| Horario | Temperatura | Condición | Humedad | Viento |
| --- | --- | --- | --- | --- |
| 00:00-03:00 | 14.7°C → 12.6°C | Parcialmente despejado → despejado | 80-88% | 24-26 km/h |
| 04:00-08:00 | 12.1°C → 10.1°C | Despejado | 75-86% | 26-28 km/h |`;

        const expected = `\`\`\`
00:00-03:00
  Temp:   14.7°C → 12.6°C
  Cond:   Parcialmente despejado →
          despejado
  Hum:    80-88%
  Viento: 24-26 km/h

04:00-08:00
  Temp:   12.1°C → 10.1°C
  Cond:   Despejado
  Hum:    75-86%
  Viento: 26-28 km/h
\`\`\``;

        expect(renderPipeTablesAsMonospaceBlocks(input)).toBe(expected);
    });

    it('leaves table-looking content inside fenced code blocks untouched', () => {
        const input = `\`\`\`
| Name | Role |
| --- | --- |
| Ada | Engineer |
\`\`\``;

        expect(renderPipeTablesAsMonospaceBlocks(input)).toBe(input);
    });
});
