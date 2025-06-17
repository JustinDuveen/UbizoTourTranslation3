import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";
import { normalizeLanguageForStorage } from "@/lib/redisKeys";

/**
 * Helper function to extract the user from the request cookies.
 */
function getUserFromHeaders() {
  const headersList = headers();
  const cookieHeader = headersList.get("cookie") || "";
  const token = cookieHeader
    .split("; ")
    .find((row) => row.startsWith("token="))
    ?.split("=")[1];
  return token ? verifyToken(token) : null;
}

interface DiagnosticResult {
  timestamp: string;
  tourId: string;
  language: string;
  issues: string[];
  fixes: string[];
  redisKeys: {
    offer: { key: string; exists: boolean; data?: any };
    answers: { key: string; exists: boolean; count: number; data?: any[] };
    guideStatus: { key: string; exists: boolean; data?: any };
    iceGuide: { key: string; exists: boolean; count: number };
    iceAttendee: { key: string; exists: boolean; count: number };
  };
  recommendations: string[];
}

/**
 * GET endpoint for running connection diagnostics
 */
export async function GET(request: Request) {
  try {
    // Authenticate the user (allow both guide and attendee for diagnostics)
    const user = getUserFromHeaders();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract and validate parameters
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const language = searchParams.get("language");
    const attendeeId = searchParams.get("attendeeId");

    if (!tourId || !language) {
      return NextResponse.json({ error: "Missing required parameters: tourId, language" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Normalize language for consistent key generation
    const normalizedLanguage = normalizeLanguageForStorage(language);
    const timestamp = new Date().toISOString();
    const issues: string[] = [];
    const fixes: string[] = [];
    const recommendations: string[] = [];

    console.log(`🔍 [DIAGNOSTICS-API] Starting connection diagnosis for tour ${tourId}, language ${language} (normalized: ${normalizedLanguage})`);

    // Check all Redis keys
    const redisKeys = await checkRedisKeys(redis, tourId, normalizedLanguage, attendeeId);

    // Analyze offer availability
    if (!redisKeys.offer.exists) {
      issues.push('No WebRTC offer found - guide has not started broadcasting');
      recommendations.push('Guide must start the tour and begin broadcasting before attendees can join');
    } else {
      fixes.push('WebRTC offer is available');
    }

    // Analyze attendee answers
    if (redisKeys.answers.count === 0) {
      issues.push('No attendee answers found - no attendees have joined');
      recommendations.push('Attendees need to join the tour for this language');
    } else {
      fixes.push(`Found ${redisKeys.answers.count} attendee answer(s)`);
    }

    // Analyze guide status
    if (!redisKeys.guideStatus.exists) {
      issues.push('Guide status not found - guide may not be properly broadcasting');
      recommendations.push('Guide should ensure broadcasting status is set');
    } else {
      fixes.push('Guide status is available');
    }

    // Analyze ICE candidates
    if (redisKeys.iceGuide.count === 0) {
      issues.push('No guide ICE candidates found - WebRTC connection may not be established');
      recommendations.push('Check WebRTC connection establishment process');
    } else {
      fixes.push(`Found ${redisKeys.iceGuide.count} guide ICE candidate(s)`);
    }

    if (redisKeys.iceAttendee.count === 0) {
      issues.push('No attendee ICE candidates found - attendees may not be connecting');
      recommendations.push('Check attendee WebRTC connection process');
    } else {
      fixes.push(`Found ${redisKeys.iceAttendee.count} attendee ICE candidate(s)`);
    }

    const result: DiagnosticResult = {
      timestamp,
      tourId,
      language: normalizedLanguage,
      issues,
      fixes,
      redisKeys,
      recommendations
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error running diagnostics:", error);
    return NextResponse.json(
      {
        error: "Failed to run diagnostics",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint for running connection repairs
 */
export async function POST(request: Request) {
  try {
    // Authenticate the user (require guide role for repairs)
    const user = getUserFromHeaders();
    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized: Guide role required for repairs" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { tourId, language, attendeeId } = body;

    if (!tourId || !language) {
      return NextResponse.json({ error: "Missing required parameters: tourId, language" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Normalize language for consistent key generation
    const normalizedLanguage = normalizeLanguageForStorage(language);
    const repairs: string[] = [];

    console.log(`🔧 [REPAIR-API] Starting connection repair for tour ${tourId}, language ${language}`);

    // First run diagnostics to identify issues
    const redisKeys = await checkRedisKeys(redis, tourId, normalizedLanguage, attendeeId);

    // Repair 1: Clean up stale data
    if (redisKeys.answers.count > 0 && redisKeys.iceGuide.count === 0) {
      console.log(`🔧 [REPAIR-API] Found answers but no guide ICE candidates - cleaning up stale answers`);
      await redis.del(redisKeys.answers.key);
      repairs.push('Cleaned up stale attendee answers');
    }

    // Repair 2: Clean up orphaned ICE candidates
    if (redisKeys.iceAttendee.count > 0 && redisKeys.answers.count === 0) {
      console.log(`🔧 [REPAIR-API] Found attendee ICE candidates but no answers - cleaning up orphaned ICE candidates`);
      await redis.del(redisKeys.iceAttendee.key);
      repairs.push('Cleaned up orphaned attendee ICE candidates');
    }

    // Repair 3: Reset guide status if inconsistent
    if (redisKeys.offer.exists && !redisKeys.guideStatus.exists) {
      console.log(`🔧 [REPAIR-API] Found offer but no guide status - resetting guide status`);
      const guideStatusKey = `tour:${tourId}:guide_status`;
      await redis.set(guideStatusKey, JSON.stringify({ broadcasting: true, timestamp: new Date().toISOString() }), 'EX', 7200);
      repairs.push('Reset guide broadcasting status');
    }

    return NextResponse.json({
      message: "Connection repair completed",
      repairs,
      repairCount: repairs.length
    });
  } catch (error) {
    console.error("Error running repairs:", error);
    return NextResponse.json(
      {
        error: "Failed to run repairs",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Helper function to check all Redis keys for diagnostics
 */
async function checkRedisKeys(redis: any, tourId: string, normalizedLanguage: string, attendeeId?: string) {
  const offerKey = `tour:${tourId}:offer:${normalizedLanguage}`;
  const answersKey = `tour:${tourId}:${normalizedLanguage}:answers`;
  const guideStatusKey = `tour:${tourId}:guide_status`;
  const iceGuideKey = attendeeId ? `ice:guide:${tourId}:${attendeeId}:${normalizedLanguage}` : `ice:guide:${tourId}:*:${normalizedLanguage}`;
  const iceAttendeeKey = attendeeId ? `ice:attendee:${tourId}:${attendeeId}:${normalizedLanguage}` : `ice:attendee:${tourId}:*:${normalizedLanguage}`;

  // Check offer
  const offerExists = await redis.exists(offerKey);
  let offerData = null;
  if (offerExists) {
    try {
      const offerJson = await redis.get(offerKey);
      offerData = JSON.parse(offerJson);
    } catch (error) {
      console.error('Error parsing offer data:', error);
    }
  }

  // Check answers
  const answersExists = await redis.exists(answersKey);
  const answersCount = answersExists ? await redis.lLen(answersKey) : 0;
  let answersData = null;
  if (answersExists && answersCount > 0) {
    try {
      answersData = await redis.lRange(answersKey, 0, -1);
    } catch (error) {
      console.error('Error getting answers data:', error);
    }
  }

  // Check guide status
  const guideStatusExists = await redis.exists(guideStatusKey);
  let guideStatusData = null;
  if (guideStatusExists) {
    try {
      const statusJson = await redis.get(guideStatusKey);
      guideStatusData = JSON.parse(statusJson);
    } catch (error) {
      console.error('Error parsing guide status data:', error);
    }
  }

  // Check ICE candidates (count keys matching pattern)
  const iceGuideKeys = await redis.keys(iceGuideKey);
  const iceAttendeeKeys = await redis.keys(iceAttendeeKey);

  return {
    offer: { key: offerKey, exists: offerExists, data: offerData },
    answers: { key: answersKey, exists: answersExists, count: answersCount, data: answersData },
    guideStatus: { key: guideStatusKey, exists: guideStatusExists, data: guideStatusData },
    iceGuide: { key: iceGuideKey, exists: iceGuideKeys.length > 0, count: iceGuideKeys.length },
    iceAttendee: { key: iceAttendeeKey, exists: iceAttendeeKeys.length > 0, count: iceAttendeeKeys.length }
  };
}
