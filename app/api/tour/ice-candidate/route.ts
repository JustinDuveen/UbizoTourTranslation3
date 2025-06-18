import { NextResponse } from "next/server";
import getRedisClient from "@/lib/redis";

export async function POST(request: Request) {
  const { tourId, language, candidate, attendeeId, sender } = await request.json();

  if (!tourId || !language || !candidate || !attendeeId || !sender) {
    return NextResponse.json(
      { error: "Missing tourId, language, candidate, attendeeId, or sender" },
      { status: 400 }
    );
  }

  if (sender !== 'guide' && sender !== 'attendee') {
    return NextResponse.json({ error: "Invalid sender type" }, { status: 400 });
  }

  const redisClient = await getRedisClient();
  if (!redisClient) {
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }

  // CRITICAL FIX: Use standardized ICE candidate key generation
  const { getIceCandidateKey, normalizeLanguageForStorage } = await import("@/lib/redisKeys");
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const redisKey = getIceCandidateKey(sender, tourId, attendeeId, normalizedLanguage, false);

  console.log(`🔧 STANDARDIZED ICE KEY: ${redisKey} (language: ${language} → ${normalizedLanguage})`);

  try {
    // CRITICAL FIX: Add deduplication before storing candidate
    const existingCandidates = await redisClient.lrange(redisKey, 0, -1);
    const candidateString = JSON.stringify(candidate);
    
    // Check for duplicate candidates based on the actual candidate string
    const isDuplicate = existingCandidates.some(existing => {
      try {
        const parsed = JSON.parse(existing);
        return parsed.candidate === candidate.candidate;
      } catch (e) {
        return false;
      }
    });

    if (isDuplicate) {
      console.log(`⚠️ DUPLICATE PREVENTED: Skipping duplicate ICE candidate for ${sender} to ${redisKey}`);
      console.log(`⚠️ Duplicate candidate: ${candidate.candidate ? candidate.candidate.substring(0,80) + '...' : 'empty candidate'}`);
      
      return NextResponse.json({
        message: `Duplicate ICE candidate skipped for ${sender}`,
        candidateNumber: existingCandidates.length,
        redisKey: redisKey,
        duplicate: true
      }, { status: 200 });
    }

    // Store the candidate object in a Redis list (only if not duplicate)
    await redisClient.rpush(redisKey, candidateString);
    // Optional: Set an expiry for the list if candidates are not needed indefinitely
    // await redisClient.expire(redisKey, 3600); // Expires in 1 hour

    // Enhanced logging for debugging ICE candidate delivery
    const listLength = await redisClient.llen(redisKey);
    console.log(`🔥 NEW CANDIDATE STORED: ICE candidate #${listLength} for ${sender} to ${redisKey}`);
    console.log(`🔥 Candidate details: ${candidate.candidate ? candidate.candidate.substring(0,80) + '...' : 'empty candidate'}`);
    console.log(`🔥 Redis key: ${redisKey}`);
    console.log(`🔥 Total unique candidates now in Redis for this key: ${listLength}`);

    // If this is a guide candidate, log it prominently for debugging
    if (sender === 'guide') {
      console.log(`🎯 GUIDE ICE CANDIDATE STORED: #${listLength} for attendee ${attendeeId} in ${language}`);
      console.log(`🎯 Attendees should poll this key: ${redisKey}`);
    }

    return NextResponse.json({
      message: `ICE candidate from ${sender} stored`,
      candidateNumber: listLength,
      redisKey: redisKey
    }, { status: 200 });
  } catch (error) {
    console.error(`❌ Redis error storing ICE candidate for ${sender} to ${redisKey}:`, error);
    return NextResponse.json({ error: `Failed to store ICE candidate for ${sender}` }, { status: 500 });
  }
}
