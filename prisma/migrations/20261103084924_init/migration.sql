-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'verify',
    "parentId" TEXT,
    "monitorId" TEXT,
    "subjectType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "licenseNumber" TEXT,
    "sourceUrlInput" TEXT,
    "inputHash" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "registryId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "outcome" TEXT,
    "resultJson" TEXT,
    "errorJson" TEXT,
    "providerRunIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationId" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Candidate_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "contentHash" TEXT,
    "excerptsJson" TEXT NOT NULL,
    "text" TEXT,
    CONSTRAINT "EvidenceSnapshot_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "providerId" TEXT,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL,
    "scheduleCron" TEXT NOT NULL,
    "configJson" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "webhookActive" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "registryName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "baselineJson" TEXT NOT NULL,
    "currentStatus" TEXT NOT NULL,
    "lastCheckedAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastChangeAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MonitorRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "providerRunId" TEXT,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "diff" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonitorRun_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monitorId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previous" TEXT,
    "next" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "runId" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "refsJson" TEXT NOT NULL DEFAULT '{}',
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "dedupeKey" TEXT NOT NULL PRIMARY KEY,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Verification_ownerId_createdAt_idx" ON "Verification"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Verification_state_idx" ON "Verification"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_ownerId_idempotencyKey_key" ON "Verification"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Candidate_verificationId_idx" ON "Candidate"("verificationId");

-- CreateIndex
CREATE INDEX "EvidenceSnapshot_verificationId_idx" ON "EvidenceSnapshot"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "Monitor_providerId_key" ON "Monitor"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Monitor_dedupeKey_key" ON "Monitor"("dedupeKey");

-- CreateIndex
CREATE INDEX "Monitor_ownerId_status_idx" ON "Monitor"("ownerId", "status");

-- CreateIndex
CREATE INDEX "MonitorRun_monitorId_createdAt_idx" ON "MonitorRun"("monitorId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_ownerId_detectedAt_idx" ON "Alert"("ownerId", "detectedAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_ownerId_createdAt_idx" ON "ActivityEvent"("ownerId", "createdAt");
