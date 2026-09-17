import { readFile } from "node:fs/promises";
import { EdgeTypeSchema, AffordanceGraphSchema, type AffordanceGraph } from "../schemas.js";
import { graphResultDir, loadMatrix } from "../io.js";
import { verifierPredicateNodeId } from "../catalog.js";

export type GraphValidationResult = {
  ok: boolean;
  graphCount: number;
  issues: Array<{ graphId: string; issue: string }>;
};

export async function loadGraph(repoRoot: string, replica: string): Promise<AffordanceGraph> {
  return AffordanceGraphSchema.parse(JSON.parse(await readFile(`${graphResultDir(repoRoot)}/${replica}.graph.json`, "utf8")));
}

export async function validateGraphs(repoRoot: string): Promise<GraphValidationResult> {
  const matrix = await loadMatrix(repoRoot);
  const issues: Array<{ graphId: string; issue: string }> = [];
  const replicas = [...new Set(matrix.entries.map((entry) => entry.replica))].sort();
  for (const replica of replicas) {
    let graph: AffordanceGraph;
    try {
      graph = await loadGraph(repoRoot, replica);
    } catch (error) {
      issues.push({ graphId: replica, issue: `graph parse failed: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) issues.push({ graphId: graph.graphId, issue: `duplicate node id ${node.id}` });
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edgeIds.has(edge.id)) issues.push({ graphId: graph.graphId, issue: `duplicate edge id ${edge.id}` });
      edgeIds.add(edge.id);
      if (!EdgeTypeSchema.safeParse(edge.type).success) issues.push({ graphId: graph.graphId, issue: `invalid edge type ${edge.type}` });
      if (!nodeIds.has(edge.source)) issues.push({ graphId: graph.graphId, issue: `missing edge source ${edge.source}` });
      if (!nodeIds.has(edge.target)) issues.push({ graphId: graph.graphId, issue: `missing edge target ${edge.target}` });
    }
    for (const entry of matrix.entries.filter((item) => item.replica === replica)) {
      const predicateId = verifierPredicateNodeId(entry.replica, entry.journeyId, entry.expectedFirstFailedPredicate);
      if (!nodeIds.has(predicateId)) {
        issues.push({
          graphId: graph.graphId,
          issue: `matrix predicate absent from graph ${entry.journeyId} ${entry.expectedFirstFailedPredicate}`
        });
      }
    }
  }
  return { ok: issues.length === 0, graphCount: replicas.length, issues };
}
