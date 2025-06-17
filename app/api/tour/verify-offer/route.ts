// File: app/api/tour/verify-offer/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";
import { normalizeLanguageForStorage, formatLanguageForDisplay, getOfferKey, getAlternativeOfferKeys, isPlaceholderOffer } from "@/lib/languageUtils";

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
  // Extract parameters outside try block for catch block access
  const { searchParams } = new URL(request.url);
  const languageParam = searchParams.get("language");
  const tourId = searchParams.get("tourId");

  try {
    // Authenticate the guide
    const user = getUserFromHeaders();
    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!languageParam || !tourId) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Normalize language for consistent key generation
    const language = normalizeLanguageForStorage(languageParam);
    const displayLanguage = formatLanguageForDisplay(languageParam);
    console.log(`[GUIDE] Normalized language: ${language} (from ${languageParam})`);


    // Get Redis client
    const redis = await getRedisClient();

    // Validate the tour exists
    const tourExists = await redis.exists(`tour:${tourId}`);
    if (!tourExists) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 });
    }

    // Retrieve the offer from Redis with retry logic
    // Use the updated getOfferKey function with normalizeLanguage=false
    // This prevents double normalization since we already normalized the language
    const offerKey = getOfferKey(tourId, language, false);

    // For debugging
    console.log(`[GUIDE] Using offer key: ${offerKey}`);
    console.log(`[GUIDE] Verifying offer at Redis key: ${offerKey}`);

    let offerJson = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (!offerJson && retryCount < maxRetries) {
      try {
        offerJson = await redis.get(offerKey);
        if (!offerJson) {
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(`[GUIDE] Offer not found, retrying (${retryCount}/${maxRetries})...`);
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
          }
        }
      } catch (error) {
        console.error(`[GUIDE] Error retrieving offer (attempt ${retryCount + 1}/${maxRetries}):`, error);
        retryCount++;
        if (retryCount < maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
        }
      }
    }

    if (!offerJson) {
      // Check for alternative keys (case variations)
      // Use the original languageParam to generate alternative keys
      const alternativeKeys = getAlternativeOfferKeys(tourId, languageParam);
      console.log(`[GUIDE] Checking alternative keys: ${alternativeKeys.join(', ')}`);

      // Also check the key with double normalization (the old way)
      const doubleNormalizedKey = getOfferKey(tourId, language, true);
      if (doubleNormalizedKey !== offerKey) {
        console.log(`[GUIDE] Also checking double-normalized key: ${doubleNormalizedKey}`);
        try {
          offerJson = await redis.get(doubleNormalizedKey);
          if (offerJson) {
            console.log(`[GUIDE] Found offer at double-normalized key: ${doubleNormalizedKey}`);
          }
        } catch (error) {
          console.error(`[GUIDE] Error checking double-normalized key:`, error);
        }
      }

      // Check other alternative keys
      for (const altKey of alternativeKeys) {
        try {
          offerJson = await redis.get(altKey);
          if (offerJson) {
            console.log(`[GUIDE] Found offer at alternative key: ${altKey}`);
            break;
          }
        } catch (error) {
          console.error(`[GUIDE] Error checking alternative key ${altKey}:`, error);
        }
      }

      if (!offerJson) {
        return NextResponse.json({
          error: "Offer not found after retries",
          status: "missing",
          checkedKeys: [offerKey, doubleNormalizedKey, ...alternativeKeys].filter((key, index, self) =>
            // Remove duplicates
            self.indexOf(key) === index
          )
        }, { status: 404 });
      }
    }

    try {
      // Parse the offer JSON
      const parsedOffer = JSON.parse(offerJson);
      console.log(`[GUIDE] Offer parsed successfully, type: ${typeof parsedOffer}`);

      // Check if it's a placeholder offer using the utility function
      if (isPlaceholderOffer(parsedOffer)) {
        console.log(`[GUIDE] Found placeholder offer instead of real offer for ${displayLanguage}`);
        return NextResponse.json({
          error: "Found placeholder offer",
          status: "placeholder",
          language: displayLanguage,
          normalizedLanguage: language
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
        offerType: parsedOffer.type,
        language: displayLanguage,
        normalizedLanguage: language,
        offerKey: offerKey,
        version: parsedOffer.version || 'unknown'
      });
    } catch (error) {
      console.error(`[GUIDE] Error parsing offer JSON:`, error);
      return NextResponse.json({
        error: "Invalid offer format",
        message: error instanceof Error ? error.message : String(error),
        status: "parse_error",
        language: displayLanguage,
        normalizedLanguage: language,
        offerKey: offerKey
      }, { status: 400 });
    }
  } catch (error) {
    console.error("Error verifying offer:", error);
    return NextResponse.json(
      {
        error: "Failed to verify offer",
        message: error instanceof Error ? error.message : String(error),
        tourId: tourId || 'unknown',
        language: languageParam || 'unknown'
      },
      { status: 500 }
    );
  }
}
