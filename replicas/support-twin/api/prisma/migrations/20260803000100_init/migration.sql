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

CREATE TABLE "tickets" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "assigneeId" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "idempotencyKey" TEXT UNIQUE,
  "escalatedAt" TIMESTAMP(3),
  "satisfactionRating" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ticket_attachments" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ticket_comments" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "authorId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "knowledge_articles" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp");
CREATE INDEX "audit_events_journeyId_idx" ON "audit_events"("journeyId");
CREATE INDEX "idempotency_keys_userId_idx" ON "idempotency_keys"("userId");
CREATE INDEX "tickets_customerId_idx" ON "tickets"("customerId");
CREATE INDEX "tickets_assigneeId_idx" ON "tickets"("assigneeId");
CREATE INDEX "tickets_status_idx" ON "tickets"("status");
CREATE INDEX "tickets_priority_idx" ON "tickets"("priority");
CREATE INDEX "ticket_attachments_ticketId_idx" ON "ticket_attachments"("ticketId");
CREATE INDEX "ticket_comments_ticketId_idx" ON "ticket_comments"("ticketId");
CREATE INDEX "ticket_comments_authorId_idx" ON "ticket_comments"("authorId");
CREATE INDEX "knowledge_articles_category_idx" ON "knowledge_articles"("category");
