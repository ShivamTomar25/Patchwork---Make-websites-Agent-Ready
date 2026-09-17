import { AgentDecisionSchema } from "../core/schemas.js";
import type { AgentDecision, ModelProvider, ModelRequest, ModelResponse } from "../core/types.js";
import { compactText, nowIso } from "../core/utils.js";

export type ProviderConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  retries: number;
  maxOutputTokens: number;
  promptVersion: string;
};

export class OpenAICompatibleTextProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly promptVersion: string;

  constructor(private readonly config: ProviderConfig) {
    this.id = config.id;
    this.model = config.model;
    this.promptVersion = config.promptVersion;
  }

  async completeJson(request: ModelRequest): Promise<ModelResponse> {
    return openAiCompatibleComplete(this.config, request);
  }
}

export class OpenAICompatibleVisionProvider extends OpenAICompatibleTextProvider {}

export class DeterministicMockTextProvider implements ModelProvider {
  readonly id = "deterministic-mock-text";
  readonly model = "mock-text-v1";
  readonly promptVersion = "mock-text-2026-08-03";

  async completeJson(request: ModelRequest): Promise<ModelResponse> {
    const content = JSON.stringify(makeMockDecision(request));
    return {
      text: content,
      provider: this.id,
      model: this.model,
      usage: tokenEstimate(request, content),
      latencyMs: 1
    };
  }
}

export class DeterministicMockVisionProvider implements ModelProvider {
  readonly id = "deterministic-mock-vision";
  readonly model = "mock-vision-v1";
  readonly promptVersion = "mock-vision-2026-08-03";

  async completeJson(request: ModelRequest): Promise<ModelResponse> {
    const content = JSON.stringify(makeMockDecision(request));
    return {
      text: content,
      provider: this.id,
      model: this.model,
      usage: tokenEstimate(request, content),
      latencyMs: 1
    };
  }
}

export async function parseDecisionWithRetry(
  provider: ModelProvider,
  request: ModelRequest
): Promise<{ decision: AgentDecision; response: ModelResponse; validationErrors: string[] }> {
  const first = await provider.completeJson(request);
  const parsed = safeParseDecision(first.text);
  if (parsed.decision) return { decision: parsed.decision, response: first, validationErrors: [] };

  const retry = await provider.completeJson({
    ...request,
    messages: [
      ...request.messages,
      {
        role: "user",
        content: `Your last response was invalid JSON for ${request.schemaName}. Return only valid JSON matching the action schema.`
      }
    ]
  });
  const retryParsed = safeParseDecision(retry.text);
  if (!retryParsed.decision) {
    return {
      decision: {
        action: {
          type: "abort",
          code: "MODEL_OUTPUT_INVALID",
          message: "Model response failed strict JSON validation twice"
        },
        reason: "Model output did not validate.",
        usage: retry.usage
      },
      response: retry,
      validationErrors: [parsed.error || "invalid", retryParsed.error || "invalid"]
    };
  }
  return { decision: retryParsed.decision, response: retry, validationErrors: [parsed.error || "invalid"] };
}

export function providerFromEnv(agentId: string, mode: "mock" | "live"): ModelProvider {
  if (mode === "mock") {
    return agentId === "screenshot" ? new DeterministicMockVisionProvider() : new DeterministicMockTextProvider();
  }
  const prefix =
    agentId === "accessibility-a"
      ? "TEXT_AGENT_A"
      : agentId === "accessibility-b"
        ? "TEXT_AGENT_B"
        : agentId === "screenshot"
          ? "VISION"
          : "TOOL_AGENT";
  const baseUrl = requiredEnv(`${prefix}_BASE_URL`);
  const apiKey = requiredEnv(`${prefix}_API_KEY`);
  const model = requiredEnv(`${prefix}_MODEL`);
  const temperature = Number(process.env[`${prefix}_TEMPERATURE`] || "0");
  const config: ProviderConfig = {
    id: `${prefix.toLowerCase()}-openai-compatible`,
    baseUrl,
    apiKey,
    model,
    temperature,
    timeoutMs: Number(process.env[`${prefix}_TIMEOUT_MS`] || "30000"),
    retries: Number(process.env[`${prefix}_RETRIES`] || "1"),
    maxOutputTokens: Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || "512"),
    promptVersion: `${prefix.toLowerCase()}-2026-08-03`
  };
  return agentId === "screenshot" ? new OpenAICompatibleVisionProvider(config) : new OpenAICompatibleTextProvider(config);
}

async function openAiCompatibleComplete(config: ProviderConfig, request: ModelRequest): Promise<ModelResponse> {
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs || config.timeoutMs);
    try {
      const response = await fetch(new URL("/chat/completions", config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          messages: request.messages,
          temperature: request.temperature ?? config.temperature,
          max_tokens: request.maxOutputTokens || config.maxOutputTokens,
          response_format: { type: "json_object" }
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Provider HTTP ${response.status}`);
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("Provider response did not contain message content");
      return {
        text,
        provider: config.id,
        model: config.model,
        usage: {
          inputTokens: Number(data.usage?.prompt_tokens || 0),
          outputTokens: Number(data.usage?.completion_tokens || 0)
        },
        latencyMs: Date.now() - started
      };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`MODEL_PROVIDER_FAILED: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function safeParseDecision(text: string): { decision?: AgentDecision; error?: string } {
  try {
    return { decision: AgentDecisionSchema.parse(JSON.parse(text)) };
  } catch (error) {
    return { error: compactText(error instanceof Error ? error.message : String(error), 500) };
  }
}

function makeMockDecision(request: ModelRequest): AgentDecision {
  const prompt = request.messages.map((message) => JSON.stringify(message.content)).join("\n");
  if (prompt.includes("OpenAPI") || prompt.includes("availableTools")) {
    return { action: { type: "finish" }, reason: "Mock tool agent delegates deterministic tool plan.", usage: { inputTokens: 0, outputTokens: 0 } };
  }
  if (prompt.includes("Screenshot")) {
    return { action: { type: "finish" }, reason: "Mock vision provider completed deterministic screenshot smoke.", usage: { inputTokens: 0, outputTokens: 0 } };
  }
  return { action: { type: "finish" }, reason: `Mock provider completed deterministic step at ${nowIso()}.`, usage: { inputTokens: 0, outputTokens: 0 } };
}

function tokenEstimate(request: ModelRequest, output: string) {
  const input = JSON.stringify(request.messages);
  return { inputTokens: Math.ceil(input.length / 4), outputTokens: Math.ceil(output.length / 4) };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`MODEL_ENV_MISSING: ${name}`);
  return value;
}
