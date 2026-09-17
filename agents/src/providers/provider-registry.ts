import type { ModelProvider } from "../core/types.js";
import { providerFromEnv } from "./model-provider.js";

export class ModelProviderRegistry {
  get(agentId: string, mode: "mock" | "live"): ModelProvider {
    return providerFromEnv(agentId, mode);
  }
}
