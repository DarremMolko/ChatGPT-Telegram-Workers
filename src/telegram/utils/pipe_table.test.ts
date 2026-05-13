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

    it('leaves table-looking content inside fenced code blocks untouched', () => {
        const input = `\`\`\`
| Name | Role |
| --- | --- |
| Ada | Engineer |
\`\`\``;

        expect(renderPipeTablesAsCodeBlocks(input)).toBe(input);
    });
});
