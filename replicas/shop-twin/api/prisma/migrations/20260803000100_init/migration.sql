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

CREATE TABLE "products" (
  "id" TEXT PRIMARY KEY,
  "sku" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "inventory" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "addresses" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "label" TEXT NOT NULL,
  "line1" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL
);

CREATE TABLE "cart_items" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cart_items_userId_productId_key" UNIQUE ("userId", "productId")
);

CREATE TABLE "orders" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "addressId" TEXT NOT NULL REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL,
  "shippingMethod" TEXT NOT NULL,
  "subtotalCents" INTEGER NOT NULL,
  "shippingCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "idempotencyKey" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "canceledAt" TIMESTAMP(3)
);

CREATE TABLE "order_items" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL
);

CREATE TABLE "payments" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "idempotencyKey" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "refunds" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp");
CREATE INDEX "audit_events_journeyId_idx" ON "audit_events"("journeyId");
CREATE INDEX "idempotency_keys_userId_idx" ON "idempotency_keys"("userId");
CREATE INDEX "products_category_idx" ON "products"("category");
CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");
CREATE INDEX "cart_items_userId_idx" ON "cart_items"("userId");
CREATE INDEX "orders_userId_idx" ON "orders"("userId");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
CREATE INDEX "order_items_sku_idx" ON "order_items"("sku");
