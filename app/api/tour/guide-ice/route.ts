import { NextResponse } from "next/server";
import getRedisClient from "@/lib/redis";

// Simple cache for ICE candidates to reduce Redis calls
const iceCache = new Map<string, { candidates: any[], totalCount: number, timestamp: number }>();
const ICE_CACHE_TTL = 1000; // 1 second cache for ICE candidates

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tourId = searchParams.get("tourId");
  const languageParam = searchParams.get("language");
  const attendeeId = searchParams.get("attendeeId");
  const lastKnownIndexParam = searchParams.get("lastKnownIndex");

  if (!tourId || !languageParam || !attendeeId) {
    return NextResponse.json(
      { error: "Missing tourId, language, or attendeeId" },
      { status: 400 }
    );
  }

  // CRITICAL FIX: Use standardized ICE candidate key generation
  const { getIceCandidateKey, normalizeLanguageForStorage } = await import("@/lib/redisKeys");
  const language = normalizeLanguageForStorage(languageParam);
  const redisKey = getIceCandidateKey('guide', tourId, attendeeId, language, false);

  console.log(`🔧 ATTENDEE FETCHING GUIDE ICE: ${redisKey} (language: ${languageParam} → ${language})`);

  let lastKnownIndex = -1;
  if (lastKnownIndexParam !== null) {
    const parsedIndex = parseInt(lastKnownIndexParam, 10);
    if (!isNaN(parsedIndex) && parsedIndex >= -1) {
      lastKnownIndex = parsedIndex;
    } else {
      return NextResponse.json({ error: "Invalid lastKnownIndex" }, { status: 400 });
    }
  }

  const cacheKey = `${redisKey}:${lastKnownIndex}`;
  const now = Date.now();

  // Check cache first
  const cached = iceCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < ICE_CACHE_TTL) {
    const newCandidates = cached.candidates.slice(lastKnownIndex + 1);
    return NextResponse.json({
      candidates: newCandidates,
      totalInRedis: cached.totalCount,
      lastKnownIndex: lastKnownIndex,
      newCandidates: newCandidates.length
    }, { status: 200 });
  }

  try {
    const redisClient = await getRedisClient();
    if (!redisClient) {
      return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
    }

    // Get total length and fetch candidates in one go
    const [totalCandidates, candidatesStrings] = await Promise.all([
      redisClient.llen(redisKey),
      redisClient.lrange(redisKey, lastKnownIndex + 1, -1)
    ]);

    const candidates = candidatesStrings.map((c: string) => JSON.parse(c));

    // Update cache
    iceCache.set(cacheKey, {
      candidates: candidatesStrings.map((c: string) => JSON.parse(c)),
      totalCount: totalCandidates,
      timestamp: now
    });

    // Clean old cache entries periodically
    if (iceCache.size > 50) {
      const oldEntries = Array.from(iceCache.entries())
        .filter(([_, value]) => (now - value.timestamp) > ICE_CACHE_TTL * 5);
      oldEntries.forEach(([key]) => iceCache.delete(key));
    }

    // Reduced logging - only log when there are new candidates or errors
    if (candidates.length > 0) {
      console.log(`🎯 RETURNING ${candidates.length} GUIDE CANDIDATES to attendee ${attendeeId} for ${language}`);
    }

    return NextResponse.json({
      candidates,
      totalInRedis: totalCandidates,
      lastKnownIndex: lastKnownIndex,
      newCandidates: candidates.length
    }, { status: 200 });
  } catch (error) {
    console.error(`❌ Redis error fetching guide's ICE candidates from ${redisKey}:`, error);
    return NextResponse.json({ error: "Failed to fetch guide's ICE candidates" }, { status: 500 });
  }
}
