export { officialMediaCapabilities, isOfficialMediaProtocol } from "./media-capabilities.js";
import type { MediaApiTemplate } from "./media-api-template.js";

export type OfficialProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "xai"
  | "mistral"
  | "cohere"
  | "openrouter"
  | "deepseek"
  | "qwen"
  | "zhipu"
  | "moonshot"
  | "minimax"
  | "minimax_media"
  | "elevenlabs"
  | "elevenlabs_sound"
  | "doubao"
  | "ernie"
  | "hunyuan"
  | "azure_openai"
  | "bedrock"
  | "vertex"
  | "ollama"
  | "custom_openai"
  | "custom_media";

export type OfficialProviderProtocol =
  | "openai_responses"
  | "openai_chat_completions"
  | "anthropic_messages"
  | "gemini_generate_content"
  | "cohere_chat"
  /** Explicit first-party media APIs; never treated as OpenAI-compatible. */
  | "elevenlabs_music"
  | "elevenlabs_sound_effect"
  | "minimax_music"
  /** 速创 API asynchronous video endpoints (submit, then poll /detail). */
  | "async_media_template";

/**
 * Where a direct provider connection obtains its credential.  `environment`
 * never stores a secret in NextMux; the provider SDK resolves the user's
 * provider-specific environment authentication at request time: Google ADC,
 * Azure API key, or Bedrock bearer/static AWS environment credentials. This
 * does not imply that every SDK resolves shared files or SSO profiles.
 */
export type OfficialProviderCredentialSource = "api_key" | "environment" | "none";

/** An invocation identifier is still not proof of inference permission. */
export type OfficialModelSelectionMode = "catalog_only" | "invokable";

export function isInvokableDiscoveredModel(model: { readonly selectionMode?: OfficialModelSelectionMode }): boolean {
  return model.selectionMode === undefined || model.selectionMode === "invokable";
}

/**
 * Non-secret settings required by provider-native transports. Secrets remain
 * in the OS keychain; these values are safe to persist alongside a connection
 * and are intentionally a small, provider-neutral union.
 */
export interface OfficialProviderSettings {
  readonly credentialSource?: OfficialProviderCredentialSource;
  readonly region?: string;
  readonly project?: string;
  readonly location?: string;
  readonly apiVersion?: string;
  readonly useDeploymentBasedUrls?: boolean;
  /** Ollama context ceiling in tokens; omitted means automatic request sizing. */
  readonly ollamaContextTokens?: number;
  /** 自定义生成接口: how its async tasks are submitted, polled and read (media-api-template). */
  readonly mediaTemplate?: MediaApiTemplate;
  /** Media wire only: omitted keeps legacy automatic host selection. Chat and plugin protocols are unchanged. */
  readonly mediaApiStyle?: "openai" | "openrouter";
}

/**
 * Native environment credential chains are intentionally opt-in and limited
 * to providers whose maintained SDKs can resolve them without us inventing a
 * secret format or asking users to paste private JSON into the UI.
 */
export function officialProviderSupportsCredentialSource(
  providerId: OfficialProviderId,
  source: OfficialProviderCredentialSource,
): boolean {
  if (providerId === "ollama") return source === "none";
  if (source === "none") return false;
  return source === "api_key"
    || providerId === "azure_openai"
    || providerId === "vertex"
    || providerId === "bedrock";
}

export interface OfficialBaseUrlOption {
  readonly id: string;
  readonly label: string;
  readonly region: string;
  readonly url: string;
}

export interface OfficialProviderPreset {
  readonly id: OfficialProviderId;
  readonly name: string;
  readonly modelFamily: string;
  readonly description: string;
  readonly protocol: OfficialProviderProtocol;
  readonly source: "official" | "custom";
  readonly baseUrls: readonly OfficialBaseUrlOption[];
  readonly defaultBaseUrl: string;
  readonly allowBaseUrlEdit: boolean;
  readonly suggestedModels: readonly string[];
  readonly defaultModel: string;
  readonly apiKeyPlaceholder: string;
  readonly consoleUrl?: string;
  readonly documentationUrl?: string;
  /** Some providers expose deployments/models only through a control plane. */
  readonly modelDiscovery?: "standard" | "azure_catalog" | "bedrock_catalog" | "unsupported";
  readonly connectionNote: string;
}

export const OFFICIAL_PROVIDER_PRESETS: readonly OfficialProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    modelFamily: "GPT",
    description: "推理、编程与工具调用",
    protocol: "openai_responses",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://api.openai.com/v1" }],
    defaultBaseUrl: "https://api.openai.com/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4-mini"],
    defaultModel: "gpt-5.6-terra",
    apiKeyPlaceholder: "sk-…",
    consoleUrl: "https://platform.openai.com/api-keys",
    documentationUrl: "https://platform.openai.com/docs/api-reference/responses/create",
    connectionNote: "使用 OpenAI 官方 API；凭据仅保存在本机系统钥匙串。"
  },
  {
    id: "anthropic",
    name: "Anthropic",
    modelFamily: "Claude",
    description: "长上下文、代码理解与复杂 Agent",
    protocol: "anthropic_messages",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://api.anthropic.com/v1" }],
    defaultBaseUrl: "https://api.anthropic.com/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-5",
    apiKeyPlaceholder: "sk-ant-…",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    documentationUrl: "https://platform.claude.com/docs/en/api/messages",
    connectionNote: "使用 Claude Messages API；不会模拟 claude.ai 登录。"
  },
  {
    id: "gemini",
    name: "Google AI",
    modelFamily: "Gemini",
    description: "多模态、长上下文与 Agent 工作流",
    protocol: "gemini_generate_content",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://generativelanguage.googleapis.com/v1beta" }],
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    allowBaseUrlEdit: false,
    suggestedModels: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"],
    defaultModel: "gemini-3.7-flash",
    apiKeyPlaceholder: "AIza…",
    consoleUrl: "https://aistudio.google.com/apikey",
    documentationUrl: "https://ai.google.dev/gemini-api/docs/function-calling",
    connectionNote: "使用 Gemini GenerateContent API，并保留工具调用所需的思考签名。"
  },
  {
    id: "azure_openai",
    name: "Azure OpenAI",
    modelFamily: "OpenAI",
    description: "企业部署、Responses、推理与工具调用",
    protocol: "openai_responses",
    source: "official",
    baseUrls: [{ id: "resource", label: "Azure 资源", region: "Global", url: "https://RESOURCE.openai.azure.com/openai/v1" }],
    defaultBaseUrl: "https://RESOURCE.openai.azure.com/openai/v1",
    allowBaseUrlEdit: true,
    suggestedModels: [],
    defaultModel: "",
    apiKeyPlaceholder: "Azure OpenAI API Key",
    consoleUrl: "https://portal.azure.com/",
    documentationUrl: "https://learn.microsoft.com/azure/ai-services/openai/reference",
    modelDiscovery: "azure_catalog",
    connectionNote: "模型 ID 填写 Azure OpenAI 的 deployment name；目录模型不是部署别名。支持 API Key 或明确选择本机环境中的 AZURE_API_KEY。"
  },
  {
    id: "vertex",
    name: "Google Vertex AI",
    modelFamily: "Gemini",
    description: "企业项目、多模态、推理与工具调用",
    protocol: "gemini_generate_content",
    source: "official",
    baseUrls: [{ id: "global", label: "全球 Express", region: "Global", url: "https://aiplatform.googleapis.com/v1/publishers/google" }],
    defaultBaseUrl: "https://aiplatform.googleapis.com/v1/publishers/google",
    allowBaseUrlEdit: true,
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
    defaultModel: "gemini-2.5-flash",
    apiKeyPlaceholder: "Google Vertex API Key",
    consoleUrl: "https://console.cloud.google.com/vertex-ai",
    documentationUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference",
    modelDiscovery: "unsupported",
    connectionNote: "可使用 Google Vertex API Key 或 Google Cloud ADC；项目与区域由本机配置决定，不会把 JSON 私钥塞进 API Key 字段。"
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    modelFamily: "Bedrock",
    description: "Converse、跨厂商模型、推理与工具调用",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [{ id: "us-east-1", label: "美国东部", region: "us-east-1", url: "https://bedrock-runtime.us-east-1.amazonaws.com" }],
    defaultBaseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    allowBaseUrlEdit: true,
    suggestedModels: ["us.amazon.nova-pro-v1:0", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "us.meta.llama4-maverick-17b-instruct-v1:0"],
    defaultModel: "us.amazon.nova-pro-v1:0",
    apiKeyPlaceholder: "Bedrock bearer token",
    consoleUrl: "https://console.aws.amazon.com/bedrock/",
    documentationUrl: "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html",
    modelDiscovery: "bedrock_catalog",
    connectionNote: "使用官方 Bedrock Converse API；支持 bearer token（含 AWS_BEARER_TOKEN_BEDROCK），或环境中的 AWS_REGION、AWS_ACCESS_KEY_ID、AWS_SECRET_ACCESS_KEY 与可选 AWS_SESSION_TOKEN。只读基础模型目录仅支持 bearer 凭据，不代表模型调用权限或 inference profile；尚未接入共享配置文件或 SSO 凭据链，不把 AWS Secret Key 当作普通 API Key 保存。"
  },
  {
    id: "xai",
    name: "xAI",
    modelFamily: "Grok",
    description: "编程、推理、多模态与实时信息",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://api.x.ai/v1" }],
    defaultBaseUrl: "https://api.x.ai/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["grok-4.6", "grok-4.5", "grok-build"],
    defaultModel: "grok-4.6",
    apiKeyPlaceholder: "xai-…",
    consoleUrl: "https://console.x.ai/",
    documentationUrl: "https://docs.x.ai/developers/rest-api-reference/inference/chat",
    connectionNote: "使用 xAI 官方 Chat Completions API。"
  },
  {
    id: "mistral",
    name: "Mistral AI",
    modelFamily: "Mistral",
    description: "多语言、代码、低延迟与工具调用",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://api.mistral.ai/v1" }],
    defaultBaseUrl: "https://api.mistral.ai/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["mistral-large-latest", "mistral-medium-latest", "codestral-latest", "devstral-latest"],
    defaultModel: "mistral-large-latest",
    apiKeyPlaceholder: "API Key",
    consoleUrl: "https://console.mistral.ai/api-keys",
    documentationUrl: "https://docs.mistral.ai/api/endpoint/chat",
    connectionNote: "使用 Mistral AI 官方 Chat Completions API。"
  },
  {
    id: "cohere",
    name: "Cohere",
    modelFamily: "Command",
    description: "企业检索、多语言与工具调用",
    protocol: "cohere_chat",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://api.cohere.com/v2" }],
    defaultBaseUrl: "https://api.cohere.com/v2",
    allowBaseUrlEdit: false,
    suggestedModels: ["command-a-plus-05-2026", "command-a-03-2025", "command-r7b-12-2024"],
    defaultModel: "command-a-plus-05-2026",
    apiKeyPlaceholder: "API Key",
    consoleUrl: "https://dashboard.cohere.com/api-keys",
    documentationUrl: "https://docs.cohere.com/v2/reference/chat",
    connectionNote: "使用 Cohere V2 Chat API，并支持原生工具调用。"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    modelFamily: "OpenRouter",
    description: "聚合模型服务，支持动态模型目录",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://openrouter.ai/api/v1" }],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["z-ai/glm-5.3-flash", "~openai/gpt-latest", "~anthropic/claude-latest", "~google/gemini-latest"],
    defaultModel: "z-ai/glm-5.3-flash",
    apiKeyPlaceholder: "sk-or-v1-…",
    consoleUrl: "https://openrouter.ai/settings/keys",
    documentationUrl: "https://openrouter.ai/docs/quickstart",
    connectionNote: "使用 OpenRouter 官方 API；模型目录和路由价格以 OpenRouter 返回结果为准。"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    modelFamily: "DeepSeek",
    description: "中文、推理、代码与工具调用",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [{ id: "official", label: "官方", region: "Global", url: "https://api.deepseek.com" }],
    defaultBaseUrl: "https://api.deepseek.com",
    allowBaseUrlEdit: false,
    suggestedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    defaultModel: "deepseek-v4-pro",
    apiKeyPlaceholder: "sk-…",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    documentationUrl: "https://api-docs.deepseek.com/guides/tool_calls/",
    connectionNote: "使用 DeepSeek 官方 OpenAI 兼容接口；默认不强制开启思考模式。"
  },
  {
    id: "qwen",
    name: "Alibaba Cloud Model Studio",
    modelFamily: "Qwen",
    description: "中文、代码、多模态与多区域接入",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [
      { id: "intl", label: "国际", region: "International", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
      { id: "cn", label: "中国内地", region: "CN", url: "https://dashscope.aliyuncs.com/compatible-mode/v1" }
    ],
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    allowBaseUrlEdit: true,
    suggestedModels: ["qwen3.8-max", "qwen3.7-plus", "qwen3-coder-next", "qwen3.7-flash"],
    defaultModel: "qwen3.8-max",
    apiKeyPlaceholder: "sk-…",
    consoleUrl: "https://bailian.console.aliyun.com/",
    documentationUrl: "https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen",
    connectionNote: "可选择中国内地或国际公共域名，也可填写百炼工作空间专属 HTTPS 域名。"
  },
  {
    id: "zhipu",
    name: "Zhipu AI",
    modelFamily: "GLM",
    description: "长上下文、推理、代码与 Agent",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [
      { id: "official", label: "中国内地", region: "CN", url: "https://open.bigmodel.cn/api/paas/v4" },
      { id: "intl", label: "国际", region: "International", url: "https://api.z.ai/api/paas/v4" },
      { id: "coding-cn", label: "GLM Coding Plan（中国内地）", region: "CN", url: "https://open.bigmodel.cn/api/coding/paas/v4" },
      { id: "coding-intl", label: "GLM Coding Plan（国际）", region: "International", url: "https://api.z.ai/api/coding/paas/v4" },
    ],
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    allowBaseUrlEdit: false,
    suggestedModels: ["glm-5.3-flash", "glm-5.3", "glm-5", "glm-4.7"],
    defaultModel: "glm-5.3-flash",
    apiKeyPlaceholder: "API Key",
    consoleUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    documentationUrl: "https://docs.bigmodel.cn/",
    connectionNote: "使用 Zhipu AI 官方 OpenAI 兼容接口。"
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    modelFamily: "Kimi",
    description: "长上下文、编程、推理与 Agent",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [
      { id: "global", label: "全球", region: "Global", url: "https://api.moonshot.ai/v1" },
      { id: "cn", label: "中国", region: "CN", url: "https://api.moonshot.cn/v1" }
    ],
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"],
    defaultModel: "kimi-k3",
    apiKeyPlaceholder: "sk-…",
    consoleUrl: "https://platform.moonshot.cn/console/api-keys",
    documentationUrl: "https://platform.moonshot.cn/docs/",
    connectionNote: "根据账号区域选择 Moonshot AI 官方 API 地址。"
  },
  {
    id: "minimax",
    name: "MiniMax",
    modelFamily: "MiniMax",
    description: "编程、工具调用、语音与视频创作",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [
      { id: "global", label: "全球", region: "Global", url: "https://api.minimax.io/v1" },
      { id: "cn", label: "中国", region: "CN", url: "https://api.minimaxi.com/v1" }
    ],
    defaultBaseUrl: "https://api.minimax.io/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5"],
    defaultModel: "MiniMax-M2.7",
    apiKeyPlaceholder: "sk-…",
    consoleUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    documentationUrl: "https://platform.minimaxi.com/docs/api-reference/api-overview",
    connectionNote: "根据账号区域选择 MiniMax 官方 API 地址。"
  },
  {
    id: "minimax_media",
    name: "MiniMax 音乐",
    modelFamily: "MiniMax Music",
    description: "官方音乐生成 API",
    protocol: "minimax_music",
    source: "official",
    baseUrls: [
      { id: "global", label: "全球", region: "Global", url: "https://api.minimax.io/v1" },
      { id: "cn", label: "中国", region: "CN", url: "https://api.minimaxi.com/v1" }
    ],
    defaultBaseUrl: "https://api.minimax.io/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["music-3.0", "music-2.6"],
    defaultModel: "music-3.0",
    apiKeyPlaceholder: "API Key",
    consoleUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    documentationUrl: "https://platform.minimax.io/docs/api-reference/music-generation",
    modelDiscovery: "unsupported",
    connectionNote: "使用 MiniMax 官方音乐接口，仅限已有音乐 API 权限的付费账号。"
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs 音频",
    modelFamily: "Eleven Music / SFX",
    description: "官方音乐与音效生成 API",
    protocol: "elevenlabs_music",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://api.elevenlabs.io/v1" }],
    defaultBaseUrl: "https://api.elevenlabs.io/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["music_v1", "music_v2", "music_v2_5"],
    defaultModel: "music_v2_5",
    apiKeyPlaceholder: "xi-api-key",
    consoleUrl: "https://elevenlabs.io/app/settings/api-keys",
    documentationUrl: "https://elevenlabs.io/docs/api-reference/music/compose",
    modelDiscovery: "unsupported",
    connectionNote: "使用 ElevenLabs 官方音乐接口。音效请新建连接并选择音效协议。"
  },
  {
    id: "elevenlabs_sound",
    name: "ElevenLabs 音效",
    modelFamily: "Eleven Sound Effects",
    description: "官方音效生成 API",
    protocol: "elevenlabs_sound_effect",
    source: "official",
    baseUrls: [{ id: "global", label: "全球", region: "Global", url: "https://api.elevenlabs.io/v1" }],
    defaultBaseUrl: "https://api.elevenlabs.io/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["eleven_text_to_sound_v2"],
    defaultModel: "eleven_text_to_sound_v2",
    apiKeyPlaceholder: "xi-api-key",
    consoleUrl: "https://elevenlabs.io/app/settings/api-keys",
    documentationUrl: "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert",
    modelDiscovery: "unsupported",
    connectionNote: "使用 ElevenLabs 官方 sound-generation 接口。"
  },
  {
    id: "doubao",
    name: "ByteDance Volcano Engine",
    modelFamily: "Doubao",
    description: "多模态、代码、图像与视频生成",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [{ id: "cn", label: "Volcano Ark", region: "CN", url: "https://ark.cn-beijing.volces.com/api/v3" }],
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    allowBaseUrlEdit: false,
    suggestedModels: ["doubao-seed-2-1-pro-260628", "doubao-seed-2-1-turbo", "doubao-seed-2-0-code-260215"],
    defaultModel: "doubao-seed-2-1-pro-260628",
    apiKeyPlaceholder: "API Key",
    consoleUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
    documentationUrl: "https://www.volcengine.com/docs/82379/1795150",
    connectionNote: "使用火山方舟官方 OpenAI 兼容接口。"
  },
  {
    id: "ernie",
    name: "Baidu AI Cloud",
    modelFamily: "ERNIE",
    description: "推理、知识、搜索与工具调用",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [{ id: "qianfan", label: "Qianfan", region: "CN", url: "https://qianfan.baidubce.com/v2" }],
    defaultBaseUrl: "https://qianfan.baidubce.com/v2",
    allowBaseUrlEdit: false,
    suggestedModels: ["ernie-5.1", "ernie-5.0-thinking-preview", "ernie-4.5-turbo-128k"],
    defaultModel: "ernie-5.1",
    apiKeyPlaceholder: "bce-v3/…",
    consoleUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
    documentationUrl: "https://cloud.baidu.com/doc/qianfan-docs/s/qm8qxemze",
    connectionNote: "使用百度智能云千帆 V2 OpenAI 兼容接口。"
  },
  {
    id: "hunyuan",
    name: "Tencent Cloud",
    modelFamily: "Hunyuan",
    description: "推理、代码、角色与多模态",
    protocol: "openai_chat_completions",
    source: "official",
    baseUrls: [
      { id: "tokenhub", label: "TokenHub", region: "Global", url: "https://tokenhub.tencentmaas.com/v1" },
      { id: "legacy", label: "Legacy Hunyuan", region: "CN", url: "https://api.hunyuan.cloud.tencent.com/v1" }
    ],
    defaultBaseUrl: "https://tokenhub.tencentmaas.com/v1",
    allowBaseUrlEdit: false,
    suggestedModels: ["hy3", "hy-mt2-pro", "hunyuan-role-latest"],
    defaultModel: "hy3",
    apiKeyPlaceholder: "sk-…",
    consoleUrl: "https://console.cloud.tencent.com/hunyuan/api-key",
    documentationUrl: "https://cloud.tencent.com/document/product/1729/111007",
    connectionNote: "新账号优先使用 TokenHub；旧连接可继续选择混元兼容接口。"
  },
  {
    id: "ollama",
    name: "Ollama",
    modelFamily: "Ollama",
    description: "连接本机已安装的模型服务",
    protocol: "openai_chat_completions",
    source: "custom",
    baseUrls: [],
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    allowBaseUrlEdit: true,
    suggestedModels: [],
    defaultModel: "",
    apiKeyPlaceholder: "",
    documentationUrl: "https://docs.ollama.com/api/chat",
    connectionNote: "仅连接本机回环地址，无需 API Key；使用原生接口自动设置上下文并检测模型能力，不经过平台或系统代理。"
  },
  {
    id: "custom_openai",
    name: "兼容 API",
    modelFamily: "自定义",
    description: "连接其他 OpenAI Chat Completions 兼容服务",
    protocol: "openai_chat_completions",
    source: "custom",
    baseUrls: [],
    defaultBaseUrl: "",
    allowBaseUrlEdit: true,
    suggestedModels: [],
    defaultModel: "",
    apiKeyPlaceholder: "API Key",
    connectionNote: "仅允许 HTTPS；这是用户自选直连，不代表 NextMux 为该服务背书。"
  },
  {
    id: "custom_media",
    name: "自定义生成接口",
    modelFamily: "视频 · 图片",
    description: "提交任务再查询结果的视频或图片接口：速创、百炼、方舟、硅基流动、fal.ai、Replicate 与各类中转",
    protocol: "async_media_template",
    source: "custom",
    baseUrls: [],
    defaultBaseUrl: "",
    allowBaseUrlEdit: true,
    suggestedModels: [],
    defaultModel: "",
    apiKeyPlaceholder: "API Key",
    modelDiscovery: "unsupported",
    connectionNote: "在“高级”里选接口格式，字段可按服务商文档修改；只接受图片链接的接口，参考图会由 NextMux 临时托管 6 小时。"
  }
] as const;

export function officialProviderPreset(id: string): OfficialProviderPreset | undefined {
  return OFFICIAL_PROVIDER_PRESETS.find(provider => provider.id === id);
}
