import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

async function validateTour(redisClient: any, tourId: string): Promise<boolean> {
  console.log(`Validating tour ${tourId}...`);

  // Check if tour exists
  const tourExists = await redisClient.exists(`tour:${tourId}`);
  console.log(`Tour ${tourId} exists: ${tourExists}`);
  if (!tourExists) return false;

  try {
    // Get tour info from the main tour key
    const tourInfoJson = await redisClient.get(`tour:${tourId}`);
    console.log(`Tour info retrieved: ${!!tourInfoJson}`);

    if (!tourInfoJson) {
      console.log(`No tour info found for ${tourId}`);
      return false;
    }

    // Parse tour info and check status
    const tourInfo = JSON.parse(tourInfoJson);
    console.log(`Tour status: ${tourInfo.status}`);

    // Check if tour is active
    return tourInfo.status === "active";
  } catch (error) {
    console.error(`Error validating tour ${tourId}:`, error);
    return false;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tourCode = searchParams.get("tourCode");
  const languageParam = searchParams.get("language");
  const language = languageParam ? languageParam.toLowerCase() : null;

  console.log(`Join request received - tourCode: ${tourCode}, language: ${languageParam}`);

  if (!tourCode || !language) {
    console.log(`Missing parameters - tourCode: ${tourCode}, language: ${languageParam}`);
    return NextResponse.json(
      {
        error: "Missing tourCode or language",
        received: { tourCode, languageParam }
      },
      { status: 400 }
    );
  }

  const redisClient = await getRedisClient();
  if (!redisClient) {
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }

  try {
    console.log(`Getting Redis client for join request`);

    // Get and validate tourId
    console.log(`Looking up tourId for code: ${tourCode}`);
    const tourId = await redisClient.get(`tour_codes:${tourCode}`);
    console.log(`TourId lookup result: ${tourId}`);

    if (!tourId) {
      console.log(`No tourId found for code: ${tourCode}`);
      return NextResponse.json({
        error: "Invalid tour code",
        providedTourCode: tourCode
      }, { status: 404 });
    }

    // Validate tour is active
    console.log(`Validating tour: ${tourId}`);
    const isValid = await validateTour(redisClient, tourId);
    console.log(`Tour validation result: ${isValid}`);

    if (!isValid) {
      console.log(`Tour is not active: ${tourId}`);

      // Get additional tour info for debugging
      try {
        const tourInfoJson = await redisClient.get(`tour:${tourId}`);
        if (tourInfoJson) {
          const tourInfo = JSON.parse(tourInfoJson);
          console.log(`Tour details - ID: ${tourId}, Status: ${tourInfo.status}, Start time: ${tourInfo.startTime}`);

          return NextResponse.json({
            error: "Inactive tour",
            providedTourCode: tourCode,
            tourId: tourId,
            status: tourInfo.status,
            startTime: tourInfo.startTime
          }, { status: 404 });
        }
      } catch (e) {
        console.error(`Error getting additional tour info: ${e}`);
      }

      return NextResponse.json({
        error: "Inactive tour",
        providedTourCode: tourCode,
        tourId: tourId
      }, { status: 404 });
    }

    // Validate language support
    console.log(`Checking if language ${language} is supported for tour ${tourId}`);
    const isSupported = await redisClient.sIsMember(
      `tour:${tourId}:supported_languages`,
      language
    );
    console.log(`Language support check result: ${isSupported}`);

    if (!isSupported) {
      console.log(`Language ${language} not supported for tour ${tourId}`);
      const supportedLangs = await redisClient.smembers(`tour:${tourId}:supported_languages`);
      console.log(`Supported languages: ${JSON.stringify(supportedLangs)}`);
      return NextResponse.json(
        {
          error: "Language not supported",
          supportedLanguages: supportedLangs,
          requestedLanguage: language
        },
        { status: 400 }
      );
    }

    // Get WebRTC offer for this language
    console.log(`[ATTENDEE] Getting offer for tour ${tourId}, language ${language}`);
    const offerKey = `tour:${tourId}:offer:${language}`;
    console.log(`[ATTENDEE] Using Redis key: ${offerKey}`);

    // List all keys matching the pattern to debug
    const allKeys = await redisClient.keys(`tour:${tourId}:offer:*`);
    console.log(`[ATTENDEE] All offer keys for this tour: ${JSON.stringify(allKeys)}`);

    const offerJson = await redisClient.get(offerKey);
    console.log(`[ATTENDEE] Offer found: ${!!offerJson}`);

    if (!offerJson) {
      console.log(`No offer available for tour ${tourId}, language ${language}`);
      return NextResponse.json({
        tourId,
        offer: null,
        streamReady: false,
        error: "No WebRTC offer available yet"
      }, { status: 200 });
    }

    try {
      // Debug: Log the raw offer JSON
      console.log(`[ATTENDEE] Raw offer JSON from Redis: ${offerJson.substring(0, 200)}${offerJson.length > 200 ? '...' : ''}`);

      // Parse the offer JSON
      let parsedOffer = JSON.parse(offerJson);
      console.log(`[ATTENDEE] Offer parsed successfully, type: ${typeof parsedOffer}`);

      // Debug: Log more details about the parsed offer
      if (typeof parsedOffer === 'object') {
        console.log(`[ATTENDEE] Parsed offer keys: ${Object.keys(parsedOffer).join(', ')}`);

        // Enhanced check for placeholder offers
        const isPlaceholder =
          (parsedOffer.status === 'pending') ||
          (parsedOffer.offer && typeof parsedOffer.offer === 'string' &&
           parsedOffer.offer.includes('Initialized offer for')) ||
          // Check if it's missing valid SDP content
          (parsedOffer.sdp && typeof parsedOffer.sdp === 'string' &&
           !parsedOffer.sdp.includes('v='));

        if (isPlaceholder) {
          console.log(`[ATTENDEE] Detected placeholder offer: ${JSON.stringify(parsedOffer).substring(0, 100)}...`);

          // Try to poll for the real offer with exponential backoff
          console.log(`[ATTENDEE] Will attempt to poll for the real offer...`);
          let attempts = 0;
          const maxAttempts = 8; // Increased from 5
          let pollInterval = 500; // Start with 500ms
          const maxPollInterval = 3000; // Cap at 3 seconds
          const backoffFactor = 1.5; // Exponential backoff factor

          while (attempts < maxAttempts) {
            attempts++;
            console.log(`[ATTENDEE] Polling attempt ${attempts}/${maxAttempts} for real offer (interval: ${pollInterval}ms)...`);

            // Wait before trying again with current interval
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            // Increase interval for next attempt (with exponential backoff)
            pollInterval = Math.min(pollInterval * backoffFactor, maxPollInterval);

            // Try to get the offer again
            const freshOfferJson = await redisClient.get(offerKey);
            if (!freshOfferJson) {
              console.log(`[ATTENDEE] Still no offer available after polling`);
              continue;
            }

            try {
              const freshOffer = JSON.parse(freshOfferJson);
              console.log(`[ATTENDEE] Fresh offer type: ${typeof freshOffer}`);

              // Enhanced check for placeholder in fresh offer
              const isFreshPlaceholder =
                (freshOffer.status === 'pending') ||
                (freshOffer.offer && typeof freshOffer.offer === 'string' &&
                 freshOffer.offer.includes('Initialized offer for')) ||
                (freshOffer.sdp && typeof freshOffer.sdp === 'string' &&
                 !freshOffer.sdp.includes('v='));

              if (isFreshPlaceholder) {
                console.log(`[ATTENDEE] Still a placeholder offer after polling attempt ${attempts}`);
                continue;
              }

              // Check if it has valid SDP
              if (freshOffer.sdp && typeof freshOffer.sdp === 'string' && freshOffer.sdp.includes('v=')) {
                console.log(`[ATTENDEE] Found valid offer after polling!`);
                parsedOffer = freshOffer;
                break;
              } else {
                console.log(`[ATTENDEE] Found non-placeholder offer but SDP is invalid`);
              }
            } catch (e) {
              console.error(`[ATTENDEE] Error parsing fresh offer:`, e);
            }
          }

          if (attempts >= maxAttempts) {
            console.log(`[ATTENDEE] Failed to get valid offer after ${maxAttempts} attempts`);
            // Return a specific response for placeholder offers
            return NextResponse.json({
              tourId,
              offer: {
                type: 'answer',
                sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Placeholder\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\nc=IN IP4 0.0.0.0\r\na=inactive\r\n"
              },
              streamReady: false,
              placeholder: true,
              message: "Guide has not started broadcasting yet. Please try again later."
            }, { status: 200 });
          }
        }

        if (parsedOffer.sdp) {
          console.log(`[ATTENDEE] SDP content starts with: ${parsedOffer.sdp.substring(0, 50)}...`);
          console.log(`[ATTENDEE] SDP includes 'v=' marker: ${parsedOffer.sdp.includes('v=')}`);
        }
      }

      // Ensure the offer is in the correct format for WebRTC
      let formattedOffer;

      // If it's already a proper RTCSessionDescription object
      if (parsedOffer && typeof parsedOffer === 'object' && parsedOffer.type && parsedOffer.sdp) {
        console.log(`Offer already in correct format with type: ${parsedOffer.type}`);

        // Debug: Validate SDP content more thoroughly
        if (typeof parsedOffer.sdp === 'string') {
          if (parsedOffer.sdp.includes('v=')) {
            console.log(`SDP content appears valid, contains v= marker`);
            formattedOffer = parsedOffer;
          } else {
            console.log(`SDP content missing v= marker, attempting to fix...`);
            // Try to extract a valid SDP if it's embedded somewhere
            const potentialSdp = parsedOffer.sdp.match(/v=0[\s\S]*m=audio/g);
            if (potentialSdp) {
              console.log(`Found potential valid SDP content within the invalid one`);
              formattedOffer = {
                type: parsedOffer.type,
                sdp: potentialSdp[0]
              };
            } else {
              console.log(`Could not find valid SDP content, using as-is but may fail`);
              formattedOffer = parsedOffer;
            }
          }
        } else {
          console.log(`SDP property is not a string: ${typeof parsedOffer.sdp}`);
          formattedOffer = parsedOffer;
        }
      }
      // If it's just an SDP string
      else if (typeof parsedOffer === 'string' && parsedOffer.includes('v=0')) {
        console.log(`Converting raw SDP string to proper format`);
        formattedOffer = {
          type: 'answer',
          sdp: parsedOffer
        };
      }
      // If it's something else, try to make it work
      else {
        console.log(`Offer in unexpected format, attempting to convert`);
        const offerStr = typeof parsedOffer === 'string' ? parsedOffer : JSON.stringify(parsedOffer);
        console.log(`Converted offer string starts with: ${offerStr.substring(0, 50)}...`);
        formattedOffer = {
          type: 'answer',
          sdp: offerStr
        };
      }

      const response = {
        tourId,
        offer: formattedOffer,
        streamReady: true
      };
      console.log(`Returning join response with tourId: ${tourId}, streamReady: true, offer type: ${formattedOffer.type}`);
      return NextResponse.json(response, { status: 200 });
    } catch (error) {
      console.error(`Error formatting offer: ${error.message}`);
      return NextResponse.json({
        tourId,
        error: "Invalid WebRTC offer format",
        details: error.message,
        streamReady: false
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Error in join request:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`Error message: ${errorMessage}`);
    return NextResponse.json({
      error: "Failed to process join request",
      message: errorMessage,
      tourCode: tourCode,
      language: language
    }, { status: 500 });
  }
}
