 // File: app/api/tour/offer/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";

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

/**
 * POST endpoint for guides to store their WebRTC offer.
 */
export async function POST(request: Request) {
  try {
    // Authenticate the guide
    const user = getUserFromHeaders();
    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const { language, offer, tourId } = body;
    if (!language || !offer || !tourId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Validate the tour exists
    const tourExists = await redis.exists(`tour:${tourId}`);
    if (!tourExists) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 });
    }

    // Store the offer in Redis under a composite key with longer expiry
    const offerKey = `tour:${tourId}:offer:${language}`;
    await redis.set(offerKey, JSON.stringify(offer), "EX", 7200); // 2-hour expiry

    return NextResponse.json({ message: "Offer stored successfully" });
  } catch (error) {
    console.error("Error storing offer:", error);
    return NextResponse.json(
      {
        error: "Failed to store offer",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for attendees to retrieve the guide's WebRTC offer.
 */
export async function GET(request: Request) {
  try {
    // Authenticate the attendee
    const user = getUserFromHeaders();
    if (!user || user.role !== "attendee") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract and validate basic parameters
    const { searchParams } = new URL(request.url);
    const language = searchParams.get("language")?.toLowerCase();
    const tourCode = searchParams.get("tourCode");
    const attendeeName = searchParams.get("attendeeName");

    if (!language || !tourCode) {
      return NextResponse.json({ 
        error: "Missing required parameters",
        details: {
          language: !language,
          tourCode: !tourCode
        }
      }, { status: 400 });
    }

    // Get Redis client and retrieve tourId from tourCode
    const redis = await getRedisClient();
    const tourId = await redis.get(`tour_codes:${tourCode}`);
    if (!tourId) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 });
    }

    // Check if language is supported for this tour
    const isLanguageSupported = await redis.sIsMember(`tour:${tourId}:supported_languages`, language);
    if (!isLanguageSupported) {
      return NextResponse.json({ error: "Language not supported for this tour" }, { status: 404 });
    }

    // Retrieve the offer from Redis
    const offerKey = `tour:${tourId}:offer:${language}`;
    const offerJson = await redis.get(offerKey);
    if (!offerJson) {
      return NextResponse.json({ error: "Offer not found for this language" }, { status: 404 });
    }

    // Only validate attendeeName if we have a valid offer
    if (!attendeeName?.trim()) {
      return NextResponse.json({ 
        error: "Missing required parameter: attendeeName"
      }, { status: 400 });
    }

    // Register this attendee with the tour
    const attendeeKey = `tour:${tourId}:attendee:${user.id}`;
    const languageKey = `tour:${tourId}:language:${language}:attendees`;
    
    // Store attendee details
    await redis.hSet(attendeeKey, {
      name: attendeeName,
      language,
      joinTime: new Date().toISOString(),
      userId: user.id
    });

    // Add to language-specific attendee set
    await redis.sAdd(languageKey, user.id);

    // Add to general attendees set if not already registered
    const isRegistered = await redis.sismember(`tour:${tourId}:attendees`, user.id);
    if (!isRegistered) {
      await redis.sAdd(`tour:${tourId}:attendees`, user.id);
      
      // Publish attendee joined event
      await redis.publish(`tour:${tourId}:events`, JSON.stringify({
        type: 'attendee_joined',
        attendee: {
          id: user.id,
          name: attendeeName,
          language,
          joinTime: new Date().toISOString()
        }
      }));
    }

    return NextResponse.json({ offer: JSON.parse(offerJson) });
  } catch (error) {
    console.error("Error retrieving offer:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve offer",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
