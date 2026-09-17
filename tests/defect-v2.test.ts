import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

const repoRoot = process.cwd();

describe("pilot v2 defect mapping", () => {
  it("maps all 11 selected defects to verifier expectations", () => {
    const manifest = YAML.parse(readFileSync(`${repoRoot}/experiments/configs/pilot-study-v2.yaml`, "utf8"));
    const matrix = YAML.parse(readFileSync(`${repoRoot}/experiments/configs/defect-verifier-matrix.yaml`, "utf8"));
    const journeys = Object.entries(manifest.replicas).flatMap(([replica, value]: any) =>
      value.journeys.map((journey: any) => ({ replica, ...journey }))
    );
    expect(journeys).toHaveLength(11);
    expect(matrix.entries).toHaveLength(11);
    for (const journey of journeys) {
      const entry = matrix.entries.find((item: any) => item.replica === journey.replica && item.journeyId === journey.id);
      expect(entry, journey.id).toBeTruthy();
      expect(entry.defectId).toBe(journey.deterministicDefectId);
      expect(entry.expectedFirstFailedPredicate).toBeTruthy();
      expect(entry.verifierEndpoint).toBe(`/api/research/verify/${journey.id}`);
      expect(journey.defectSurface).toBeTruthy();
    }
  });

  it("keeps v2 mock and live result directories separate from v1", () => {
    const manifest = YAML.parse(readFileSync(`${repoRoot}/experiments/configs/pilot-study-v2.yaml`, "utf8"));
    expect(manifest.resultDirectories.mock).toBe("experiments/results/pilot-study-v2/mock");
    expect(manifest.resultDirectories.liveSmoke).toBe("experiments/results/pilot-study-v2/live-smoke");
    expect(manifest.resultDirectories.live).toBe("experiments/results/pilot-study-v2/live");
    expect(Object.values(manifest.resultDirectories)).not.toContain("experiments/results/pilot-study-v1");
  });
});

describe("live provider validation", () => {
  it("enforces budget, model-family and vision constraints", async () => {
    const live = await import(pathToFileURL(`${repoRoot}/scripts/research-live-smoke.mjs`).href);
    const validEnv = {
      TEXT_AGENT_A_BASE_URL: "http://localhost/a",
      TEXT_AGENT_A_API_KEY: "redacted",
      TEXT_AGENT_A_MODEL: "alpha-1",
      TEXT_AGENT_B_BASE_URL: "http://localhost/b",
      TEXT_AGENT_B_API_KEY: "redacted",
      TEXT_AGENT_B_MODEL: "beta-1",
      VISION_BASE_URL: "http://localhost/v",
      VISION_API_KEY: "redacted",
      VISION_MODEL: "vision-model-1",
      TOOL_AGENT_BASE_URL: "http://localhost/t",
      TOOL_AGENT_API_KEY: "redacted",
      TOOL_AGENT_MODEL: "tool-model-1",
      LIVE_ALLOW_COST: "true",
      LIVE_MAX_RUNS: "24",
      LIVE_MAX_STEPS_PER_RUN: "30",
      LIVE_MAX_TOKENS_PER_RUN: "20000"
    };
    expect(live.validateLiveEnvironment(validEnv).ok).toBe(true);
    expect(live.validateLiveEnvironment({ ...validEnv, TEXT_AGENT_B_MODEL: "alpha-2" }).ok).toBe(false);
    expect(live.validateLiveEnvironment({ ...validEnv, VISION_MODEL: "text-only-model" }).ok).toBe(false);
    expect(live.validateLiveEnvironment({ ...validEnv, LIVE_MAX_RUNS: "25" }).ok).toBe(false);
    expect(live.validateLiveEnvironment({ ...validEnv, LIVE_ALLOW_COST: "false" }).ok).toBe(false);
  });
});
