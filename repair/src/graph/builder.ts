import { apiOperationNodeId, rootCauseNodeId, templateForDefect, verifierPredicateNodeId } from "../catalog.js";
import { graphResultDir, loadContracts, loadMatrix, loadPilotManifest, repoPath, slug, writeJson, writeYamlFile } from "../io.js";
import type { AffordanceGraph, GraphEdge, GraphNode } from "../schemas.js";

type AddNodeInput = Omit<GraphNode, "metadata"> & { metadata?: Record<string, unknown> };
type AddEdgeInput = Omit<GraphEdge, "metadata"> & { metadata?: Record<string, unknown> };

export async function buildGraphs(repoRoot: string) {
  const [manifest, matrix, contractsByReplica] = await Promise.all([
    loadPilotManifest(repoRoot),
    loadMatrix(repoRoot),
    loadContracts(repoRoot)
  ]);
  const output: AffordanceGraph[] = [];
  for (const replica of Object.keys(contractsByReplica).sort()) {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const addNode = (node: AddNodeInput) => {
      if (!nodes.has(node.id)) nodes.set(node.id, { ...node, metadata: node.metadata ?? {} });
    };
    const addEdge = (edge: AddEdgeInput) => {
      if (!edges.has(edge.id)) edges.set(edge.id, { ...edge, metadata: edge.metadata ?? {} });
    };
    const contracts = contractsByReplica[replica] ?? [];
    const entries = matrix.entries.filter((entry) => entry.replica === replica);
    for (const contract of contracts) {
      const selectedEntry = entries.find((entry) => entry.journeyId === contract.journeyId);
      const terminalIndex = contract.states.length + contract.expectedTransitions.length;
      for (const [index, state] of contract.states.entries()) {
        const pageId = `${replica}:page:${contract.journeyId}:${state.id}`;
        addNode({
          id: pageId,
          type: "PAGE",
          label: `${contract.journeyId} ${state.id}`,
          replica,
          journeyId: contract.journeyId,
          route: state.route,
          temporalIndex: index,
          metadata: { description: state.description }
        });
        addNode({
          id: `${replica}:frontend:${contract.journeyId}:${state.id}`,
          type: "FRONTEND_STATE",
          label: state.description,
          replica,
          journeyId: contract.journeyId,
          route: state.route,
          temporalIndex: index,
          metadata: { stateId: state.id }
        });
      }
      for (const [index, transition] of contract.expectedTransitions.entries()) {
        const controlId = `${replica}:control:${contract.journeyId}:${transition.id}`;
        addNode({
          id: controlId,
          type: "CONTROL",
          label: transition.action,
          replica,
          journeyId: contract.journeyId,
          temporalIndex: contract.states.length + index,
          metadata: { transitionId: transition.id }
        });
        const from = `${replica}:page:${contract.journeyId}:${transition.from}`;
        const to = `${replica}:page:${contract.journeyId}:${transition.to}`;
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${transition.id}:invoke`,
          type: "INVOKES",
          source: from,
          target: controlId,
          replica,
          journeyId: contract.journeyId,
          label: transition.action
        });
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${transition.id}:nav`,
          type: "NAVIGATES_TO",
          source: controlId,
          target: to,
          replica,
          journeyId: contract.journeyId
        });
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${transition.id}:precedes`,
          type: "PRECEDES",
          source: from,
          target: to,
          replica,
          journeyId: contract.journeyId
        });
        if (/confirm/i.test(transition.action)) {
          const confirmationId = `${replica}:confirmation:${contract.journeyId}:${transition.id}`;
          addNode({
            id: confirmationId,
            type: "CONFIRMATION",
            label: transition.action,
            replica,
            journeyId: contract.journeyId,
            temporalIndex: contract.states.length + index,
            metadata: { transitionId: transition.id }
          });
          addEdge({
            id: `${replica}:edge:${contract.journeyId}:${transition.id}:requires-confirmation`,
            type: "REQUIRES",
            source: controlId,
            target: confirmationId,
            replica,
            journeyId: contract.journeyId
          });
        }
      }
      const apiId = selectedEntry ? apiOperationNodeId(selectedEntry) : `${replica}:api:${contract.journeyId}`;
      addNode({
        id: apiId,
        type: "API_OPERATION",
        label: selectedEntry?.affectedRouteApiComponent ?? contract.authoritativeVerifierEndpoint,
        replica,
        journeyId: contract.journeyId,
        temporalIndex: terminalIndex,
        source: contract.authoritativeVerifierEndpoint,
        metadata: { verifierEndpoint: contract.authoritativeVerifierEndpoint }
      });
      addNode({
        id: `${replica}:auth:${contract.journeyId}:${contract.testAccountReference}`,
        type: "AUTH_SCOPE",
        label: `${contract.testAccountReference} authorization`,
        replica,
        journeyId: contract.journeyId,
        temporalIndex: 1,
        metadata: { testAccountReference: contract.testAccountReference }
      });
      addEdge({
        id: `${replica}:edge:${contract.journeyId}:auth-api`,
        type: "AUTHORIZES",
        source: `${replica}:auth:${contract.journeyId}:${contract.testAccountReference}`,
        target: apiId,
        replica,
        journeyId: contract.journeyId
      });
      for (const [index, predicate] of [...contract.successPredicates, ...contract.safetyInvariants].entries()) {
        const dbId = `${replica}:db:${contract.journeyId}:${predicate.id}`;
        const predicateId = verifierPredicateNodeId(replica, contract.journeyId, predicate.description);
        addNode({
          id: dbId,
          type: predicate.source === "API-response" ? "ERROR_CONTRACT" : "DATABASE_STATE",
          label: predicate.description,
          replica,
          journeyId: contract.journeyId,
          temporalIndex: terminalIndex + index,
          metadata: predicate as unknown as Record<string, unknown>
        });
        addNode({
          id: predicateId,
          type: "VERIFIER_PREDICATE",
          label: predicate.description,
          replica,
          journeyId: contract.journeyId,
          temporalIndex: terminalIndex + index,
          metadata: { predicateId: predicate.id, source: predicate.source }
        });
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${predicate.id}:api-writes`,
          type: predicate.source === "database" || predicate.source === "backend-state" ? "WRITES" : "READS",
          source: apiId,
          target: dbId,
          replica,
          journeyId: contract.journeyId
        });
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${predicate.id}:verifies`,
          type: "VERIFIES",
          source: dbId,
          target: predicateId,
          replica,
          journeyId: contract.journeyId
        });
      }
      if (selectedEntry) {
        const template = templateForDefect(selectedEntry.defectId);
        const rootId = rootCauseNodeId(selectedEntry);
        const matrixPredicateId = verifierPredicateNodeId(replica, contract.journeyId, selectedEntry.expectedFirstFailedPredicate);
        addNode({
          id: rootId,
          type: template.targetNodeType,
          label: `${selectedEntry.defectId} root cause`,
          replica,
          journeyId: contract.journeyId,
          defectId: selectedEntry.defectId,
          temporalIndex: terminalIndex,
          source: selectedEntry.affectedRouteApiComponent,
          metadata: { operator: template.operator, defectFamily: selectedEntry.defectFamily }
        });
        addNode({
          id: matrixPredicateId,
          type: "VERIFIER_PREDICATE",
          label: selectedEntry.expectedFirstFailedPredicate,
          replica,
          journeyId: contract.journeyId,
          temporalIndex: terminalIndex + 100,
          metadata: { matrix: true, expectedViolationType: selectedEntry.expectedViolationType }
        });
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${selectedEntry.defectId}:root-api`,
          type: "DEPENDS_ON",
          source: rootId,
          target: apiId,
          replica,
          journeyId: contract.journeyId
        });
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${selectedEntry.defectId}:contradicts`,
          type: "CONTRADICTS",
          source: rootId,
          target: matrixPredicateId,
          replica,
          journeyId: contract.journeyId,
          metadata: { expectedAuthoritativeState: selectedEntry.expectedAuthoritativeState }
        });
        addEdge({
          id: `${replica}:edge:${contract.journeyId}:${selectedEntry.defectId}:api-predicate`,
          type: "VERIFIES",
          source: apiId,
          target: matrixPredicateId,
          replica,
          journeyId: contract.journeyId
        });
      }
    }
    const graph: AffordanceGraph = {
      graphId: `${replica}-repair-graph-v1`,
      replica,
      contractVersion: manifest.replicas[replica]?.contractVersion ?? "pilot-v1",
      generatedAt: new Date().toISOString(),
      nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id))
    };
    output.push(graph);
    await writeJson(`${graphResultDir(repoRoot)}/${replica}.graph.json`, graph);
  }
  await writeJson(`${graphResultDir(repoRoot)}/index.json`, {
    graphs: output.map((graph) => ({ graphId: graph.graphId, replica: graph.replica, nodes: graph.nodes.length, edges: graph.edges.length }))
  });
  await writeYamlFile(repoPath(repoRoot, "experiments/results/repair-pilot-v1/manifest.snapshot.yaml"), await repairManifestSnapshot(repoRoot));
  return output;
}

export async function repairManifestSnapshot(repoRoot: string) {
  const manifest = await loadPilotManifest(repoRoot);
  return {
    manifestVersion: "repair-pilot-v1",
    sourcePilotManifest: manifest.manifestVersion,
    studyType: "repair-pilot",
    generatedAt: new Date().toISOString(),
    replicas: Object.fromEntries(
      Object.entries(manifest.replicas).map(([replica, value]: [string, any]) => [
        replica,
        {
          contractVersion: value.contractVersion,
          journeys: value.journeys.map((journey: any) => ({
            id: journey.id,
            deterministicDefectId: journey.deterministicDefectId,
            seeds: manifest.seeds,
            repairMode: "template"
          }))
        }
      ])
    ),
    concurrency: 1,
    resultDirectory: "experiments/results/repair-pilot-v1",
    sourceCommit: manifest.siteCommit
  };
}

export function graphFileForReplica(repoRoot: string, replica: string) {
  return `${graphResultDir(repoRoot)}/${slug(replica)}.graph.json`;
}
