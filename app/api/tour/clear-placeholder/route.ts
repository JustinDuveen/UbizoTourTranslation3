// File: app/api/tour/clear-placeholder/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";
import { isPlaceholderOffer, getOfferKey, normalizeLanguageForStorage, formatLanguageForDisplay } from "@/lib/languageUtils";

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
 * POST endpoint for guides to clear placeholder offers.
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
    const { language, tourId } = body;
    if (!language || !tourId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Validate the tour exists
    const tourExists = await redis.exists(`tour:${tourId}`);
    if (!tourExists) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 });
    }

    // Normalize language and prepare keys
    const normalizedLanguage = normalizeLanguageForStorage(language);
    const displayLanguage = formatLanguageForDisplay(language);
    const offerKey = getOfferKey(tourId, normalizedLanguage);
    const langContext = `[GUIDE] [${displayLanguage}]`;

    console.log(`${langContext} Checking for placeholder offer at key: ${offerKey}`);

    const existingOffer = await redis.get(offerKey);
    if (!existingOffer) {
      console.log(`${langContext} No existing offer found at key: ${offerKey}`);
      return NextResponse.json({ message: "No offer to clear" });
    }

    try {
      const parsedOffer = JSON.parse(existingOffer);
      console.log(`${langContext} Existing offer type: ${typeof parsedOffer}`);

      // Use the utility function to check if it's a placeholder
      if (isPlaceholderOffer(parsedOffer)) {
        console.log(`${langContext} Found placeholder offer, clearing...`);

        // Delete the placeholder
        await redis.del(offerKey);
        console.log(`${langContext} Successfully deleted placeholder offer at key: ${offerKey}`);

        return NextResponse.json({
          message: "Placeholder offer cleared successfully",
          status: "cleared",
          language: displayLanguage,
          normalizedLanguage: normalizedLanguage
        });
      } else {
        console.log(`${langContext} Existing offer is not a placeholder`);
        if (parsedOffer.version) {
          console.log(`${langContext} Offer has version: ${parsedOffer.version}`);
        }
        if (parsedOffer.sdp) {
          console.log(`${langContext} SDP validation: ${parsedOffer.sdp.includes('v=') ? 'valid' : 'invalid'}`);
        }
        return NextResponse.json({
          message: "No placeholder offer found",
          status: "not_placeholder"
        });
      }
    } catch (error) {
      console.error(`${langContext} Error parsing existing offer:`, error);
      return NextResponse.json({
        error: "Failed to parse existing offer",
        message: error instanceof Error ? error.message : String(error)
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Error clearing placeholder offer:", error);
    return NextResponse.json(
      {
        error: "Failed to clear placeholder offer",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
