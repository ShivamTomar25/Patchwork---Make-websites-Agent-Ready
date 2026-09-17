CREATE SCHEMA IF NOT EXISTS repair;

CREATE TABLE IF NOT EXISTS repair.localization_events (
  id text PRIMARY KEY,
  journey_id text NOT NULL,
  run_id text NOT NULL,
  first_violated_predicate text NOT NULL,
  last_verified_checkpoint text NOT NULL,
  failure_category text NOT NULL,
  evidence_event_ids jsonb NOT NULL,
  confidence numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair.patch_candidates (
  patch_id text PRIMARY KEY,
  replica text NOT NULL,
  journey_ids jsonb NOT NULL,
  target_node_id text NOT NULL,
  operator text NOT NULL,
  source_files jsonb NOT NULL,
  source_diff text NOT NULL,
  rollback_diff text NOT NULL,
  generated_by text NOT NULL,
  template_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
