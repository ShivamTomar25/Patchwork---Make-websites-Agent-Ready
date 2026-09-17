import type { ConfidenceState, Replica } from "../types.js";

export type StreamObservation = {
  replica: Replica;
  configurationId: string;
  journeyId: string;
  compliantSuccess: boolean;
  violation: boolean;
};

export function buildConfidenceHistory(observations: StreamObservation[], delta: number) {
  const streams = unique(
    observations.flatMap((observation) => [
      streamId(observation, "compliant-success"),
      streamId(observation, "violation")
    ])
  );
  const streamAlpha = delta / Math.max(1, streams.length);
  const states = new Map<string, ConfidenceState>();
  const history: ConfidenceState[] = [];
  for (const observation of observations) {
    for (const metric of ["compliant-success", "violation"] as const) {
      const id = streamId(observation, metric);
      const previous = states.get(id);
      const n = (previous?.n || 0) + 1;
      const successes = (previous?.successes || 0) + Number(metric === "compliant-success" ? observation.compliantSuccess : observation.violation);
      const alphaAtN = streamAlpha / (n * (n + 1));
      const bounds = hoeffdingBounds(successes, n, alphaAtN);
      const state: ConfidenceState = {
        streamId: id,
        replica: observation.replica,
        configurationId: observation.configurationId,
        journeyId: observation.journeyId,
        metric,
        n,
        successes,
        lower: bounds.lower,
        upper: bounds.upper,
        alphaAtN,
        streamAlpha
      };
      states.set(id, state);
      history.push(state);
    }
  }
  return { states: [...states.values()], history, streamAlpha, totalAllocatedAlpha: streamAlpha * streams.length };
}

export function hoeffdingBounds(successes: number, n: number, alpha: number) {
  if (n <= 0) return { lower: 0, upper: 1 };
  const mean = successes / n;
  const radius = Math.sqrt(Math.log(2 / Math.max(alpha, Number.MIN_VALUE)) / (2 * n));
  return { lower: clamp(mean - radius), upper: clamp(mean + radius) };
}

export function certifiedSafe(states: ConfidenceState[], configurationId: string, threshold: number) {
  return states.filter((state) => state.configurationId === configurationId && state.metric === "violation").every((state) => state.upper <= threshold);
}

export function plausiblySafe(states: ConfidenceState[], configurationId: string, threshold: number) {
  return states.filter((state) => state.configurationId === configurationId && state.metric === "violation").every((state) => state.lower <= threshold);
}

export function objectiveBounds(states: ConfidenceState[], configurationId: string, costPenalty: number, latencyPenalty: number) {
  const success = states.filter((state) => state.configurationId === configurationId && state.metric === "compliant-success");
  if (success.length === 0) return { lower: -1, upper: 1 };
  return {
    lower: Math.min(...success.map((state) => state.lower)) - costPenalty - latencyPenalty,
    upper: Math.min(...success.map((state) => state.upper)) - costPenalty - latencyPenalty
  };
}

function streamId(observation: StreamObservation, metric: "compliant-success" | "violation") {
  return `${observation.replica}:${observation.configurationId}:${observation.journeyId}:${metric}`;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}
