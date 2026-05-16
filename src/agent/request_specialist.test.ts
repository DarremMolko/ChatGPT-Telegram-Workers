import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    AIMiddlewareMock,
    appendStreamSourcesMock,
    createLlmModelMock,
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
    createLlmModelMock: vi.fn(),
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
    tool: (definition: unknown) => definition,
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
    createLlmModel: createLlmModelMock,
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
        OAILIKE_PROVIDER_OPTIONS: { source: 'oailike' },
        OPENAI_PROVIDER_OPTIONS: { source: 'openai' },
        TOOL_MODEL: 'oailike:deepseek-chat',
        TOOL_MODEL_MODE: 'specialist',
        ...overrides,
    } as any;
}

function createModel(overrides: Record<string, any> = {}) {
    return {
        modelId: 'gpt-4.1',
        provider: 'openai.responses',
        ...overrides,
    } as any;
}

function createMessages() {
    return [{
        role: 'user',
        content: [{
            type: 'text',
            text: 'What is the weather in Tokyo today?',
        }],
    }] as any;
}

async function finishStep(params: any, text: string) {
    await params.onStepFinish({
        request: {},
        response: {},
        text,
        toolResults: [],
        usage: {},
    });
}

function createGenerateTextResult(text: string, overrides: Record<string, any> = {}) {
    return {
        providerMetadata: {},
        reasoning: false,
        response: {
            messages: [{ role: 'assistant', content: text }],
        },
        text,
        ...overrides,
    };
}

beforeEach(() => {
    AIMiddlewareMock.mockReset();
    appendStreamSourcesMock.mockClear();
    createLlmModelMock.mockReset();
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

describe('requestChatCompletionsV2 specialist mode', () => {
    it('only exposes delegate_to_specialist to the outer model and runs the subrequest on TOOL_MODEL without recursive delegation', async () => {
        const messages = createMessages();
        let call = 0;
        createLlmModelMock.mockResolvedValue({
            modelId: 'deepseek-chat',
            provider: 'oailike',
        });

        generateTextMock.mockImplementation(async (params: any) => {
            call++;
            if (call === 1) {
                expect(params.providerOptions.openai).toEqual({ source: 'openai' });
                expect(params.providerOptions['oailike.chat']).toBeUndefined();
                expect(Object.keys(params.tools)).toEqual(['delegate_to_specialist']);
                expect(params.activeTools).toEqual(['delegate_to_specialist']);

                const specialistResult = await params.tools.delegate_to_specialist.execute({
                    task: 'Research the weather in Tokyo and summarize the key facts.',
                    context: 'Use the available search tool and keep the answer concise.',
                }, {
                    abortSignal: undefined,
                });

                expect(specialistResult).toEqual({
                    summary: 'specialist findings',
                });

                await finishStep(params, 'final answer');
                return createGenerateTextResult('final answer');
            }

            expect(params.providerOptions.openai).toBeUndefined();
            expect(params.providerOptions['oailike.chat']).toEqual({ source: 'oailike' });
            expect(Object.keys(params.tools)).toEqual(['search']);
            expect(params.activeTools).toEqual(['search']);
            expect(params.system).toContain('internal specialist assistant');
            expect(params.messages).toHaveLength(1);
            expect(params.messages[0].content[0].text).toContain('Delegated task:');
            expect(params.messages[0].content[0].text).toContain('Research the weather in Tokyo');
            expect(params.messages[0].content[0].text).toContain('What is the weather in Tokyo today?');
            await finishStep(params, 'specialist findings');
            return createGenerateTextResult('specialist findings');
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

        expect(createLlmModelMock).toHaveBeenCalledWith('oailike:deepseek-chat', expect.anything());
        expect(generateTextMock).toHaveBeenCalledTimes(2);
        expect(result.content).toBe('final answer');
        expect(result.messages).toEqual([{ role: 'assistant', content: 'final answer' }]);
    });

    it('clears outer toolChoice while passing it through to the specialist request', async () => {
        generateTextMock.mockImplementation(async (params: any) => {
            await finishStep(params, 'ok');
            return createGenerateTextResult('ok');
        });

        await requestChatCompletionsV2({
            activeTools: ['search'],
            context: createContext(),
            messages: createMessages(),
            model: createModel(),
            system: 'Be helpful.',
            toolChoice: [{ type: 'tool', toolName: 'search' }],
            tools: { search: {} },
        }, null);

        expect(AIMiddlewareMock).toHaveBeenCalledTimes(1);
        expect(AIMiddlewareMock.mock.calls[0][0].activeTools).toEqual(['delegate_to_specialist']);
        expect(AIMiddlewareMock.mock.calls[0][0].toolChoice).toEqual([]);
    });

    it('strips internal thinking wrappers from the specialist summary passed back to the caller', async () => {
        let call = 0;
        createLlmModelMock.mockResolvedValue({
            modelId: 'deepseek-chat',
            provider: 'oailike',
        });

        generateTextMock.mockImplementation(async (params: any) => {
            call++;
            if (call === 1) {
                const specialistResult = await params.tools.delegate_to_specialist.execute({
                    task: 'Look up the weather.',
                    context: 'Use tools if needed.',
                }, {
                    abortSignal: undefined,
                });

                expect(specialistResult).toEqual({
                    summary: 'Clean final answer',
                });

                await finishStep(params, 'outer answer');
                return createGenerateTextResult('outer answer');
            }

            await finishStep(params, 'Clean final answer');
            return createGenerateTextResult('Clean final answer', {
                reasoning: true,
                reasoningText: 'internal chain of thought',
            });
        });

        await requestChatCompletionsV2({
            activeTools: ['search'],
            context: createContext(),
            messages: createMessages(),
            model: createModel(),
            system: 'Be helpful.',
            toolChoice: undefined,
            tools: { search: {} },
        }, null);

        expect(generateTextMock).toHaveBeenCalledTimes(2);
    });
});
