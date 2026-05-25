import { mockReply } from "./mock-provider";
import type { Agent, AgentProvider, Message } from "./types";

export type ProviderDescriptor = {
  id: AgentProvider;
  label: string;
  kind: "mock" | "openai-compatible";
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv?: string;
  configured: boolean;
};

export type ProviderPublicConfig = {
  defaultProvider: AgentProvider;
  providers: ProviderDescriptor[];
  timeoutMs: number;
  maxTokens: number;
  mockFallback: boolean;
};

export type ProviderClientConfig = ProviderPublicConfig;

export type ProviderResult = {
  text: string;
  status: "completed" | "failed";
  provider: AgentProvider;
  model: string;
  latencyMs: number;
  usage?: Record<string, unknown>;
  finishReason?: string;
  fallback?: boolean;
  error?: string;
  originalProvider?: AgentProvider;
};

type OpenAIResponse = {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }>;
  usage?: Record<string, unknown>;
};

function envFlag(value: string | undefined, defaultValue: boolean) {
  if (!value) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function envNumber(value: string | undefined, defaultValue: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function envText(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.name === "AbortError" ? "provider_timeout" : error.message;
  return "provider_failed";
}

function mockUsage(messages: Message[], text: string) {
  return {
    inputMessages: Math.min(messages.length, 16),
    outputChars: text.length,
  };
}

function buildDescriptors(): ProviderDescriptor[] {
  const gatewayBase = envText(process.env.LLM_GATEWAY_BASE_URL, "https://api.openai.com/v1");
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY;

  return [
    {
      id: "mock",
      label: "Mock（本地模拟）",
      kind: "mock",
      baseUrl: "",
      defaultModel: "mock-v1",
      configured: true,
    },
    {
      id: "openai",
      label: "OpenAI / GPT",
      kind: "openai-compatible",
      baseUrl: envText(process.env.OPENAI_BASE_URL, gatewayBase),
      defaultModel: envText(process.env.OPENAI_MODEL, "gpt-4o-mini"),
      apiKeyEnv: process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "LLM_GATEWAY_API_KEY",
      configured: Boolean(process.env.OPENAI_API_KEY || gatewayKey),
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      kind: "openai-compatible",
      baseUrl: envText(process.env.DEEPSEEK_BASE_URL, "https://api.deepseek.com/v1"),
      defaultModel: envText(process.env.DEEPSEEK_MODEL, "deepseek-chat"),
      apiKeyEnv: "DEEPSEEK_API_KEY",
      configured: Boolean(process.env.DEEPSEEK_API_KEY),
    },
    {
      id: "gemini",
      label: "Gemini",
      kind: "openai-compatible",
      baseUrl: envText(process.env.GEMINI_BASE_URL, ""),
      defaultModel: envText(process.env.GEMINI_MODEL, "gemini-2.0-flash"),
      apiKeyEnv: "GEMINI_API_KEY",
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_BASE_URL),
    },
    {
      id: "grok",
      label: "Grok",
      kind: "openai-compatible",
      baseUrl: envText(process.env.GROK_BASE_URL, ""),
      defaultModel: envText(process.env.GROK_MODEL, "grok-2-latest"),
      apiKeyEnv: "GROK_API_KEY",
      configured: Boolean(process.env.GROK_API_KEY && process.env.GROK_BASE_URL),
    },
    {
      id: "qwen",
      label: "Qwen",
      kind: "openai-compatible",
      baseUrl: envText(process.env.QWEN_BASE_URL, ""),
      defaultModel: envText(process.env.QWEN_MODEL, "qwen-plus"),
      apiKeyEnv: "QWEN_API_KEY",
      configured: Boolean(process.env.QWEN_API_KEY && process.env.QWEN_BASE_URL),
    },
  ];
}

function descriptorFor(provider: AgentProvider): ProviderDescriptor {
  return buildDescriptors().find((entry) => entry.id === provider) ?? buildDescriptors()[0];
}

const VALID_PROVIDERS: AgentProvider[] = ["mock", "openai", "deepseek", "gemini", "grok", "qwen"];

export function normalizeProvider(value: unknown): AgentProvider {
  if (typeof value !== "string") return "mock";
  const lowered = value.trim().toLowerCase() as AgentProvider;
  return VALID_PROVIDERS.includes(lowered) ? lowered : "mock";
}

export function getProviderPublicConfig(): ProviderPublicConfig {
  return {
    defaultProvider: normalizeProvider(process.env.AI_PROVIDER),
    providers: buildDescriptors(),
    timeoutMs: envNumber(process.env.AI_PROVIDER_TIMEOUT_MS, 30000),
    maxTokens: envNumber(process.env.AI_PROVIDER_MAX_TOKENS, 600),
    mockFallback: envFlag(process.env.AI_PROVIDER_MOCK_FALLBACK, true),
  };
}

export function getProviderClientConfig(): ProviderClientConfig {
  return getProviderPublicConfig();
}

export function defaultModelForProvider(provider: AgentProvider) {
  return descriptorFor(provider).defaultModel;
}

export function providerMetadata(result: ProviderResult, base: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries({
      ...base,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      finishReason: result.finishReason,
      fallback: result.fallback,
      error: result.error,
      originalProvider: result.originalProvider,
    }).filter(([, value]) => value !== undefined),
  );
}

function buildMessages(agent: Agent, messages: Message[], round: number) {
  const recentMessages = messages.slice(-16).map((message) => ({
    role: message.senderKind === "human" ? "user" : "assistant",
    content: `${message.senderKind === "ai" ? "AI" : "用户"}: ${message.content}`,
  }));

  return [
    {
      role: "system",
      content: [
        `你是讨论室中的 ${agent.name}，角色是 ${agent.role}。`,
        `角色风格：${agent.persona}`,
        `当前目标：${agent.goal}`,
        `这是第 ${round} 轮发言。请直接给出简洁、可执行的观点，不要编造系统状态。`,
      ].join("\n"),
    },
    ...recentMessages,
  ];
}

async function callOpenAICompatible(
  descriptor: ProviderDescriptor,
  agent: Agent,
  messages: Message[],
  round: number,
): Promise<ProviderResult> {
  const config = getProviderPublicConfig();
  const apiKey = descriptor.apiKeyEnv ? process.env[descriptor.apiKeyEnv] : undefined;
  const model = agent.model && agent.model !== "mock-v1" ? agent.model : descriptor.defaultModel;
  const startedAt = Date.now();

  if (!apiKey) {
    throw new Error(`${descriptor.id}_api_key_missing`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${descriptor.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(agent, messages, round),
        temperature: agent.temperature,
        max_tokens: config.maxTokens,
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as OpenAIResponse | null;

    if (!response.ok) {
      throw new Error(`provider_http_${response.status}`);
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("provider_empty_response");
    }

    return {
      text,
      status: "completed",
      provider: descriptor.id,
      model: data?.model || model,
      latencyMs: Date.now() - startedAt,
      usage: data?.usage,
      finishReason: data?.choices?.[0]?.finish_reason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAgentReply(agent: Agent, messages: Message[], round: number): Promise<ProviderResult> {
  const startedAt = Date.now();
  const provider = normalizeProvider(agent.provider);
  const descriptor = descriptorFor(provider);

  if (descriptor.kind === "mock") {
    const text = mockReply(agent, messages, round);
    return {
      text,
      status: "completed",
      provider: "mock",
      model: "mock-v1",
      latencyMs: Date.now() - startedAt,
      usage: mockUsage(messages, text),
    };
  }

  try {
    return await callOpenAICompatible(descriptor, agent, messages, round);
  } catch (error) {
    const config = getProviderPublicConfig();
    const message = errorText(error);

    if (config.mockFallback) {
      const text = mockReply(agent, messages, round);
      return {
        text,
        status: "completed",
        provider: "mock",
        model: "mock-v1",
        latencyMs: Date.now() - startedAt,
        usage: mockUsage(messages, text),
        fallback: true,
        error: message,
        originalProvider: provider,
      };
    }

    return {
      text: `AI Provider 调用失败：${message}`,
      status: "failed",
      provider,
      model: agent.model || descriptor.defaultModel,
      latencyMs: Date.now() - startedAt,
      error: message,
    };
  }
}