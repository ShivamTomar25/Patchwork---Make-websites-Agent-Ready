export class BudgetManager {
  private readonly startedAt = Date.now();
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(
    private readonly maxSteps: number,
    private readonly timeoutMs: number,
    private readonly tokenBudget: number
  ) {}

  recordUsage(inputTokens: number, outputTokens: number) {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
  }

  assertCanContinue(stepCount: number) {
    if (stepCount >= this.maxSteps) throw new Error("max_steps");
    if (Date.now() - this.startedAt > this.timeoutMs) throw new Error("timeout");
    if (this.inputTokens + this.outputTokens >= this.tokenBudget) throw new Error("model_token_budget");
  }

  remainingSteps(stepCount: number): number {
    return Math.max(0, this.maxSteps - stepCount);
  }

  remainingMs(): number {
    return Math.max(0, this.timeoutMs - (Date.now() - this.startedAt));
  }

  usage() {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}
