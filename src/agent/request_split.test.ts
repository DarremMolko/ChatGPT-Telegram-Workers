import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    AIMiddlewareMock,
    appendStreamSourcesMock,
    createThinkingExtractorMock,
    generateTextMock,
    getAgentProviderMock,
    metaDataExtractorMock,
    resolveLlmTargetMock,
    stepCountIsMock,
    streamHandlerMock,
    streamTextMock,
    wrapLanguageModelMock,
} = vi.hoisted(() => ({
    AIMiddlewareMock: vi.fn(),
    appendStreamSourcesMock: vi.fn((content: string) => content),
    createThinkingExtractorMock: vi.fn(() => () => ''),
    generateTextMock: vi.fn(),
    getAgentProviderMock: vi.fn((model: { provider: string }) => model.provider.startsWith('oailike') ? 'oailike' : 'openai'),
    metaDataExtractorMock: vi.fn((_: unknown, __: string, content: string) => content),
    resolveLlmTargetMock: vi.fn((model: string, context: Record<string, any>) => {
        const [agent, modelId] = model.includes(':') ? model.split(':') : [context.AI_CHAT_PROVIDER, model];
        return {
            agent,
            modelId,
            useResponsesApi: false,
        };
    }),
    stepCountIsMock: vi.fn(() => Symbol('stopWhen')),
    streamHandlerMock: vi.fn(),
    streamTextMock: vi.fn(),
    wrapLanguageModelMock: vi.fn(({ model }: { model: unknown }) => model),
}));

vi.mock('ai', () => ({
    generateText: generateTextMock,
    stepCountIs: stepCountIsMock,
    streamText: streamTextMock,
    wrapLanguageModel: wrapLanguageModelMock,
}));

vi.mock('../config/env', () => ({
    ENV: {
        CHAT_TOTAL_DURATION_LIMIT: 0,
        EXPANDABLE_THINKING: true,
    },
}));

vi.mock('../log', () => ({
    log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('./llm', () => ({
    getAgentProvider: getAgentProviderMock,
    resolveLlmTarget: resolveLlmTargetMock,
}));

vi.mock('./model_middleware', () => ({
    AIMiddleware: AIMiddlewareMock,
    metaDataExtractor: metaDataExtractorMock,
}));

vi.mock('./streaming', () => ({
    appendStreamSources: appendStreamSourcesMock,
    createThinkingExtractor: createThinkingExtractorMock,
    streamHandler: streamHandlerMock,
}));

const { requestChatCompletionsV2 } = await import('./request');

function createContext(overrides: Record<string, any> = {}) {
    return {
        AI_CHAT_PROVIDER: 'openai',
        CHAT_TEMPERATURE: undefined,
        CONTINUE_STEP: false,
        FUNCTION_CALL_TEMPERATURE: undefined,
        MAX_RETRIES: 0,
        MAX_STEPS: 5,
        MAX_TOKENS: undefined,
        OAILIKE_PROVIDER_OPTIONS: {},
        OPENAI_PROVIDER_OPTIONS: {},
        TOOL_MODEL: 'oailike:tool-model',
        ...overrides,
    } as any;
}

function createModel(overrides: Record<string, any> = {}) {
    return {
        modelId: 'chat-model',
        provider: 'openai.responses',
        ...overrides,
    } as any;
}

function createMessages() {
    return [{
        role: 'user',
        content: [{
            type: 'text',
            text: 'What is the weather today?',
        }],
    }] as any;
}

beforeEach(() => {
    AIMiddlewareMock.mockReset();
    appendStreamSourcesMock.mockClear();
    createThinkingExtractorMock.mockClear();
    generateTextMock.mockReset();
    getAgentProviderMock.mockClear();
    metaDataExtractorMock.mockClear();
    resolveLlmTargetMock.mockClear();
    stepCountIsMock.mockClear();
    streamHandlerMock.mockReset();
    streamTextMock.mockReset();
    wrapLanguageModelMock.mockClear();

    AIMiddlewareMock.mockResolvedValue({
        onChunk: vi.fn(),
        onStepFinish: vi.fn(async () => {}),
        prepareStepPre: vi.fn(() => async ({ model }: { model: unknown }) => ({ model })),
        transformParams: vi.fn(async ({ params }: { params: unknown }) => params),
        wrapGenerate: vi.fn(async ({ doGenerate }: { doGenerate: () => Promise<unknown> }) => doGenerate()),
        wrapStream: vi.fn(async ({ doStream }: { doStream: () => Promise<unknown> }) => doStream()),
    });
});

describe('requestChatCompletionsV2 TOOL_MODEL split orchestration', () => {
    it('falls back to a plain chat-model final pass when the planner uses no tools', async () => {
        const messages = createMessages();
        const model = createModel();
        let call = 0;

        generateTextMock.mockImplementation(async (params: any) => {
            call++;
            if (call === 1) {
                expect(params.activeTools).toEqual(['search']);
                await params.onStepFinish({
                    request: {},
                    response: {},
                    text: 'planner answer',
                    toolResults: [],
                    usage: {},
                });
                return {
                    providerMetadata: {},
                    reasoning: false,
                    response: {
                        messages: [{ role: 'assistant', content: 'planner answer' }],
                    },
                    text: 'planner answer',
                };
            }

            expect(params.activeTools).toEqual([]);
            expect(params.messages).toEqual(messages);
            await params.onStepFinish({
                request: {},
                response: {},
                text: 'chat answer',
                toolResults: [],
                usage: {},
            });
            return {
                providerMetadata: {},
                reasoning: false,
                response: {
                    messages: [{ role: 'assistant', content: 'chat answer' }],
                },
                text: 'chat answer',
            };
        });

        const result = await requestChatCompletionsV2({
            activeTools: ['search'],
            context: createContext(),
            messages,
            model,
            system: 'Be helpful.',
            toolChoice: undefined,
            tools: { search: {} },
        }, null);

        expect(generateTextMock).toHaveBeenCalledTimes(2);
        expect(result.content).toBe('chat answer');
        expect(result.messages).toEqual([{ role: 'assistant', content: 'chat answer' }]);
    });

    it('feeds collected tool results into a clean chat-model synthesis pass', async () => {
        const messages = createMessages();
        let call = 0;

        generateTextMock.mockImplementation(async (params: any) => {
            call++;
            if (call === 1) {
                await params.onStepFinish({
                    request: {},
                    response: {},
                    text: 'ignored planner answer',
                    toolResults: [{
                        input: { query: 'weather today' },
                        output: { value: { forecast: 'sunny' } },
                        toolCallId: 'call_1',
                        toolName: 'search',
                    }],
                    usage: {},
                });
                return {
                    providerMetadata: {},
                    reasoning: false,
                    response: {
                        messages: [{ role: 'assistant', content: 'ignored planner answer' }],
                    },
                    text: 'ignored planner answer',
                };
            }

            expect(params.activeTools).toEqual([]);
            const summaryMessage = params.messages.at(-1);
            expect(summaryMessage.role).toBe('user');
            expect(summaryMessage.content[0].text).toContain('[tool `search` invoke detail]');
            expect(summaryMessage.content[0].text).toContain('"query":"weather today"');
            expect(summaryMessage.content[0].text).toContain('"forecast":"sunny"');
            await params.onStepFinish({
                request: {},
                response: {},
                text: 'final chat answer',
                toolResults: [],
                usage: {},
            });
            return {
                providerMetadata: {},
                reasoning: false,
                response: {
                    messages: [{ role: 'assistant', content: 'final chat answer' }],
                },
                text: 'final chat answer',
            };
        });

        const result = await requestChatCompletionsV2({
            activeTools: ['search'],
            context: createContext(),
            messages,
            model: createModel(),
            system: 'Be helpful.',
            toolChoice: undefined,
            tools: { search: {} },
        }, null);

        expect(generateTextMock).toHaveBeenCalledTimes(2);
        expect(result.content).toBe('final chat answer');
        expect(result.messages).toEqual([{ role: 'assistant', content: 'final chat answer' }]);
    });

    it('preserves multi-step tool chains and synthesizes only once on the chat model', async () => {
        const messages = createMessages();
        let call = 0;

        generateTextMock.mockImplementation(async (params: any) => {
            call++;
            if (call === 1) {
                await params.onStepFinish({
                    request: {},
                    response: {},
                    text: '',
                    toolResults: [{
                        input: { query: 'weather today' },
                        output: { value: { locationId: 42 } },
                        toolCallId: 'call_1',
                        toolName: 'search',
                    }],
                    usage: {},
                });
                await params.onStepFinish({
                    request: {},
                    response: {},
                    text: 'ignored planner answer',
                    toolResults: [{
                        input: { locationId: 42 },
                        output: { value: { forecast: 'sunny', temperatureC: 26 } },
                        toolCallId: 'call_2',
                        toolName: 'weather',
                    }],
                    usage: {},
                });
                return {
                    providerMetadata: {},
                    reasoning: false,
                    response: {
                        messages: [{ role: 'assistant', content: 'ignored planner answer' }],
                    },
                    text: 'ignored planner answer',
                };
            }

            expect(params.activeTools).toEqual([]);
            const summaryText = params.messages.at(-1).content[0].text as string;
            expect(summaryText).toContain('[tool `search` invoke detail]');
            expect(summaryText).toContain('[tool `weather` invoke detail]');
            expect(summaryText.indexOf('[tool `search` invoke detail]')).toBeLessThan(summaryText.indexOf('[tool `weather` invoke detail]'));
            expect(summaryText).toContain('"locationId":42');
            expect(summaryText).toContain('"temperatureC":26');
            await params.onStepFinish({
                request: {},
                response: {},
                text: 'final synthesized answer',
                toolResults: [],
                usage: {},
            });
            return {
                providerMetadata: {},
                reasoning: false,
                response: {
                    messages: [{ role: 'assistant', content: 'final synthesized answer' }],
                },
                text: 'final synthesized answer',
            };
        });

        const result = await requestChatCompletionsV2({
            activeTools: ['search', 'weather'],
            context: createContext(),
            messages,
            model: createModel(),
            system: 'Be helpful.',
            toolChoice: undefined,
            tools: { search: {}, weather: {} },
        }, null);

        expect(generateTextMock).toHaveBeenCalledTimes(2);
        expect(result.content).toBe('final synthesized answer');
        expect(result.messages).toEqual([{ role: 'assistant', content: 'final synthesized answer' }]);
    });
});
