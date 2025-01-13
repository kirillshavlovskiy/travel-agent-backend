-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "country" TEXT,
    "city" JSONB,
    "cities" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "travelers" INTEGER,
    "currency" TEXT,
    "overallBudget" DOUBLE PRECISION,
    "selectedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "tripPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "preBooked" BOOLEAN NOT NULL DEFAULT false,
    "cost" DOUBLE PRECISION,
    "budgetType" TEXT NOT NULL,
    "budgetValue" DOUBLE PRECISION NOT NULL,
    "defaultPercentage" DOUBLE PRECISION NOT NULL,
    "selectedTier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "estimates" JSONB,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartureLocation" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "airport" TEXT,
    "tripPlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartureLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_history" (
    "tripPlanId" TEXT,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimates" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "id" SERIAL NOT NULL,

    CONSTRAINT "estimate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerplexityReference" (
    "id" SERIAL NOT NULL,
    "estimateHistoryId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "priceTier" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3),
    "link" TEXT,
    "perplexityComment" TEXT,
    "overview" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerplexityReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightReference" (
    "id" TEXT NOT NULL,
    "perplexityReferenceId" INTEGER NOT NULL,
    "airline" TEXT NOT NULL,
    "outboundFlight" TEXT NOT NULL,
    "inboundFlight" TEXT,
    "outboundDate" TIMESTAMP(3) NOT NULL,
    "inboundDate" TIMESTAMP(3),
    "layovers" INTEGER NOT NULL DEFAULT 0,
    "flightDuration" TEXT,
    "baggageAllowance" TEXT,
    "bookingClass" TEXT NOT NULL,

    CONSTRAINT "FlightReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccommodationReference" (
    "id" TEXT NOT NULL,
    "perplexityReferenceId" INTEGER NOT NULL,
    "roomType" TEXT NOT NULL,
    "bedConfiguration" TEXT,
    "amenities" TEXT[],
    "location" TEXT NOT NULL,
    "checkInTime" TEXT,
    "checkOutTime" TEXT,
    "cancellationPolicy" TEXT,

    CONSTRAINT "AccommodationReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantReference" (
    "id" TEXT NOT NULL,
    "perplexityReferenceId" INTEGER NOT NULL,
    "cuisine" TEXT NOT NULL,
    "mealType" TEXT[],
    "averageMealPrice" DOUBLE PRECISION NOT NULL,
    "menuHighlights" TEXT[],
    "atmosphere" TEXT,
    "reservationRequired" BOOLEAN NOT NULL DEFAULT false,
    "openingHours" TEXT,

    CONSTRAINT "RestaurantReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityReference" (
    "id" TEXT NOT NULL,
    "perplexityReferenceId" INTEGER NOT NULL,
    "activityType" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "groupSize" TEXT,
    "includedItems" TEXT[],
    "restrictions" TEXT,
    "availability" TEXT,

    CONSTRAINT "ActivityReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "trip_plans_userId_idx" ON "trip_plans"("userId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_tripPlanId_idx" ON "ExpenseCategory"("tripPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_tripPlanId_key_key" ON "ExpenseCategory"("tripPlanId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DepartureLocation_tripPlanId_key" ON "DepartureLocation"("tripPlanId");

-- CreateIndex
CREATE INDEX "DepartureLocation_tripPlanId_idx" ON "DepartureLocation"("tripPlanId");

-- CreateIndex
CREATE INDEX "estimate_history_tripPlanId_idx" ON "estimate_history"("tripPlanId");

-- CreateIndex
CREATE INDEX "estimate_history_category_idx" ON "estimate_history"("category");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_history_tripPlanId_category_key" ON "estimate_history"("tripPlanId", "category");

-- CreateIndex
CREATE INDEX "PerplexityReference_estimateHistoryId_idx" ON "PerplexityReference"("estimateHistoryId");

-- CreateIndex
CREATE INDEX "PerplexityReference_category_idx" ON "PerplexityReference"("category");

-- CreateIndex
CREATE INDEX "PerplexityReference_priceTier_idx" ON "PerplexityReference"("priceTier");

-- CreateIndex
CREATE UNIQUE INDEX "FlightReference_perplexityReferenceId_key" ON "FlightReference"("perplexityReferenceId");

-- CreateIndex
CREATE INDEX "FlightReference_perplexityReferenceId_idx" ON "FlightReference"("perplexityReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "AccommodationReference_perplexityReferenceId_key" ON "AccommodationReference"("perplexityReferenceId");

-- CreateIndex
CREATE INDEX "AccommodationReference_perplexityReferenceId_idx" ON "AccommodationReference"("perplexityReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantReference_perplexityReferenceId_key" ON "RestaurantReference"("perplexityReferenceId");

-- CreateIndex
CREATE INDEX "RestaurantReference_perplexityReferenceId_idx" ON "RestaurantReference"("perplexityReferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityReference_perplexityReferenceId_key" ON "ActivityReference"("perplexityReferenceId");

-- CreateIndex
CREATE INDEX "ActivityReference_perplexityReferenceId_idx" ON "ActivityReference"("perplexityReferenceId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_tripPlanId_fkey" FOREIGN KEY ("tripPlanId") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartureLocation" ADD CONSTRAINT "DepartureLocation_tripPlanId_fkey" FOREIGN KEY ("tripPlanId") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_history" ADD CONSTRAINT "estimate_history_tripPlanId_fkey" FOREIGN KEY ("tripPlanId") REFERENCES "trip_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerplexityReference" ADD CONSTRAINT "PerplexityReference_estimateHistoryId_fkey" FOREIGN KEY ("estimateHistoryId") REFERENCES "estimate_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightReference" ADD CONSTRAINT "FlightReference_perplexityReferenceId_fkey" FOREIGN KEY ("perplexityReferenceId") REFERENCES "PerplexityReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccommodationReference" ADD CONSTRAINT "AccommodationReference_perplexityReferenceId_fkey" FOREIGN KEY ("perplexityReferenceId") REFERENCES "PerplexityReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantReference" ADD CONSTRAINT "RestaurantReference_perplexityReferenceId_fkey" FOREIGN KEY ("perplexityReferenceId") REFERENCES "PerplexityReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReference" ADD CONSTRAINT "ActivityReference_perplexityReferenceId_fkey" FOREIGN KEY ("perplexityReferenceId") REFERENCES "PerplexityReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
