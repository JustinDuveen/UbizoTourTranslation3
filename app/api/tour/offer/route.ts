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

    // Store the offer in Redis under a composite key
    const offerKey = `tour:${tourId}:offer:${language}`;
    await redis.set(offerKey, JSON.stringify(offer), "EX", 300); // 5-minute expiry

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

    // Extract and validate query parameters
    const { searchParams } = new URL(request.url);
    const language = searchParams.get("language");
    if (!language) {
      return NextResponse.json({ error: "Missing language parameter" }, { status: 400 });
    }
    const tourCode = searchParams.get("tourCode");
    if (!tourCode) {
      return NextResponse.json({ error: "Missing tourCode parameter" }, { status: 400 });
    }

    // Get Redis client and retrieve tourId from tourCode
    const redis = await getRedisClient();
    const tourId = await redis.get(`tour_codes:${tourCode}`);
    if (!tourId) {
      return NextResponse.json({ error: "No active tour found for this guide" }, { status: 404 });
    }

    // Validate tour existence
    const tourExists = await redis.exists(`tour:${tourId}`);
    if (!tourExists) {
      return NextResponse.json({ error: "Invalid tour code" }, { status: 404 });
    }

    // Retrieve the offer from Redis
    const offerKey = `tour:${tourId}:offer:${language}`;
    const offerJson = await redis.get(offerKey);
    if (!offerJson) {
      return NextResponse.json({ error: "Offer not found for this language" }, { status: 404 });
    }

    // Check if the offer has expired
    const ttl = await redis.ttl(offerKey);
    if (ttl < 0) {
      return NextResponse.json({ error: "Offer has expired" }, { status: 404 });
    }

    // Register this attendee with the tour (if not already registered)
    const isRegistered = await redis.sismember(`tour:${tourId}:attendees`, user.id);
    if (!isRegistered) {
      await redis.sadd(`tour:${tourId}:attendees`, user.id);
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