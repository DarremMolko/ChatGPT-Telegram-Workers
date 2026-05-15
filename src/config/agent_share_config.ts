export class AgentShareConfig {
    // AI provider: openai, oailike
    AI_CHAT_PROVIDER = 'openai';
    // Image provider: openai, oailike
    AI_IMAGE_PROVIDER = 'openai';
    // AI ASR provider: openai, oailike
    AI_ASR_PROVIDER = 'openai';
    // AI TTS provider: openai, oailike
    AI_TTS_PROVIDER = 'openai';
    // Global default system/init message
    SYSTEM_INIT_MESSAGE: string | null = null;
}
