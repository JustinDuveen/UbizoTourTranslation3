// File: app/api/tour/offer/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";
import { executeReplaceOfferTransaction, getOfferKey, normalizeLanguageForStorage, formatLanguageForDisplay, getLanguageAttendeesKey } from "@/lib/languageUtils";

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

    // Prepare to store the offer in Redis
    const normalizedLanguage = normalizeLanguageForStorage(language);
    const displayLanguage = formatLanguageForDisplay(language);
    const offerKey = getOfferKey(tourId, normalizedLanguage);
    const langContext = `[GUIDE] [${displayLanguage}]`;

    console.log(`${langContext} Preparing to store offer at Redis key: ${offerKey}`);

    // Enhanced validation for SDP content
    let validatedOffer = offer;
    let isPlaceholder = false;

    // Check if this is a placeholder offer
    if (typeof offer === 'object' && offer.status === 'pending') {
      console.log(`${langContext} Detected placeholder offer with status: ${offer.status}`);
      isPlaceholder = true;
    } else if (typeof offer === 'object' && offer.offer &&
               typeof offer.offer === 'string' &&
               offer.offer.includes('Initialized offer for')) {
      console.log(`${langContext} Detected placeholder offer with initialization message`);
      isPlaceholder = true;
    }

    // Validate SDP content if this is not a placeholder
    if (!isPlaceholder && typeof offer === 'object' && offer.sdp && typeof offer.sdp === 'string') {
      if (!offer.sdp.includes('v=')) {
        console.error(`${langContext} Invalid SDP content detected, missing v= marker`);
        // Try to fix the SDP if possible
        if (offer.sdp.includes('\"v=')) {
          console.log(`${langContext} Found escaped v= marker, attempting to fix...`);
          validatedOffer = {
            ...offer,
            sdp: offer.sdp.replace(/\\"v=/g, 'v=').replace(/\\n/g, '\n')
          };
        }
      } else {
        console.log(`${langContext} Valid SDP content detected with v= marker`);
      }
    }

    // Use the transaction utility to safely replace any placeholder offer
    const success = await executeReplaceOfferTransaction(redis, tourId, language, validatedOffer, 7200);

    if (success) {
      console.log(`${langContext} Successfully stored offer using transaction`);
    } else {
      console.warn(`${langContext} Transaction did not replace offer, may already have a valid offer`);
    }

    // Verify the offer was stored correctly
    const verifiedOffer = await redis.get(offerKey);
    console.log(`${langContext} Verified offer in Redis: ${verifiedOffer ? 'Present' : 'Missing'}`);
    if (verifiedOffer) {
      console.log(`${langContext} Verified offer preview: ${verifiedOffer.substring(0, 100)}...`);
    }

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
    const languageParam = searchParams.get("language");
    const normalizedLanguage = languageParam ? normalizeLanguageForStorage(languageParam) : null;
    const displayLanguage = languageParam ? formatLanguageForDisplay(languageParam) : null;
    const tourCode = searchParams.get("tourCode");
    const attendeeName = searchParams.get("attendeeName");

    console.log(`[ATTENDEE] Request parameters - language: ${languageParam} (normalized: ${normalizedLanguage}), tourCode: ${tourCode}`);

    if (!normalizedLanguage || !tourCode) {
      return NextResponse.json({
        error: "Missing required parameters",
        details: {
          language: !normalizedLanguage,
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
    const isLanguageSupported = await redis.sIsMember(`tour:${tourId}:supported_languages`, normalizedLanguage);
    if (!isLanguageSupported) {
      return NextResponse.json({ error: "Language not supported for this tour" }, { status: 404 });
    }

    // Retrieve the offer from Redis
    const offerKey = getOfferKey(tourId, normalizedLanguage);
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
    const languageKey = getLanguageAttendeesKey(tourId, normalizedLanguage);

    // Store attendee details as JSON
    await redis.set(attendeeKey, JSON.stringify({
      name: attendeeName,
      language: normalizedLanguage,
      displayLanguage: displayLanguage,
      joinTime: new Date().toISOString(),
      userId: user.id.toString() // Ensure id is string for Redis
    }));

    // Add to language-specific attendee set
    await redis.sAdd(languageKey, user.id);

    // Add to general attendees set if not already registered
    const isRegistered = await redis.sIsMember(`tour:${tourId}:attendees`, user.id);
    if (!isRegistered) {
      await redis.sAdd(`tour:${tourId}:attendees`, user.id);

      // Publish attendee joined event
      await redis.publish(`tour:${tourId}:events`, JSON.stringify({
        type: 'attendee_joined',
        attendee: {
          id: user.id,
          name: attendeeName,
          language: normalizedLanguage,
          displayLanguage: displayLanguage,
          joinTime: new Date().toISOString()
        }
      }));
    }


    try {
      // Debug: Log the raw offer JSON
      console.log(`Raw offer JSON from Redis: ${offerJson.substring(0, 200)}${offerJson.length > 200 ? '...' : ''}`);

      // Parse the offer JSON
      const parsedOffer = JSON.parse(offerJson);
      console.log(`Offer parsed successfully, type: ${typeof parsedOffer}`);

      // Debug: Log more details about the parsed offer
      if (typeof parsedOffer === 'object') {
        console.log(`Parsed offer keys: ${Object.keys(parsedOffer).join(', ')}`);
        if (parsedOffer.sdp) {
          console.log(`SDP content starts with: ${parsedOffer.sdp.substring(0, 50)}...`);
          console.log(`SDP includes 'v=' marker: ${parsedOffer.sdp.includes('v=')}`);

          // Try to fix SDP if it's invalid
          if (!parsedOffer.sdp.includes('v=') && parsedOffer.sdp.includes('\"v=')) {
            console.log(`Found escaped v= marker, attempting to fix...`);
            parsedOffer.sdp = parsedOffer.sdp.replace(/\\"v=/g, 'v=').replace(/\\n/g, '\n');
          }
        }
      }

      // Return the offer with the tourId for reference
      return NextResponse.json({
        offer: parsedOffer,
        tourId: tourId
      });
    } catch (error) {
      let errorMessage = "Unknown error occurred";

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }

      console.error(`Error parsing offer JSON: ${errorMessage}`);
      return NextResponse.json(
        {
          error: "Invalid offer format",
          message: errorMessage,
        },
        { status: 500 }
      );
    }

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
