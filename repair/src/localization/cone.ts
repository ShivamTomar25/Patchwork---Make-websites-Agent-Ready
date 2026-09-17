import { rootCauseNodeId, verifierPredicateNodeId } from "../catalog.js";
import { loadMatrix, readJsonl, repairResultDir, writeCsv, writeJsonl } from "../io.js";
import { loadGraph } from "../graph/validator.js";
import { FailureConeSchema, type AffordanceGraph, type FailureCone, type LocalizationResult } from "../schemas.js";

export async function buildFailureCones(repoRoot: string, localizations?: LocalizationResult[]) {
  const rows = localizations ?? (await readJsonl<LocalizationResult>(`${repairResultDir(repoRoot)}/localization.jsonl`));
  const matrix = await loadMatrix(repoRoot);
  const graphs = new Map<string, AffordanceGraph>();
  const cones: FailureCone[] = [];
  for (const row of rows) {
    const graph = graphs.get(row.replica) ?? (await loadGraph(repoRoot, row.replica));
    graphs.set(row.replica, graph);
    const entry = matrix.entries.find((item) => item.replica === row.replica && item.journeyId === row.journeyId && item.defectId === row.defectId);
    if (!entry) continue;
    const predicateId = verifierPredicateNodeId(row.replica, row.journeyId, row.firstViolatedPredicate);
    const rootId = rootCauseNodeId(entry);
    const temporalLimit = graph.nodes.find((node) => node.id === predicateId)?.temporalIndex ?? Number.MAX_SAFE_INTEGER;
    const validNodes = new Set(
      graph.nodes
        .filter((node) => node.journeyId === row.journeyId || node.defectId === row.defectId)
        .filter((node) => (node.temporalIndex ?? 0) <= temporalLimit)
        .map((node) => node.id)
    );
    const backward = walk(graph, [predicateId], "backward", validNodes);
    const forward = walk(graph, [rootId], "forward", validNodes);
    const ranked = rankTargets(rootId, backward, forward);
    const coneSet = new Set([...backward, ...forward, ...ranked]);
    const cone = FailureConeSchema.parse({
      journeyId: row.journeyId,
      runId: row.runId,
      replica: row.replica,
      defectId: row.defectId,
      firstViolatedPredicate: row.firstViolatedPredicate,
      backwardNodes: backward,
      forwardNodes: forward,
      candidateRepairTargets: ranked,
      fullGraphNodeCount: graph.nodes.length,
      coneNodeCount: coneSet.size,
      rootCauseNodeId: rootId,
      exactRootCause: ranked[0] === rootId,
      top3RootCause: ranked.slice(0, 3).includes(rootId),
      rootCauseContained: coneSet.has(rootId),
      conePercent: graph.nodes.length ? Math.round((coneSet.size / graph.nodes.length) * 10000) / 100 : 0
    });
    cones.push(cone);
  }
  const resultDir = repairResultDir(repoRoot);
  await writeJsonl(`${resultDir}/failure-cones.jsonl`, cones);
  await writeCsv(
    `${resultDir}/cone-summary.csv`,
    cones.map((cone) => ({
      replica: cone.replica,
      journey_id: cone.journeyId,
      seed: cone.runId.match(/seed(\d+)/)?.[1] || "",
      defect_id: cone.defectId,
      first_violated_predicate: cone.firstViolatedPredicate,
      root_cause_node_id: cone.rootCauseNodeId,
      exact_root_cause: cone.exactRootCause,
      top3_root_cause: cone.top3RootCause,
      root_cause_contained: cone.rootCauseContained,
      full_graph_node_count: cone.fullGraphNodeCount,
      cone_node_count: cone.coneNodeCount,
      cone_percent: cone.conePercent
    }))
  );
  return cones;
}

function walk(graph: AffordanceGraph, startIds: string[], direction: "forward" | "backward", validNodes: Set<string>) {
  const visited = new Set<string>();
  const queue = startIds.filter((id) => validNodes.has(id));
  const maxDepth = 8;
  const depth = new Map(queue.map((id) => [id, 0]));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const currentDepth = depth.get(current) ?? 0;
    if (currentDepth >= maxDepth) continue;
    const edges = graph.edges.filter((edge) => (direction === "forward" ? edge.source === current : edge.target === current));
    for (const edge of edges) {
      const next = direction === "forward" ? edge.target : edge.source;
      if (validNodes.has(next) && !visited.has(next)) {
        depth.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }
  return [...visited].sort();
}

function rankTargets(rootId: string, backward: string[], forward: string[]) {
  const candidates = [rootId, ...backward.filter((node) => /root-cause|auth|confirmation|api|error|side-effect/.test(node)), ...forward];
  return [...new Set(candidates)].slice(0, 5);
}
