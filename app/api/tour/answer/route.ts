import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";
import { normalizeLanguageForStorage, getAnswersKey } from "@/lib/redisKeys";

// Simple in-memory cache for answers to reduce Redis calls
const answerCache = new Map<string, { answers: string[], timestamp: number }>();
const CACHE_TTL = 2000; // 2 seconds cache

// Handle requests for tour answers
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const languageParam = searchParams.get("language");
    const language = languageParam ? normalizeLanguageForStorage(languageParam) : null;

    if (!tourId || !language) {
      return NextResponse.json(
        { error: "Missing tourId or language" },
        { status: 400 }
      );
    }

    const cacheKey = `${tourId}:${language}`;
    const now = Date.now();

    // Check cache first
    const cached = answerCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json({ answers: cached.answers });
    }

    const redisClient = await getRedisClient();
    // CRITICAL FIX: Use standardized utility function for answer key generation
    const answersKey = getAnswersKey(tourId, language, false); // language already normalized above
    console.log(`[ANSWER-GET] Using answers key: ${answersKey}`);
    const answers = await redisClient.lRange(answersKey, 0, -1);

    // Update cache
    answerCache.set(cacheKey, { answers, timestamp: now });

    // Clean old cache entries (simple cleanup)
    if (answerCache.size > 100) {
      const oldEntries = Array.from(answerCache.entries())
        .filter(([_, value]) => (now - value.timestamp) > CACHE_TTL * 5);
      oldEntries.forEach(([key]) => answerCache.delete(key));
    }

    return NextResponse.json({ answers });
  } catch (error) {
    console.error("GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const languageParam = searchParams.get("language");
    const language = languageParam ? normalizeLanguageForStorage(languageParam) : null;
    const body = await request.json(); // Extract the request body

    if (!tourId || !language) {
      return NextResponse.json(
        { error: "Missing tourId or language" },
        { status: 400 }
      );
    }

    if (!body || !body.answer) {
      return NextResponse.json({ error: "Missing answer in body" }, {status: 400});
    }

    const answer = body.answer;
    const attendeeId = body.attendeeId;
    console.log(`Storing answer for tourId: ${tourId}, language: ${language}, attendeeId: ${attendeeId}`);

    // Store the complete answer data including attendeeId
    const answerData = {
      answer: answer,
      attendeeId: attendeeId,
      timestamp: Date.now()
    };

    const redisClient = await getRedisClient();
    // CRITICAL FIX: Use standardized utility function for answer key generation
    const answersKey = getAnswersKey(tourId, language, false); // language already normalized above
    console.log(`[ANSWER-POST] Storing answer to key: ${answersKey}`);
    await redisClient.rPush(answersKey, JSON.stringify(answerData));

    // Invalidate cache when new answer is added
    const cacheKey = `${tourId}:${language}`;
    answerCache.delete(cacheKey);

    console.log(`Answer stored successfully in Redis for tourId: ${tourId}, language: ${language}, attendeeId: ${attendeeId}`);

    return NextResponse.json({ message: "Answer added successfully" });
  } catch (error) {
    console.error("POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}