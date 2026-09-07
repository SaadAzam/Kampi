-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- CreateIndex
CREATE INDEX "PlayerProgression_gameId_idx" ON "PlayerProgression"("gameId");

-- AddForeignKey
ALTER TABLE "PlayerProgression" ADD CONSTRAINT "PlayerProgression_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
