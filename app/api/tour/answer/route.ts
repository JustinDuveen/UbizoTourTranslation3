import { NextResponse } from "next/server";
import getRedisClient from "@/lib/redis";
import { normalizeLanguageForStorage } from "@/lib/languageUtils";
import { validateTourConnectionParams } from "@/lib/parameterValidation";
import { ParameterMismatchError } from "@/lib/types/audio";
import { getAnswersKey } from "@/lib/redisKeys";

// Simple in-memory cache for answers to reduce Redis calls
const answerCache = new Map<string, { answers: string[], timestamp: number }>();
const CACHE_TTL = 2000; // 2 seconds cache

// Handle requests for tour answers
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const language = searchParams.get("language");
    const normalizedLanguage = language ? normalizeLanguageForStorage(language) : null;

    if (!tourId || !normalizedLanguage) {
      return NextResponse.json(
        { error: "Missing tourId or language" },
        { status: 400 }
      );
    }

    const cacheKey = `${tourId}:${normalizedLanguage}`;
    const now = Date.now();

    // Check cache first
    const cached = answerCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json({ answers: cached.answers });
    }

    const redisClient = await getRedisClient();
    // CRITICAL FIX: Use standardized utility function for answer key generation
    const answersKey = getAnswersKey(tourId, normalizedLanguage, false); // normalizedLanguage already normalized above
    console.log(`[ANSWER-GET] Using answers key: ${answersKey}`);
    const answers = await redisClient.lrange(answersKey, 0, -1);

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
    const language = searchParams.get("language");
    const normalizedLanguage = language ? normalizeLanguageForStorage(language) : null;
    const body = await request.json(); // Extract the request body

    if (!tourId || !normalizedLanguage) {
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
    console.log(`Storing answer for tourId: ${tourId}, normalizedLanguage: ${normalizedLanguage}, attendeeId: ${attendeeId}`);

    // Store the complete answer data including attendeeId
    const answerData = {
      answer: answer,
      attendeeId: attendeeId,
      timestamp: Date.now()
    };

    const redisClient = await getRedisClient();
    // CRITICAL FIX: Use standardized utility function for answer key generation
    const answersKey = getAnswersKey(tourId, normalizedLanguage, false); // normalizedLanguage already normalized above
    console.log(`[ANSWER-POST] Storing answer to key: ${answersKey}`);
    await redisClient.rpush(answersKey, JSON.stringify(answerData));

    // Invalidate cache when new answer is added
    const cacheKey = `${tourId}:${normalizedLanguage}`;
    answerCache.delete(cacheKey);

    console.log(`Answer stored successfully in Redis for tourId: ${tourId}, normalizedLanguage: ${normalizedLanguage}, attendeeId: ${attendeeId}`);

    return NextResponse.json({ message: "Answer added successfully" });
  } catch (error) {
    console.error("POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}