import type { PatchConfiguration, PatchMetadata, Replica } from "../types.js";

export type FeatureContext = {
  replica: Replica;
  patches: PatchMetadata[];
  graph: any;
};

export function graphAwareFeatures(config: PatchConfiguration, context: FeatureContext): number[] {
  const patchIndicators = config.patchVector;
  const selected = context.patches.filter((patch) => config.patchIds.includes(patch.patchId));
  const adjacentPairs = pairwise(context.patches).map(([left, right]) => Number(config.patchIds.includes(left.patchId) && config.patchIds.includes(right.patchId) && graphAdjacent(left, right, context.graph)));
  const sharedApiPairs = pairwise(context.patches).map(([left, right]) => Number(config.patchIds.includes(left.patchId) && config.patchIds.includes(right.patchId) && sharedApiOrState(left, right, context.graph)));
  const cost = Math.min(1, config.engineeringMinutes / 240);
  const overlap = modifiedComponentOverlap(selected);
  return [...patchIndicators, ...adjacentPairs, ...sharedApiPairs, cost, overlap];
}

export function graphAdjacent(left: PatchMetadata, right: PatchMetadata, graph: any) {
  const edges = graph?.edges || [];
  const targets = new Set([left.targetNodeId, ...nodeIdsForPatch(left, graph)]);
  const rights = new Set([right.targetNodeId, ...nodeIdsForPatch(right, graph)]);
  return edges.some((edge: any) => (targets.has(edge.source) && rights.has(edge.target)) || (targets.has(edge.target) && rights.has(edge.source)));
}

function sharedApiOrState(left: PatchMetadata, right: PatchMetadata, graph: any) {
  const leftNodes = nodeIdsForPatch(left, graph);
  const rightNodes = nodeIdsForPatch(right, graph);
  const nodeById = new Map((graph?.nodes || []).map((node: any) => [node.id, node]));
  const leftComponents = new Set(leftNodes.map((id: string) => componentKey(nodeById.get(id))).filter(Boolean));
  return rightNodes.some((id: string) => leftComponents.has(componentKey(nodeById.get(id))));
}

function nodeIdsForPatch(patch: PatchMetadata, graph: any) {
  return (graph?.nodes || []).filter((node: any) => node.defectId && patch.targetNodeId.includes(node.defectId)).map((node: any) => node.id);
}

function componentKey(node: any) {
  if (!node) return "";
  if (node.type === "API_OPERATION" || node.type === "DATABASE_STATE" || node.type === "AUTH_SCOPE" || node.type === "FRONTEND_STATE") {
    return `${node.type}:${node.source || node.route || node.journeyId || node.label}`;
  }
  return "";
}

function modifiedComponentOverlap(selected: PatchMetadata[]) {
  const counts = new Map<string, number>();
  for (const patch of selected) {
    for (const file of patch.sourceFiles) counts.set(file, (counts.get(file) || 0) + 1);
  }
  return Math.min(1, [...counts.values()].filter((count) => count > 1).length / Math.max(1, counts.size));
}

function pairwise<T>(items: T[]) {
  const pairs: Array<[T, T]> = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) pairs.push([items[left]!, items[right]!]);
  }
  return pairs;
}
