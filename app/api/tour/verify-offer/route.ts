// File: app/api/tour/verify-offer/route.ts
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
 * Validates if an SDP offer is properly formatted
 */
function validateSdpOffer(offer: any): { isValid: boolean; error?: string } {
  // Check if offer is an object
  if (!offer || typeof offer !== 'object') {
    return { isValid: false, error: 'Offer is not an object' };
  }

  // Check if it has type and sdp properties
  if (!offer.type || !offer.sdp) {
    return { isValid: false, error: 'Offer missing type or sdp properties' };
  }

  // Check if type is valid
  if (offer.type !== 'offer' && offer.type !== 'answer') {
    return { isValid: false, error: `Invalid offer type: ${offer.type}` };
  }

  // Check if sdp is a string
  if (typeof offer.sdp !== 'string') {
    return { isValid: false, error: 'SDP is not a string' };
  }

  // Check if sdp contains v= marker (required for valid SDP)
  if (!offer.sdp.includes('v=')) {
    return { isValid: false, error: 'SDP missing v= marker' };
  }

  return { isValid: true };
}

/**
 * GET endpoint for guides to verify their WebRTC offer was stored correctly.
 */
export async function GET(request: Request) {
  try {
    // Authenticate the guide
    const user = getUserFromHeaders();
    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract and validate parameters
    const { searchParams } = new URL(request.url);
    const language = searchParams.get("language");
    const tourId = searchParams.get("tourId");

    if (!language || !tourId) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Validate the tour exists
    const tourExists = await redis.exists(`tour:${tourId}`);
    if (!tourExists) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 });
    }

    // Retrieve the offer from Redis
    const offerKey = `tour:${tourId}:offer:${language}`;
    console.log(`[GUIDE] Verifying offer at Redis key: ${offerKey}`);
    
    const offerJson = await redis.get(offerKey);
    if (!offerJson) {
      return NextResponse.json({ 
        error: "Offer not found",
        status: "missing" 
      }, { status: 404 });
    }

    try {
      // Parse the offer JSON
      const parsedOffer = JSON.parse(offerJson);
      console.log(`[GUIDE] Offer parsed successfully, type: ${typeof parsedOffer}`);

      // Check if it's a placeholder offer
      if (parsedOffer.status === 'pending' || 
          (parsedOffer.offer && typeof parsedOffer.offer === 'string' && 
           parsedOffer.offer.includes('Initialized offer for'))) {
        console.log(`[GUIDE] Found placeholder offer instead of real offer`);
        return NextResponse.json({ 
          error: "Found placeholder offer",
          status: "placeholder" 
        }, { status: 400 });
      }

      // Validate the SDP offer
      const validation = validateSdpOffer(parsedOffer);
      if (!validation.isValid) {
        console.error(`[GUIDE] Invalid SDP offer: ${validation.error}`);
        return NextResponse.json({ 
          error: `Invalid SDP offer: ${validation.error}`,
          status: "invalid" 
        }, { status: 400 });
      }

      // Offer is valid
      return NextResponse.json({ 
        message: "Offer verified successfully",
        status: "valid",
        offerType: parsedOffer.type
      });
    } catch (error) {
      console.error(`[GUIDE] Error parsing offer JSON:`, error);
      return NextResponse.json({ 
        error: "Invalid offer format",
        message: error instanceof Error ? error.message : String(error),
        status: "parse_error"
      }, { status: 400 });
    }
  } catch (error) {
    console.error("Error verifying offer:", error);
    return NextResponse.json(
      {
        error: "Failed to verify offer",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
