import { describe, expect, it } from 'vitest';
import { formatCommandErrorMessage } from './error';

describe('formatCommandErrorMessage', () => {
    it('extracts nested provider error details from HTTP error payloads', () => {
        const error = new Error(`400 Bad Request

{"error":"Error: Current provider response failed: {'success': False, 'error': {'name': 'ZodError', 'message': 'voice is invalid'}}"}`);

        expect(formatCommandErrorMessage(error)).toBe(`Error
400 Bad Request

Current provider response failed: {'success': False, 'error': {'name': 'ZodError', 'message': 'voice is invalid'}}`);
    });

    it('redacts sensitive values from the rendered error', () => {
        const error = new Error('token bot-token leaked');

        expect(formatCommandErrorMessage(error, { redactions: ['bot-token'] })).toBe(`Error
token [REDACTED] leaked`);
    });
});
