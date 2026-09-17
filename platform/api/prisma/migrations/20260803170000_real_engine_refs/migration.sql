-- Add external harness references and summary metrics for real local pilot runs.
ALTER TABLE "ExperimentRun"
  ADD COLUMN "engineMode" TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN "externalExperimentId" TEXT,
  ADD COLUMN "externalRunId" TEXT,
  ADD COLUMN "summaryMetrics" JSONB,
  ADD COLUMN "exportDirectory" TEXT;

CREATE INDEX "ExperimentRun_engineMode_idx" ON "ExperimentRun"("engineMode");
CREATE INDEX "ExperimentRun_externalExperimentId_idx" ON "ExperimentRun"("externalExperimentId");
