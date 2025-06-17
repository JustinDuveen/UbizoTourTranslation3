import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";

// GET endpoint for guides to retrieve a specific attendee's ICE candidates
export async function GET(request: Request) {
  try {
    // Verify authentication: Ensure the requester is a guide
    const headersList = headers();
    const tokenCookie = headersList.get("cookie")?.split("; ").find(row => row.startsWith("token="));
    const token = tokenCookie ? tokenCookie.split("=")[1] : null;
    const user = token ? verifyToken(token) : null;

    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized: Guide role required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const languageParam = searchParams.get("language");
    const attendeeId = searchParams.get("attendeeId");
    const lastKnownIndexParam = searchParams.get("lastKnownIndex");

    if (!tourId || !languageParam || !attendeeId) {
      return NextResponse.json(
        { error: "Missing tourId, language, or attendeeId in query parameters" },
        { status: 400 }
      );
    }

    const redisClient = await getRedisClient();
    if (!redisClient) {
      return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
    }

    // CRITICAL FIX: Use standardized ICE candidate key generation
    const { getIceCandidateKey, normalizeLanguageForStorage } = await import("@/lib/redisKeys");
    const language = normalizeLanguageForStorage(languageParam);
    const redisKey = getIceCandidateKey('attendee', tourId, attendeeId, language, false);

    console.log(`🔧 GUIDE FETCHING ATTENDEE ICE: ${redisKey} (language: ${languageParam} → ${language})`);

    let lastKnownIndex = -1;
    if (lastKnownIndexParam !== null) {
      const parsedIndex = parseInt(lastKnownIndexParam, 10);
      if (!isNaN(parsedIndex) && parsedIndex >= -1) {
        lastKnownIndex = parsedIndex;
      } else {
        return NextResponse.json({ error: "Invalid lastKnownIndex" }, { status: 400 });
      }
    }

    // Fetch candidates from the list starting after lastKnownIndex
    const candidatesStrings = await redisClient.lRange(redisKey, lastKnownIndex + 1, -1);

    const candidates = candidatesStrings.map((c: string) => JSON.parse(c));

    // console.log(`Guide ${user.id} fetched ${candidates.length} ICE candidates for attendee ${attendeeId} (tour ${tourId}, lang ${language}) from ${redisKey} after index ${lastKnownIndex}`);
    return NextResponse.json({ candidates }, { status: 200 });

  } catch (error) {
    console.error("Error retrieving attendee ICE candidates for guide:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to retrieve attendee ICE candidates", details: errorMessage },
      { status: 500 }
    );
  }
}

// POST method removed as attendees will use the generic /api/tour/ice-candidate endpoint
// with sender: 'attendee'.
