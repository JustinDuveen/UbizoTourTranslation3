import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"
import { normalizeLanguageForStorage, formatLanguageForDisplay, getSupportedLanguagesKey, getOfferKey, getLanguageAttendeesKey, getPrimaryLanguageKey } from "@/lib/languageUtils"

interface LanguageRequest {
  tourId: string;
  language: string;
}

async function validateGuideAndTour(tourId: string) {
  const headersList = headers()
  const cookieHeader = headersList.get("cookie")
  const token = cookieHeader?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
  const user = token ? verifyToken(token) : null

  if (!user || user.role !== "guide") {
    throw new Error("Unauthorized")
  }

  const redis = await getRedisClient()
  const tourData = await redis.get(`tour:${tourId}`)

  if (!tourData) {
    throw new Error("Tour not found")
  }

  const tour = JSON.parse(tourData)
  if (tour.guideId !== user.id) {
    throw new Error("Unauthorized - not tour guide")
  }

  return { redis, tour }
}

export async function POST(request: Request) {
  try {
    const body: LanguageRequest = await request.json()
    const { tourId, language } = body

    if (!tourId || !language) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const normalizedLang = normalizeLanguageForStorage(language)
    const displayLang = formatLanguageForDisplay(language)
    const { redis, tour } = await validateGuideAndTour(tourId)

    // Check if language already supported
    const supportedLanguagesKey = getSupportedLanguagesKey(tourId)
    const isSupported = await redis.sIsMember(supportedLanguagesKey, normalizedLang)
    if (isSupported) {
      return NextResponse.json({ error: "Language already supported" }, { status: 400 })
    }

    // Add language to supported set
    await redis.sAdd(supportedLanguagesKey, normalizedLang)

    // Initialize offer for new language
    const offerKey = getOfferKey(tourId, normalizedLang)
    await redis.set(offerKey, JSON.stringify({
      offer: `Initialized offer for ${displayLang}`,
      status: 'pending'
    }))

    // Update tour info
    const updatedLanguages = [...tour.languages, normalizedLang]
    await redis.set(`tour:${tourId}`, JSON.stringify({
      ...tour,
      languages: updatedLanguages
    }))

    // Publish language added event
    await redis.publish(`tour:${tourId}:events`, JSON.stringify({
      type: 'language_added',
      language: normalizedLang,
      displayLanguage: displayLang,
      timestamp: new Date().toISOString()
    }))

    return NextResponse.json({
      message: "Language added successfully",
      language: normalizedLang,
      displayLanguage: displayLang
    })

  } catch (error) {
    console.error("Error adding language:", error)
    const status = error instanceof Error && error.message.includes("Unauthorized") ? 401 : 500
    return NextResponse.json({
      error: "Failed to add language",
      message: error instanceof Error ? error.message : String(error)
    }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const body: LanguageRequest = await request.json()
    const { tourId, language } = body

    if (!tourId || !language) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const normalizedLang = normalizeLanguageForStorage(language)
    const displayLang = formatLanguageForDisplay(language)
    const { redis, tour } = await validateGuideAndTour(tourId)

    // Check if language exists and is not primary
    const supportedLanguagesKey = getSupportedLanguagesKey(tourId)
    const isSupported = await redis.sIsMember(supportedLanguagesKey, normalizedLang)
    if (!isSupported) {
      return NextResponse.json({ error: "Language not found" }, { status: 404 })
    }

    const primaryLanguageKey = getPrimaryLanguageKey(tourId)
    const primaryLanguage = await redis.get(primaryLanguageKey)
    if (primaryLanguage === normalizedLang) {
      return NextResponse.json({
        error: "Cannot remove primary language"
      }, { status: 400 })
    }

    // Remove language from supported set
    await redis.sRem(supportedLanguagesKey, normalizedLang)

    // Remove language offer
    const offerKey = getOfferKey(tourId, normalizedLang)
    await redis.del(offerKey)

    // Update tour info
    const updatedLanguages = tour.languages.filter((lang: string) => lang !== normalizedLang)
    await redis.set(`tour:${tourId}`, JSON.stringify({
      ...tour,
      languages: updatedLanguages
    }))

    // Get attendees using this language
    const languageAttendeesKey = getLanguageAttendeesKey(tourId, normalizedLang)
    const attendees = await redis.sMembers(languageAttendeesKey)

    // Publish language removed event
    await redis.publish(`tour:${tourId}:events`, JSON.stringify({
      type: 'language_removed',
      language: normalizedLang,
      displayLanguage: displayLang,
      affectedAttendees: attendees,
      timestamp: new Date().toISOString()
    }))

    // Clean up attendee associations
    if (attendees.length > 0) {
      await redis.del(languageAttendeesKey)
    }

    return NextResponse.json({
      message: "Language removed successfully",
      language: normalizedLang,
      displayLanguage: displayLang,
      affectedAttendees: attendees
    })

  } catch (error) {
    console.error("Error removing language:", error)
    const status = error instanceof Error && error.message.includes("Unauthorized") ? 401 : 500
    return NextResponse.json({
      error: "Failed to remove language",
      message: error instanceof Error ? error.message : String(error)
    }, { status })
  }
}

// Get supported languages for a tour
export async function GET(request: Request) {
  try {
    // Authenticate the attendee
    const headersList = headers()
    const cookieHeader = headersList.get("cookie")
    console.log("Cookie header in languages endpoint:", cookieHeader)

    const token = cookieHeader?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    console.log("Token extracted:", token ? "Present" : "Not present")

    const user = token ? verifyToken(token) : null
    console.log("User after verification:", user)

    // Allow both attendees and guides to fetch languages
    if (!user || !['attendee', 'guide'].includes(user.role)) {
      console.log("Unauthorized: User is not an attendee or guide", user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const tourCode = searchParams.get("tourCode")
    console.log("Tour code from query params:", tourCode)

    if (!tourCode) {
      return NextResponse.json({ error: "Missing tourCode" }, { status: 400 })
    }

    // Ensure tour code is uppercase for Redis key consistency
    const uppercaseTourCode = tourCode.toUpperCase()
    console.log("Normalized tour code for Redis lookup:", uppercaseTourCode)

    console.log("Getting Redis client")
    const redis = await getRedisClient()
    console.log("Redis client obtained")

    // Get tourId from tourCode
    console.log(`Looking up tour ID for code: ${uppercaseTourCode}`)
    const tourId = await redis.get(`tour_codes:${uppercaseTourCode}`)
    console.log(`Tour ID result: ${tourId}`)

    if (!tourId) {
      console.log(`No tour ID found for code: ${uppercaseTourCode}`)
      return NextResponse.json({ error: "Invalid tour code" }, { status: 404 })
    }

    // Get supported languages
    console.log(`Getting supported languages for tour: ${tourId}`)
    const supportedLanguagesKey = getSupportedLanguagesKey(tourId)
    const languages = await redis.sMembers(supportedLanguagesKey)
    console.log(`Supported languages from Redis set: ${JSON.stringify(languages)}`)

    // Log the Redis key for debugging
    console.log(`Redis key for supported languages: ${supportedLanguagesKey}`)

    // If no languages found, check if there's an issue with the Redis set
    if (!languages || languages.length === 0) {
      console.log("No languages found in Redis set, checking tour info directly")
      const tourInfo = await redis.get(`tour:${tourId}`)
      console.log(`Tour info: ${tourInfo}`)

      if (tourInfo) {
        try {
          const parsedTourInfo = JSON.parse(tourInfo)
          console.log(`Parsed tour info languages: ${JSON.stringify(parsedTourInfo.languages)}`)

          // If languages exist in tour info but not in the set, add them to the set
          if (parsedTourInfo.languages && parsedTourInfo.languages.length > 0) {
            console.log(`Adding missing languages to set: ${JSON.stringify(parsedTourInfo.languages)}`)
            console.log(`Adding languages to set using spread syntax: ${JSON.stringify(parsedTourInfo.languages)}`)
            // Use spread syntax to ensure each language is added as a separate element
            await redis.sAdd(`tour:${tourId}:supported_languages`, ...parsedTourInfo.languages)

            // Get the updated languages
            const updatedLanguages = await redis.sMembers(`tour:${tourId}:supported_languages`)
            console.log(`Updated supported languages: ${JSON.stringify(updatedLanguages)}`)
            // Replace the languages array with the updated one
            languages.length = 0; // Clear the array
            languages.push(...updatedLanguages); // Add the new languages
          }
        } catch (error) {
          console.error("Error parsing tour info:", error)
        }
      }
    }

    // Get primary language
    console.log(`Getting primary language for tour: ${tourId}`)
    const primaryLanguageKey = getPrimaryLanguageKey(tourId)
    const primaryLanguage = await redis.get(primaryLanguageKey)
    console.log(`Primary language: ${primaryLanguage}`)

    // Get attendee counts per language
    console.log("Getting attendee counts per language")
    const attendeeCounts = await Promise.all(
      languages.map(async (lang: string) => {
        const languageAttendeesKey = getLanguageAttendeesKey(tourId, lang)
        const count = await redis.sCard(languageAttendeesKey)
        return {
          language: lang,
          displayLanguage: formatLanguageForDisplay(lang),
          attendeeCount: count
        }
      })
    )
    console.log(`Attendee counts: ${JSON.stringify(attendeeCounts)}`)

    // Format languages for display
    const displayLanguages = languages.map(lang => ({
      code: lang,
      display: formatLanguageForDisplay(lang)
    }))

    const response = {
      languages,
      displayLanguages,
      primaryLanguage,
      primaryDisplayLanguage: primaryLanguage ? formatLanguageForDisplay(primaryLanguage) : null,
      attendeeCounts
    };
    console.log(`Returning response: ${JSON.stringify(response)}`)
    return NextResponse.json(response)

  } catch (error) {
    console.error("Error fetching languages:", error)
    return NextResponse.json({
      error: "Failed to fetch languages",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
