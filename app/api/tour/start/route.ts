import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"
import { generateCode } from "@/lib/utils" // Import generateCode
import { normalizeLanguageForStorage, formatLanguageForDisplay, getOfferKey, getSupportedLanguagesKey, getPrimaryLanguageKey } from "@/lib/languageUtils"

export async function POST(request: Request) {
  try {
    const headersList = headers()
    const cookieHeader = headersList.get("cookie")
    console.log("Cookie header:", cookieHeader)

    const token = cookieHeader?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    console.log("Extracted token:", token ? "Present" : "Not present")

    const user = token ? verifyToken(token) : null
    console.log("Verified user:", user)

    if (!user || user.role !== "guide") {
      console.log("Unauthorized: User is not a guide or not authenticated")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get Redis client
    const redis = await getRedisClient()

    // Generate a unique tour ID
    const tourId = `tour_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`

    // Generate a 5-digit alphanumeric tour code
    const tourCode = generateCode()

    // Parse request body
    const body = await request.json()
    console.log("Request body:", body)
    const { languages, primaryLanguage } = body
    console.log("Received languages:", languages)
    console.log("Received primary language:", primaryLanguage)

    if (!languages?.length || !primaryLanguage) {
      console.log("Missing languages or primary language")
      return NextResponse.json({ error: "Missing languages or primary language" }, { status: 400 })
    }

    // Normalize languages using utility function
    const normalizedLanguages = languages.map((lang: string) => normalizeLanguageForStorage(lang))
    const normalizedPrimaryLang = normalizeLanguageForStorage(primaryLanguage)
    console.log("Normalized languages:", normalizedLanguages)
    console.log("Normalized primary language:", normalizedPrimaryLang)

    // Validate primary language is in selected languages
    if (!normalizedLanguages.includes(normalizedPrimaryLang)) {
      return NextResponse.json({
        error: "Primary language must be one of the selected languages"
      }, { status: 400 })
    }

    // Store supported languages
    const supportedLanguagesKey = getSupportedLanguagesKey(tourId)
    console.log(`Adding languages to set ${supportedLanguagesKey}:`, normalizedLanguages)
    try {
      // Add each language individually to ensure they're all added
      for (const lang of normalizedLanguages) {
        console.log(`Adding language to set: ${lang}`);
        await redis.sadd(supportedLanguagesKey, lang);
      }

      // Verify languages were added correctly
      const storedLanguages = await redis.smembers(supportedLanguagesKey);
      console.log(`Verified languages in Redis set:`, storedLanguages);

      // Check if all languages were added
      const allAdded = normalizedLanguages.every((lang: string) => storedLanguages.includes(lang));
      console.log(`All languages added successfully: ${allAdded}`);

      if (!allAdded) {
        console.log("Some languages were not added, retrying...");
        // Try again with the spread operator
        await redis.sadd(supportedLanguagesKey, ...normalizedLanguages);
        const retryStoredLanguages = await redis.smembers(supportedLanguagesKey);
        console.log(`After retry, languages in Redis set:`, retryStoredLanguages);
      }
    } catch (error) {
      console.error("Error adding languages to Redis set:", error);
      throw error;
    }

    // Store primary language
    const primaryLanguageKey = getPrimaryLanguageKey(tourId);
    console.log(`Setting primary language ${primaryLanguageKey} to ${normalizedPrimaryLang}`);
    await redis.set(primaryLanguageKey, normalizedPrimaryLang);

    // Store tour info in Redis using utility function  
    const { getTourKey } = await import("@/lib/redisKeys");
    const tourKey = getTourKey(tourId);
    await redis.set(tourKey, JSON.stringify({
      guideId: user.id,
      startTime: new Date().toISOString(),
      status: "active",
      primaryLanguage: normalizedPrimaryLang,
      languages: normalizedLanguages
    }))

    // Initialize placeholder offers for all selected languages
    console.log(`Initializing placeholder offers for all languages...`);
    await Promise.all(normalizedLanguages.map(async (lang: string) => {
      const placeholderKey = getOfferKey(tourId, lang);
      const displayLang = formatLanguageForDisplay(lang);
      const placeholderOffer = {
        offer: `Initialized offer for ${displayLang}`,
        status: 'pending',
        created: new Date().toISOString(),
        tourId: tourId,
        language: displayLang
      };

      console.log(`Setting placeholder offer for ${lang} at key: ${placeholderKey}`);
      await redis.set(placeholderKey, JSON.stringify(placeholderOffer));

      // Verify placeholder was stored
      const verifyPlaceholder = await redis.get(placeholderKey);
      console.log(`Verified placeholder for ${lang}: ${verifyPlaceholder ? 'Success' : 'Failed'}`);
    }))

    // Store tour ID in guide's active tours
    await redis.set(`guide:${user.id}:active_tour`, tourId);

    // Store the tourCode to tourId mapping using utility function
    const { getTourCodeKey } = await import("@/lib/redisKeys");
    const tourCodeKey = getTourCodeKey(tourCode);
    console.log(`Storing tour code mapping: ${tourCodeKey} -> ${tourId}`)
    await redis.set(tourCodeKey, tourId);

    // Verify the mapping was stored correctly
    const verifyTourId = await redis.get(tourCodeKey);
    console.log(`Verification of tour code mapping: ${verifyTourId === tourId ? 'Success' : 'Failed'}`);

    return NextResponse.json({
      message: "Tour started successfully",
      tourId,
      tourCode, // Include tourCode in the response
    });
  } catch (error) {
    console.error("Error starting tour:", error)
    return NextResponse.json({
      error: "Failed to start tour",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
