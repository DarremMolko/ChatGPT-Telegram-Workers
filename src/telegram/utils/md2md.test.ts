import { describe, expect, it } from 'vitest';
import { escape } from './md2tgmd';

const text1 = `>\`gpt-4o 12.5s\`
>\`search\`
>\`110,12\`

>- Hello, Siri!
>- Hi!
>- What can I do for you?
>- Can you help me with my homework?
>- Yes, I can help you.
>- I'm sorry, I am just joking.

Whats the meaning of life?
Can you answer that?
Maybe you can.

> Luxun said:
> The meaning of life is to be happy.
> Its not to be rich.

>You said:
>The meaning of life is to be happy.`;

const tgmd1 = `>\`gpt-4o 12.5s\`
>\`search\`
>\`110,12\`

>• Hello, Siri\\!
>• Hi\\!
>• What can I do for you?
>• Can you help me with my homework?
>• Yes, I can help you\\.
>• I'm sorry, I am just joking\\.

Whats the meaning of life?
Can you answer that?
Maybe you can\\.

>Luxun said:
>The meaning of life is to be happy\\.
>Its not to be rich\\.

>You said:
>The meaning of life is to be happy\\.`;

const tgmd1_expand = `**>\`gpt-4o 12.5s\`
>\`search\`
>\`110,12\`
>
>• Hello, Siri\\!
>• Hi\\!
>• What can I do for you?
>• Can you help me with my homework?
>• Yes, I can help you\\.
>• I'm sorry, I am just joking\\.
>
>Whats the meaning of life?
>Can you answer that?
>Maybe you can\\.
>
>Luxun said:
>The meaning of life is to be happy\\.
>Its not to be rich\\.
>
>You said:
>The meaning of life is to be happy\\.||`;

const text2 = `\`Can you help me **with my math homework**\\? -_-|||\`
Yes, I can _help_ you with your math homework.
\`I'm sorry, I am just joking.\`
\\\`Shut' up\\'
The \`\\\\\` is a backslash.
The \`\\\\\`\` is used to escape the backslash.
\\1 is a number.`;

const tgmd2 = `\`Can you help me **with my math homework**\\? -_-|||\`
Yes, I can _help_ you with your math homework\\.
\`I'm sorry, I am just joking.\`
\\\`Shut' up\\\\'
The \`\\\\\` is a backslash\\.
The \`\\\\\`\\\` is used to escape the backslash\\.
\\\\1 is a number\\.`;

const tgmd2_expand = `**>\`Can you help me **with my math homework**\\? -_-|||\`
>Yes, I can _help_ you with your math homework\\.
>\`I'm sorry, I am just joking.\`
>\\\`Shut' up\\\\'
>The \`\\\\\` is a backslash\\.
>The \`\\\\\`\\\` is used to escape the backslash\\.
>\\\\1 is a number\\.||`;

const text3 = `\`\`\`ts
const a = 1;
\`\`\`
\`\`\`javascript
const a = 1;
const b = \`\${a}\`;`;

const tgmd3 = `\`\`\`ts
const a = 1;
\`\`\`
\`\`\`javascript
const a = 1;
const b = \\\`\${a}\\\`;
\`\`\``;

const tgmd3_expand = `**>\\\`\\\`\\\`ts
>const a \\= 1;
>\\\`\\\`\\\`
>\\\`\\\`\\\`javascript
>const a \\= 1;
>const b \\= \\\`$\\{a\\}\\\`;
>\\\`\\\`\\\`||`;

describe('text1', () => {
    it('fold quote', () => {
        const result = escape(text1, { addQuote: false, quoteExpandable: false });
        expect(result).toBe(tgmd1);
    });
    it('fold quote expandable', () => {
        const result = escape(text1, { addQuote: true, quoteExpandable: true });
        expect(result).toBe(tgmd1_expand);
    });
});

describe('text2', () => {
    it('new inline code escape logic', () => {
        const result = escape(text2);
        expect(result).toBe(tgmd2);
    });
    it('new inline code escape logic expandable', () => {
        const result = escape(text2, { addQuote: true, quoteExpandable: true });
        expect(result).toBe(tgmd2_expand);
    });
});

describe('text3 code block', () => {
    it('code block', () => {
        expect(escape(text3)).toBe(tgmd3);
    });
    it('code block expandable', () => {
        expect(escape(text3, { addQuote: true, quoteExpandable: true })).toBe(tgmd3_expand);
    });
});

const text4 = `(\`test\`)

`;

const tgmd4 = `\\(\`test\`\\)

`;

const tgmd4_expand = `**>\\(\`test\`\\)
>
>||`;

describe('text4', () => {
    it('inline code in inline code', () => {
        expect(escape(text4)).toBe(tgmd4);
    });
    it('inline code in inline code expandables', () => {
        expect(escape(text4, { addQuote: true, quoteExpandable: true })).toBe(tgmd4_expand);
    });
});

const text7 = `\`test code\`
link_1: [link 1](https://google.com/test/link_1_2.html)
link_2: [link 2](https://google.com/test/link_2_2.html)
\`incode **not bold**, not link [link](https://google.com/test/link_2_2.html)\`
`;

const md7_linktest = `\`test code\`
link\\_1: [link 1](https://google\\.com/test/link\\_1\\_2\\.html)
link\\_2: [link 2](https://google\\.com/test/link\\_2\\_2\\.html)
\`incode **not bold**, not link [link](https://google.com/test/link_2_2.html)\`
`;

describe('text7', () => {
    it('link test', () => {
        expect(escape(text7)).toBe(md7_linktest);
    });
});
