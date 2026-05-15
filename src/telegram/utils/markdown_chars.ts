export function stripLeadingSpaces(line: string): string {
    let index = 0;
    while (index < line.length && line[index] === ' ') {
        index++;
    }
    return line.slice(index);
}

export function stripUpToThreeSpaces(line: string): string {
    let index = 0;
    while (index < line.length && index < 3 && line[index] === ' ') {
        index++;
    }
    return line.slice(index);
}

export function readLeadingSpaces(line: string, limit: number): { offset: number; value: string } {
    let index = 0;
    while (index < line.length && index < limit && line[index] === ' ') {
        index++;
    }
    return {
        offset: index,
        value: line.slice(0, index),
    };
}

export function isWhitespaceChar(char: string | undefined): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

export function isDigit(char: string | undefined): boolean {
    if (!char) {
        return false;
    }
    const code = char.charCodeAt(0);
    return code >= 48 && code <= 57;
}

export function isWordChar(char: string | undefined): boolean {
    if (!char) {
        return false;
    }
    const code = char.charCodeAt(0);
    return char === '_'
        || (code >= 48 && code <= 57)
        || (code >= 65 && code <= 90)
        || (code >= 97 && code <= 122)
        || code > 127;
}
