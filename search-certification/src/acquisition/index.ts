import type { PatchConfiguration } from "../types.js";
import type { Prediction } from "../surrogate/model.js";

export type AcquisitionRecord = {
  configuration: PatchConfiguration;
  incumbent: PatchConfiguration;
  challenger: PatchConfiguration;
  prediction: Prediction;
  expectedVarianceReduction: number;
  estimatedCost: number;
  score: number;
  reason: string;
};

export function scoreAcquisition(
  configuration: PatchConfiguration,
  prediction: Prediction,
  incumbent: PatchConfiguration,
  challenger: PatchConfiguration,
  iteration: number
): AcquisitionRecord {
  const estimatedCost = 1 + configuration.engineeringMinutes / 60 + configuration.filesChanged * 0.1;
  const decisionReduction = prediction.uncertainty * (configuration.configurationId === incumbent.configurationId || configuration.configurationId === challenger.configurationId ? 1.4 : 1);
  const globalInformation = Math.exp(-iteration / 5) * prediction.uncertainty * 0.25;
  const expectedVarianceReduction = decisionReduction + globalInformation;
  return {
    configuration,
    incumbent,
    challenger,
    prediction,
    expectedVarianceReduction,
    estimatedCost,
    score: expectedVarianceReduction / estimatedCost,
    reason: iteration < 5 ? "cold-start global information plus decision uncertainty" : "incumbent/challenger uncertainty reduction per runtime cost"
  };
}
