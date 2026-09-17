import { FinalStudyManifestSchema } from "./schemas.js";

export function validateFinalStudyManifest(input: unknown): { ok: boolean; warnings: string[] } {
  const manifest = FinalStudyManifestSchema.parse(input);
  const a = manifest.agents.accessibilityA;
  const b = manifest.agents.accessibilityB;
  const same = a.provider === b.provider && a.model === b.model;
  if (same && manifest.mode === "final") {
    throw new Error("FINAL_STUDY_MODEL_DUPLICATE: Agent A and Agent B must use different provider/model pairs");
  }
  return {
    ok: true,
    warnings: same ? ["Pilot mode permits duplicate Agent A/B provider/model with visible warning."] : []
  };
}
