CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "defect_flags" (
  "id" TEXT PRIMARY KEY,
  "family" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "affectedJourney" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "expectedFailure" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "audit_events" (
  "id" TEXT PRIMARY KEY,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  "role" TEXT,
  "journeyId" TEXT,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "errorCode" TEXT,
  "beforeState" JSONB,
  "afterState" JSONB,
  "defectVersion" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "idempotency_keys" (
  "key" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "onboarding_states" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "step" INTEGER NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "workspaces" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "ownerId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "memberships" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_workspaceId_userId_key" UNIQUE ("workspaceId", "userId")
);

CREATE TABLE "invitations" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitations_workspaceId_email_key" UNIQUE ("workspaceId", "email")
);

CREATE TABLE "subscriptions" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL UNIQUE REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "plan" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "idempotencyKey" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "integrations" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "endpointUrl" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "secretPreview" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integrations_workspaceId_name_key" UNIQUE ("workspaceId", "name")
);

CREATE TABLE "api_keys" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "maskedValue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3)
);

CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp");
CREATE INDEX "audit_events_journeyId_idx" ON "audit_events"("journeyId");
CREATE INDEX "idempotency_keys_userId_idx" ON "idempotency_keys"("userId");
CREATE INDEX "workspaces_ownerId_idx" ON "workspaces"("ownerId");
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");
CREATE INDEX "invitations_email_idx" ON "invitations"("email");
CREATE INDEX "integrations_workspaceId_idx" ON "integrations"("workspaceId");
CREATE INDEX "api_keys_workspaceId_idx" ON "api_keys"("workspaceId");
