import { afterEach, describe, expect, it } from 'vitest';
import { clearLog, getLog, getLogSingleton } from './log_decortor';

describe('getLog tool formatting', () => {
    const config = {
        ENABLE_SHOWINFO: true,
        SHOW_PARTS: ['model', 'model_time', 'tool', 'tool_time'],
        SHOW_TOOL_ARGS_MAX_LENGTH: 80,
    } as any;

    afterEach(() => {
        clearLog(config);
    });

    it('omits undefined tool durations', () => {
        const log = getLogSingleton({ config });
        log.model = 'claude-opus-4.6-vapi';
        log.start_time = 0;
        log.end_time = 1000;
        log.functions.push({
            name: 'search_tools',
            args: ['scrape web page content extract article URL', 10],
        });

        const output = getLog(config);

        expect(output).toContain('search_tools');
        expect(output).not.toContain('undefineds');
    });

    it('shows tool duration only when enabled and present', () => {
        const log = getLogSingleton({ config });
        log.model = 'claude-opus-4.6-vapi';
        log.start_time = 0;
        log.end_time = 1000;
        log.functions.push({
            name: 'call_tool',
            args: ['jina-read_url', { url: 'https://example.com' }],
            time: 4.9,
        });

        const output = getLog(config);

        expect(output).toContain('call_tool');
        expect(output).toContain('4.9s');
    });

    it('truncates tool args by default with an ellipsis', () => {
        const log = getLogSingleton({ config });
        log.model = 'claude-opus-4.6-vapi';
        log.start_time = 0;
        log.end_time = 1000;
        log.functions.push({
            name: 'call_tool',
            args: ['weather-get_weather_details', { city: 'Paraná, Argentina', include_forecast: true, notes: 'x'.repeat(120) }],
        });

        const output = getLog(config);

        expect(output).toContain('call_tool');
        expect(output).toContain('...');
    });

    it('shows full tool args when max length is -1', () => {
        const fullConfig = {
            ...config,
            SHOW_TOOL_ARGS_MAX_LENGTH: -1,
        } as any;
        const log = getLogSingleton({ config: fullConfig });
        log.model = 'claude-opus-4.6-vapi';
        log.start_time = 0;
        log.end_time = 1000;
        log.functions.push({
            name: 'call_tool',
            args: ['weather-get_weather_details', { city: 'Paraná, Argentina', include_forecast: true }],
        });

        const output = getLog(fullConfig);

        expect(output).toContain('"city":"Paraná, Argentina"');
        expect(output).toContain('"include_forecast":true');

        clearLog(fullConfig);
    });
});
