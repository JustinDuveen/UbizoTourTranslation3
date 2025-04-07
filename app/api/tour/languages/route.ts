import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"

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

    const normalizedLang = language.toLowerCase()
    const { redis, tour } = await validateGuideAndTour(tourId)

    // Check if language already supported
    const isSupported = await redis.sIsMember(`tour:${tourId}:supported_languages`, normalizedLang)
    if (isSupported) {
      return NextResponse.json({ error: "Language already supported" }, { status: 400 })
    }

    // Add language to supported set
    await redis.sAdd(`tour:${tourId}:supported_languages`, normalizedLang)

    // Initialize offer for new language
    await redis.set(`tour:${tourId}:offer:${normalizedLang}`, JSON.stringify({
      offer: `Initialized offer for ${normalizedLang}`,
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
      timestamp: new Date().toISOString()
    }))

    return NextResponse.json({ 
      message: "Language added successfully",
      language: normalizedLang
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

    const normalizedLang = language.toLowerCase()
    const { redis, tour } = await validateGuideAndTour(tourId)

    // Check if language exists and is not primary
    const isSupported = await redis.sIsMember(`tour:${tourId}:supported_languages`, normalizedLang)
    if (!isSupported) {
      return NextResponse.json({ error: "Language not found" }, { status: 404 })
    }

    if (tour.primaryLanguage === normalizedLang) {
      return NextResponse.json({ 
        error: "Cannot remove primary language" 
      }, { status: 400 })
    }

    // Remove language from supported set
    await redis.sRem(`tour:${tourId}:supported_languages`, normalizedLang)

    // Remove language offer
    await redis.del(`tour:${tourId}:offer:${normalizedLang}`)

    // Update tour info
    const updatedLanguages = tour.languages.filter((lang: string) => lang !== normalizedLang)
    await redis.set(`tour:${tourId}`, JSON.stringify({
      ...tour,
      languages: updatedLanguages
    }))

    // Get attendees using this language
    const attendees = await redis.sMembers(`tour:${tourId}:language:${normalizedLang}:attendees`)

    // Publish language removed event
    await redis.publish(`tour:${tourId}:events`, JSON.stringify({
      type: 'language_removed',
      language: normalizedLang,
      affectedAttendees: attendees,
      timestamp: new Date().toISOString()
    }))

    // Clean up attendee associations
    if (attendees.length > 0) {
      await redis.del(`tour:${tourId}:language:${normalizedLang}:attendees`)
    }

    return NextResponse.json({ 
      message: "Language removed successfully",
      language: normalizedLang,
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
    const token = cookieHeader?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    const user = token ? verifyToken(token) : null

    // Allow both attendees and guides to fetch languages
    if (!user || !['attendee', 'guide'].includes(user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const tourCode = searchParams.get("tourCode")

    if (!tourCode) {
      return NextResponse.json({ error: "Missing tourCode" }, { status: 400 })
    }

    const redis = await getRedisClient()

    // Get tourId from tourCode
    const tourId = await redis.get(`tour_codes:${tourCode}`)
    if (!tourId) {
      return NextResponse.json({ error: "Invalid tour code" }, { status: 404 })
    }
    
    // Get supported languages
    const languages = await redis.sMembers(`tour:${tourId}:supported_languages`)
    
    // Get primary language
    const primaryLanguage = await redis.get(`tour:${tourId}:primary_language`)

    // Get attendee counts per language
    const attendeeCounts = await Promise.all(
      languages.map(async (lang: string) => {
        const count = await redis.sCard(`tour:${tourId}:language:${lang}:attendees`)
        return { language: lang, attendeeCount: count }
      })
    )

    return NextResponse.json({
      languages,
      primaryLanguage,
      attendeeCounts
    })

  } catch (error) {
    console.error("Error fetching languages:", error)
    return NextResponse.json({ 
      error: "Failed to fetch languages",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
