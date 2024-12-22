/*
  Warnings:

  - A unique constraint covering the columns `[redditId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLogin" TIMESTAMP(3),
ADD COLUMN     "profileImage" TEXT,
ADD COLUMN     "redditCreated" TIMESTAMP(3),
ADD COLUMN     "redditId" TEXT,
ADD COLUMN     "username" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_redditId_key" ON "User"("redditId");

-- CreateIndex
CREATE INDEX "User_redditId_idx" ON "User"("redditId");
