-- CreateTable
CREATE TABLE "SearchResult" (
    "id" TEXT NOT NULL,
    "tripId" TEXT,
    "departureLocation" TEXT NOT NULL,
    "destinations" TEXT[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "travelers" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "budgetLimit" INTEGER,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchResult_tripId_idx" ON "SearchResult"("tripId");

-- CreateIndex
CREATE INDEX "SearchResult_departureLocation_idx" ON "SearchResult"("departureLocation");

-- CreateIndex
CREATE INDEX "SearchResult_createdAt_idx" ON "SearchResult"("createdAt");
