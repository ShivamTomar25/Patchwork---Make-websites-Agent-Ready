import { describe, expect, it } from "vitest";

const finalEval = await import("../scripts/final-paper-eval.mjs");

describe("final paper evaluation guards", () => {
  it("keeps stable JSON hashes independent of object key order", () => {
    expect(finalEval.stableJsonHash({ b: 2, a: 1 })).toBe(finalEval.stableJsonHash({ a: 1, b: 2 }));
  });

  it("preserves candidate-set identity through stable hashing", () => {
    const candidateSet = { replica: "shop", candidateSetHash: "abc", candidates: [{ configurationId: "shop-111" }] };
    expect(finalEval.stableJsonHash(candidateSet)).toBe(finalEval.stableJsonHash(JSON.parse(JSON.stringify(candidateSet))));
  });

  it("detects duplicate valid confirmation observation keys", () => {
    const valid = {
      replica: "shop",
      configurationId: "shop-111",
      seed: 1001,
      journeyId: "SHOP-J1",
      outcome: { attempted: true, startupOk: true, resetOk: true, healthOk: true }
    };
    expect(finalEval.duplicateValidObservationKeys([valid, { ...valid }])).toEqual(["shop|shop-111|1001|SHOP-J1"]);
  });

  it("does not count invalid retry observations as duplicate valid observations", () => {
    const invalid = {
      replica: "shop",
      configurationId: "shop-111",
      seed: 1001,
      journeyId: "SHOP-J1",
      outcome: { attempted: true, startupOk: true, resetOk: false, healthOk: false }
    };
    expect(finalEval.duplicateValidObservationKeys([invalid, { ...invalid }])).toEqual([]);
  });

  it("separates search and confirmation keys", () => {
    const row = { replica: "saas", configurationId: "saas-1111", seed: 1002, journeyId: "SAAS-J2" };
    expect(finalEval.confirmationObservationKey(row)).toBe("saas|saas-1111|1002|SAAS-J2");
  });

  it("reconstructs terminal confirmation state without certifying plausible candidates", () => {
    const status = finalEval.reconstructTerminalState({
      replica: "support",
      status: "NOT_CERTIFIED_SAFETY_BOUND_NOT_CLOSED",
      completedCandidateSeedRuns: 990,
      plannedCandidateSeedRuns: 990,
      certifiedSafe: [],
      plausiblySafe: ["support-1111"]
    });
    expect(status.abstained).toBe(true);
    expect(status.certifiedCandidate).toBe("none");
    expect(status.plausibleCandidate).toBe("support-1111");
    expect(status.safetyBoundNotClosed).toBe(true);
  });
});

describe("final paper metric formulas", () => {
  it("computes CSR", () => {
    expect(finalEval.csr(33, 33)).toBe(1);
    expect(finalEval.csr(0, 33)).toBe(0);
    expect(finalEval.csr(0, 0)).toBeNull();
  });

  it("computes violation rate", () => {
    expect(finalEval.violationRate(0, 33)).toBe(0);
    expect(finalEval.violationRate(33, 33)).toBe(1);
    expect(finalEval.violationRate(0, 0)).toBeNull();
  });

  it("treats a safe task failure as CSR failure without a violation", () => {
    expect(finalEval.controlledObservationOutcome({ verifiedSuccess: false, violations: [] })).toMatchObject({
      compliantSuccess: false,
      violation: false
    });
  });

  it("treats unsafe task success as CSR failure with a violation", () => {
    expect(finalEval.controlledObservationOutcome({ verifiedSuccess: true, violations: ["authorization"] })).toMatchObject({
      compliantSuccess: false,
      violation: true
    });
  });

  it("treats compliant success as CSR success without a violation", () => {
    expect(finalEval.controlledObservationOutcome({ verifiedSuccess: true, violations: [] })).toMatchObject({
      compliantSuccess: true,
      violation: false
    });
  });

  it("computes regret with a zero floor", () => {
    expect(finalEval.regret(0.98, 0.9)).toBeCloseTo(0.08);
    expect(finalEval.regret(0.98, 1.1)).toBe(0);
  });

  it("computes candidate recall", () => {
    expect(finalEval.candidateRecall(5, 5)).toBe(1);
    expect(finalEval.candidateRecall(0, 0)).toBe(0);
  });

  it("matches paired seeds with McNemar contingency counts", () => {
    expect(finalEval.mcnemarCounts([false, false, true], [true, false, true])).toEqual({
      bothPass: 1,
      aOnly: 0,
      bOnly: 1,
      bothFail: 1
    });
  });

  it("computes an exact McNemar p-value", () => {
    expect(finalEval.mcnemarExactP(0, 3)).toBeCloseTo(0.25);
  });

  it("keeps bootstrap intervals deterministic", () => {
    expect(finalEval.bootstrapMean([0, 1, 1], 123, 200)).toEqual(finalEval.bootstrapMean([0, 1, 1], 123, 200));
    expect(finalEval.bootstrapDifference([0, 0, 1], [1, 1, 1], 123, 200)).toEqual(
      finalEval.bootstrapDifference([0, 0, 1], [1, 1, 1], 123, 200)
    );
  });

  it("keeps hierarchical paired bootstrap intervals deterministic", () => {
    const rows = [
      { replica: "shop", a: 0, b: 1 },
      { replica: "shop", a: 0, b: 1 },
      { replica: "saas", a: 1, b: 1 },
      { replica: "support", a: 0, b: 0 }
    ];
    expect(finalEval.hierarchicalPairedBootstrap(rows, 123, 200)).toEqual(finalEval.hierarchicalPairedBootstrap(rows, 123, 200));
  });

  it("applies Holm correction monotonically", () => {
    const adjusted = finalEval.holmCorrection([
      { id: "a", p: 0.01 },
      { id: "b", p: 0.03 }
    ]);
    expect(adjusted.a.adjusted).toBeCloseTo(0.02);
    expect(adjusted.b.adjusted).toBeCloseTo(0.03);
  });
});

describe("final paper provenance and N/A handling", () => {
  it("preserves N/A reasons", () => {
    expect(finalEval.na("HUMAN STUDY NOT EXECUTED")).toBe("N/A - HUMAN STUDY NOT EXECUTED");
  });

  it("requires paper table cell provenance fields", () => {
    expect(
      finalEval.tableRowsHaveProvenance([
        {
          source_artifacts: '["artifact.json"]',
          source_sha256s: '["abc"]',
          analysis_script: "scripts/final-paper-eval.mjs",
          output_table_path: "table.csv",
          evidence_class: "DETERMINISTIC_CONTROLLED_RUNTIME"
        }
      ])
    ).toBe(true);
    expect(finalEval.tableRowsHaveProvenance([{ source_artifacts: '["artifact.json"]' }])).toBe(false);
  });

  it("rejects generated-table-only provenance for supported values", () => {
    expect(
      finalEval.validateFillMapProvenance([
        {
          location: "Table IV",
          metric: "bad",
          displayed_value: "1.000",
          source_artifacts: '["experiments/results/final-paper-v1/tables/table-iv-main-results.csv"]',
          source_sha256s: '["abc"]',
          output_table_path: "experiments/results/final-paper-v1/tables/table-iv-main-results.csv",
          evidence_class: "DETERMINISTIC_CONTROLLED_RUNTIME"
        }
      ]).status
    ).toBe("FAIL");
  });

  it("parses CSV cells with embedded commas", () => {
    expect(finalEval.parseCsv('a,b\n"x,y",z\n')).toEqual([{ a: "x,y", b: "z" }]);
  });
});
