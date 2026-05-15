export class OpenAILikeConfig {
    // oailike api key
    OAILIKE_API_KEY: string | null = null;
    // oailike api base. Accepts either the root `/v1` base or a full LLM endpoint such as `/v1/responses` or `/v1/chat/completions`.
    OAILIKE_API_BASE = 'https://api.openai.com/v1';
    // oailike api model
    OAILIKE_CHAT_MODEL = 'gpt-5.4-mini';
    // oailike image model
    OAILIKE_IMAGE_MODEL = 'gpt-image-2';
    // oailike vision model
    OAILIKE_VISION_MODEL = 'gpt-5.4-mini';
    // oailike image background
    OAILIKE_IMAGE_BACKGROUND: 'auto' | 'opaque' | 'transparent' = 'auto';
    // oailike image input fidelity
    OAILIKE_IMAGE_INPUT_FIDELITY: 'low' | 'high' = 'low';
    // oailike image moderation
    OAILIKE_IMAGE_MODERATION: 'auto' | 'low' = 'auto';
    // oailike image output compression
    OAILIKE_IMAGE_OUTPUT_COMPRESSION = 100;
    // oailike image output format
    OAILIKE_IMAGE_OUTPUT_FORMAT: 'png' | 'jpeg' | 'webp' = 'png';
    // oailike image quality
    OAILIKE_IMAGE_QUALITY: 'auto' | 'low' | 'medium' | 'high' = 'auto';
    // oailike image size
    OAILIKE_IMAGE_SIZE: 'auto' | '1024x1024' | '1024x1536' | '1536x1024' = '1024x1024';
    // oailike asr model
    OAILIKE_STT_MODEL = 'gpt-4o-mini-transcribe';
    OAILIKE_STT_EXTRA_PARAMS: Record<string, string> = {};
    // oailike tts model
    OAILIKE_TTS_MODEL = 'gpt-4o-mini-tts';
    // oailike tts extra params
    OAILIKE_TTS_EXTRA_PARAMS: Record<string, any> = {};
    // oailike tts voice
    OAILIKE_TTS_VOICE = 'alloy';
    OAILIKE_TTS_PROMPT = '';
    // OAILIKE API Extra Params, key is model name prefix, separated by commas; value is extra Params, support path(camelCase), split by '.'
    // for example: OAILIKE_API_EXTRA_PARAMS = { 'gpt-5.4,gpt-5.4-mini': { 'reasoningEffort': 'high' } };
    OAILIKE_API_EXTRA_PARAMS: Record<string, Record<string, any>> = {};
    OAILIKE_MODELS = [];
    OAILIKE_MODELS_API = '/models';
    // OAILIKE Provider Options
    OAILIKE_PROVIDER_OPTIONS = {};
}
