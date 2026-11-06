-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('ACTIVE', 'AWAITING_APPROVAL', 'PURCHASING', 'BOUGHT', 'REFUNDED', 'PAUSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MandateMode" AS ENUM ('AUTO', 'ASK_FIRST');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('CAPTURED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('USER', 'AGENT', 'GUARD', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "paypalCustomerId" TEXT,
    "paypalVaultToken" TEXT,
    "monthlyBudget" DECIMAL(10,2) NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueCache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "products" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LikedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel3ProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "imageUrl" TEXT,
    "merchantUrl" TEXT,
    "merchantDomain" TEXT,
    "priceWhenLiked" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "likedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LikedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "likedItemId" TEXT NOT NULL,
    "channel3ProductId" TEXT NOT NULL,
    "variant" TEXT,
    "merchantUrl" TEXT,
    "status" "WatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "limitJustRaised" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "maxPrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "mode" "MandateMode" NOT NULL DEFAULT 'AUTO',
    "allowedMerchants" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCheck" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "inStock" BOOLEAN NOT NULL,
    "variant" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "priceCheckId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "paypalOrderId" TEXT NOT NULL,
    "captureId" TEXT,
    "refundId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PurchaseStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "actor" "Actor" NOT NULL,
    "action" TEXT NOT NULL,
    "rule" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "watchId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueCache_query_key" ON "CatalogueCache"("query");

-- CreateIndex
CREATE UNIQUE INDEX "LikedItem_userId_channel3ProductId_key" ON "LikedItem"("userId", "channel3ProductId");

-- CreateIndex
CREATE INDEX "Watch_status_idx" ON "Watch"("status");

-- CreateIndex
CREATE INDEX "Watch_userId_status_idx" ON "Watch"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_watchId_key" ON "Mandate"("watchId");

-- CreateIndex
CREATE INDEX "PriceCheck_watchId_checkedAt_idx" ON "PriceCheck"("watchId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_requestId_key" ON "Purchase"("requestId");

-- CreateIndex
CREATE INDEX "AuditLog_watchId_createdAt_idx" ON "AuditLog"("watchId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- AddForeignKey
ALTER TABLE "LikedItem" ADD CONSTRAINT "LikedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_likedItemId_fkey" FOREIGN KEY ("likedItemId") REFERENCES "LikedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCheck" ADD CONSTRAINT "PriceCheck_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "Watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
