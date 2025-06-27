// File: app/api/tour/offer/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";
import { executeReplaceOfferTransaction, getOfferKey, normalizeLanguageForStorage, formatLanguageForDisplay, getLanguageAttendeesKey, validateSdpOffer, isPlaceholderOffer, getAlternativeOfferKeys } from "@/lib/languageUtils";

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
    // Use normalizeLanguage=false since we've already normalized the language
    const offerKey = getOfferKey(tourId, normalizedLanguage, false);
    const langContext = `[GUIDE] [${displayLanguage}]`;

    console.log(`${langContext} Preparing to store offer at Redis key: ${offerKey}`);

    // Enhanced validation for SDP content
    let validatedOffer = offer;

    // Check if this is a placeholder offer using the utility function
    const isPlaceholder = isPlaceholderOffer(offer);
    if (isPlaceholder) {
      console.log(`${langContext} Detected placeholder offer`);
    }

    // Validate SDP content if this is not a placeholder
    if (!isPlaceholder) {
      // Use the enhanced validation utility
      const validation = validateSdpOffer(offer);

      if (!validation.isValid) {
        console.error(`${langContext} SDP validation failed: ${validation.error}`);

        // Try to fix common SDP issues
        if (typeof offer === 'object' && offer.sdp && typeof offer.sdp === 'string') {
          // Fix escaped quotes and newlines
          if (offer.sdp.includes('\"v=')) {
            console.log(`${langContext} Found escaped v= marker, attempting to fix...`);
            validatedOffer = {
              ...offer,
              sdp: offer.sdp.replace(/\\"v=/g, 'v=').replace(/\\n/g, '\n')
            };

            // Validate the fixed offer
            const fixedValidation = validateSdpOffer(validatedOffer);
            if (fixedValidation.isValid) {
              console.log(`${langContext} Successfully fixed SDP content`);
            } else {
              console.error(`${langContext} Failed to fix SDP content: ${fixedValidation.error}`);
            }
          }
        }
      } else {
        console.log(`${langContext} SDP validation successful`);
      }
    }

    // Use the transaction utility to safely replace any placeholder offer
    const success = await executeReplaceOfferTransaction(redis, tourId, language, validatedOffer, 7200);

    if (success) {
      console.log(`${langContext} Successfully stored offer using transaction`);
    } else {
      console.warn(`${langContext} Transaction did not replace offer, may already have a valid offer`);
    }

    // Verify the offer was stored correctly with retry logic
    let verifiedOffer = null;
    let verificationAttempt = 0;
    const maxVerificationAttempts = 3;

    while (!verifiedOffer && verificationAttempt < maxVerificationAttempts) {
      try {
        verifiedOffer = await redis.get(offerKey);
        if (!verifiedOffer) {
          verificationAttempt++;
          if (verificationAttempt < maxVerificationAttempts) {
            console.log(`${langContext} Offer verification failed, retrying (${verificationAttempt}/${maxVerificationAttempts})...`);
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, verificationAttempt)));
          }
        }
      } catch (error) {
        console.error(`${langContext} Error verifying offer (attempt ${verificationAttempt + 1}/${maxVerificationAttempts}):`, error);
        verificationAttempt++;
        if (verificationAttempt < maxVerificationAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, verificationAttempt)));
        }
      }
    }

    if (!verifiedOffer) {
      console.error(`${langContext} Failed to verify offer after ${maxVerificationAttempts} attempts`);
      return NextResponse.json({
        error: "Failed to verify stored offer",
        message: "Offer may not have been stored correctly"
      }, { status: 500 });
    }

    console.log(`${langContext} Verified offer in Redis: Present`);
    console.log(`${langContext} Verified offer preview: ${verifiedOffer.substring(0, 100)}...`);

    // Now verify the offer via the verify-offer endpoint
    try {
      const headersList = headers();

      // Construct the verification URL
      let baseUrl = '';
      if (typeof window === 'undefined') {
        // Server-side: use Railway-compatible internal URL
        baseUrl = process.env.RAILWAY_STATIC_URL || 
                  process.env.NEXT_PUBLIC_API_URL || 
                  `http://localhost:${process.env.PORT || 3000}`;
      } else {
        // Client-side: use public URL
        baseUrl = process.env.NEXT_PUBLIC_API_BASE || '';
      }

      const verifyUrl = new URL(`${baseUrl}/api/tour/verify-offer`);
      verifyUrl.searchParams.append('tourId', tourId);
      verifyUrl.searchParams.append('language', language);

      console.log(`${langContext} Verifying offer via API: ${verifyUrl.toString()}`);

      const verifyResponse = await fetch(verifyUrl.toString(), {
        method: 'GET',
        headers: {
          'Cookie': headersList.get("cookie") || ""
        }
      });

      if (verifyResponse.ok) {
        const verifyData = await verifyResponse.json();
        console.log(`${langContext} Offer verification successful: ${JSON.stringify(verifyData)}`);
      } else {
        try {
          const errorData = await verifyResponse.json();
          console.error(`${langContext} Offer verification failed: ${JSON.stringify(errorData)}`);
        } catch (e) {
          console.error(`${langContext} Offer verification failed with status: ${verifyResponse.status}`);
        }
        // Continue despite verification failure, but log it
      }
    } catch (error) {
      console.error(`${langContext} Error during offer verification API call:`, error);
      // Continue despite verification error, but log it
    }

    return NextResponse.json({
      message: "Offer stored successfully",
      language: displayLanguage,
      normalizedLanguage: normalizedLanguage,
      offerKey: offerKey
    });
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
  // Extract parameters outside try block for catch block access
  const { searchParams } = new URL(request.url);
  const languageParam = searchParams.get("language");
  const tourCode = searchParams.get("tourCode");
  const attendeeName = searchParams.get("attendeeName");

  // Declare variables that might be referenced in catch block
  let tourId: string | null = null;
  let offer: any = null;

  try {
    // Authenticate the attendee
    const user = getUserFromHeaders();
    if (!user || user.role !== "attendee") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!languageParam || !tourCode) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Normalize language for consistent key generation
    const language = normalizeLanguageForStorage(languageParam);
    const displayLanguage = formatLanguageForDisplay(languageParam);
    console.log(`[ATTENDEE] Normalized language: ${language} (from ${languageParam})`);

    // Get Redis client
    const redis = await getRedisClient();

    // Get the tourId from the tour code with retry logic
    let retryCount = 0;
    const maxRetries = 3;

    while (!tourId && retryCount < maxRetries) {
      try {
        tourId = await redis.get(`tour_codes:${tourCode}`);
        if (!tourId) {
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(`[ATTENDEE] Tour ID not found, retrying (${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
          }
        }
      } catch (error) {
        console.error(`[ATTENDEE] Error retrieving tour ID (attempt ${retryCount + 1}/${maxRetries}):`, error);
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
        }
      }
    }

    if (!tourId) {
      return NextResponse.json({ error: "Invalid tour code" }, { status: 404 });
    }

    console.log(`[ATTENDEE] Found tourId: ${tourId} for tourCode: ${tourCode}`);

    // Get the offer from Redis with retry logic
    // Use normalizeLanguage=false since we've already normalized the language
    const offerKey = getOfferKey(tourId, language, false);
    console.log(`[ATTENDEE] Looking for offer at Redis key: ${offerKey}`);

    let offerJson = null;
    retryCount = 0;

    while (!offerJson && retryCount < maxRetries) {
      try {
        offerJson = await redis.get(offerKey);
        if (!offerJson) {
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(`[ATTENDEE] Offer not found, retrying (${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
          }
        }
      } catch (error) {
        console.error(`[ATTENDEE] Error retrieving offer (attempt ${retryCount + 1}/${maxRetries}):`, error);
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
        }
      }
    }

    // If still not found, check alternative keys
    if (!offerJson) {
      const alternativeKeys = getAlternativeOfferKeys(tourId, languageParam);
      console.log(`[ATTENDEE] Checking alternative keys: ${alternativeKeys.join(', ')}`);

      for (const altKey of alternativeKeys) {
        try {
          offerJson = await redis.get(altKey);
          if (offerJson) {
            console.log(`[ATTENDEE] Found offer at alternative key: ${altKey}`);
            break;
          }
        } catch (error) {
          console.error(`[ATTENDEE] Error checking alternative key ${altKey}:`, error);
        }
      }
    }

    if (!offerJson) {
      return NextResponse.json({
        error: "Offer not found",
        message: "The guide may not have started broadcasting yet",
        streamReady: false
      }, { status: 404 });
    }

    // Parse and validate the offer
    try {
      offer = JSON.parse(offerJson);
      console.log(`[ATTENDEE] Parsed offer type: ${typeof offer}`);

      // Check if it's a placeholder
      if (isPlaceholderOffer(offer)) {
        console.log(`[ATTENDEE] Found placeholder offer for ${displayLanguage}`);
        return NextResponse.json({
          tourId,
          placeholder: true,
          streamReady: false,  // Guide's stream is not ready yet
          message: "Guide has not started broadcasting yet"
        });
      }

      // Validate the SDP offer
      const validation = validateSdpOffer(offer);
      if (!validation.isValid) {
        console.error(`[ATTENDEE] Invalid SDP offer: ${validation.error}`);
        return NextResponse.json({
          error: `Invalid SDP offer: ${validation.error}`,
          tourId,
          placeholder: true,
          streamReady: false,
          message: "Guide's broadcast is not properly configured"
        }, { status: 400 });
      }
    } catch (error) {
      console.error(`[ATTENDEE] Error parsing offer JSON:`, error);
      return NextResponse.json({
        error: "Invalid offer format",
        message: error instanceof Error ? error.message : String(error),
        tourId,
        placeholder: true,
        streamReady: false
      }, { status: 400 });
    }

    // Register the attendee if a name was provided
    if (attendeeName) {
      try {
        // Use normalizeLanguage=false since we've already normalized the language
        const attendeeKey = getLanguageAttendeesKey(tourId, language, false);
        console.log(`[ATTENDEE] Registering attendee ${attendeeName} at key: ${attendeeKey}`);

        // Add to the set of attendees for this language
        await redis.sadd(attendeeKey, attendeeName);

        // Set expiry on the attendee key if it doesn't exist
        const ttl = await redis.ttl(attendeeKey);
        if (ttl < 0) {
          await redis.expire(attendeeKey, 7200); // 2-hour expiry
        }

        console.log(`[ATTENDEE] Successfully registered attendee ${attendeeName}`);
      } catch (error) {
        console.error(`[ATTENDEE] Error registering attendee:`, error);
        // Continue despite registration error
      }
    }

    // Return the offer to the attendee
    return NextResponse.json({
      tourId,
      offer,
      placeholder: false,
      streamReady: true  // Indicate that the guide's stream is ready
    });
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
