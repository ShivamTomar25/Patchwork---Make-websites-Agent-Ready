CREATE TABLE "runs" (
  "run_id" TEXT PRIMARY KEY,
  "site" TEXT NOT NULL,
  "journey_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "seed" INTEGER NOT NULL,
  "defect_configuration" JSONB NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "ended_at" TIMESTAMP(3),
  "termination_reason" TEXT,
  "verified_success" BOOLEAN,
  "violations" JSONB NOT NULL,
  "latency_ms" INTEGER NOT NULL DEFAULT 0,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "steps" (
  "step_id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL REFERENCES "runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sequence_number" INTEGER NOT NULL,
  "url" TEXT NOT NULL,
  "observation_hash" TEXT NOT NULL,
  "observation_summary" TEXT NOT NULL,
  "action_type" TEXT NOT NULL,
  "action_payload_redacted" JSONB NOT NULL,
  "decision_reason" TEXT NOT NULL,
  "action_result" JSONB NOT NULL,
  "verifier_state" JSONB,
  "latency_ms" INTEGER NOT NULL DEFAULT 0,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "steps_run_id_sequence_number_key" UNIQUE ("run_id", "sequence_number")
);

CREATE TABLE "artifacts" (
  "artifact_id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL REFERENCES "runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "step_id" TEXT REFERENCES "steps"("step_id") ON DELETE SET NULL ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "local_path" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "runs_site_journey_id_agent_id_idx" ON "runs"("site", "journey_id", "agent_id");
CREATE INDEX "runs_started_at_idx" ON "runs"("started_at");
CREATE INDEX "steps_run_id_idx" ON "steps"("run_id");
CREATE INDEX "artifacts_run_id_idx" ON "artifacts"("run_id");
CREATE INDEX "artifacts_step_id_idx" ON "artifacts"("step_id");
