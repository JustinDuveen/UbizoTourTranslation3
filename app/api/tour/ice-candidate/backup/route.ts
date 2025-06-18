import { NextResponse } from "next/server";
import getRedisClient from "@/lib/redis";

export async function POST(request: Request) {
  try {
    const { tourId, attendeeId, language, action, timestamp } = await request.json();

    if (!tourId || !attendeeId || !language || !action) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const redisClient = await getRedisClient();
    if (!redisClient) {
      return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
    }

    if (action === 'backup_and_clear') {
      const { getIceCandidateKey, normalizeLanguageForStorage } = await import("@/lib/redisKeys");
      const normalizedLanguage = normalizeLanguageForStorage(language);
      const candidateKey = getIceCandidateKey('guide', tourId, attendeeId, normalizedLanguage, false);
      const backupKey = `${candidateKey}_restart_backup_${timestamp}`;

      try {
        // Get existing candidates
        const existingCandidates = await redisClient.lrange(candidateKey, 0, -1);
        
        if (existingCandidates.length > 0) {
          // Create backup
          await redisClient.rpush(backupKey, ...existingCandidates);
          await redisClient.expire(backupKey, 300); // 5-minute backup
          
          // Clear original key only after backup is confirmed
          await redisClient.del(candidateKey);
          
          console.log(`[ICE-BACKUP] ✅ Backed up ${existingCandidates.length} candidates for ${attendeeId} in ${language}`);
          
          return NextResponse.json({
            message: `Backed up ${existingCandidates.length} candidates and cleared original key`,
            backupKey: backupKey,
            candidatesBackedUp: existingCandidates.length
          });
        } else {
          return NextResponse.json({
            message: "No candidates to backup",
            candidatesBackedUp: 0
          });
        }
      } catch (error) {
        console.error(`[ICE-BACKUP] ❌ Failed to backup candidates:`, error);
        return NextResponse.json(
          { error: "Failed to backup candidates" },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("[ICE-BACKUP] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}