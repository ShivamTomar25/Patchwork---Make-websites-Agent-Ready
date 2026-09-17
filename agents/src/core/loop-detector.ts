import { sha256, stableJson } from "./utils.js";

export class LoopDetector {
  private readonly seen = new Map<string, number>();

  constructor(private readonly threshold = 3) {}

  check(input: { url: string; observationHash: string; action: unknown; verifierState?: unknown }): boolean {
    const key = sha256(stableJson(input));
    const count = (this.seen.get(key) || 0) + 1;
    this.seen.set(key, count);
    return count >= this.threshold;
  }
}
