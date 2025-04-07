import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"
import { generateCode } from "@/lib/utils" // Import generateCode

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
    const { languages, primaryLanguage } = body

    if (!languages?.length || !primaryLanguage) {
      return NextResponse.json({ error: "Missing languages or primary language" }, { status: 400 })
    }

    // Normalize languages to lowercase
    const normalizedLanguages = languages.map((lang: string) => lang.toLowerCase())
    const normalizedPrimaryLang = primaryLanguage.toLowerCase()

    // Validate primary language is in selected languages
    if (!normalizedLanguages.includes(normalizedPrimaryLang)) {
      return NextResponse.json({ 
        error: "Primary language must be one of the selected languages" 
      }, { status: 400 })
    }

    // Store supported languages
    await redis.sAdd(`tour:${tourId}:supported_languages`, ...normalizedLanguages);

    // Store primary language
    await redis.set(`tour:${tourId}:primary_language`, normalizedPrimaryLang);

    // Store tour info in Redis
    await redis.set(`tour:${tourId}`, JSON.stringify({
      guideId: user.id,
      startTime: new Date().toISOString(),
      status: "active",
      primaryLanguage: normalizedPrimaryLang,
      languages: normalizedLanguages
    }))

    // Initialize offers for all selected languages
    await Promise.all(normalizedLanguages.map(async (lang: string) => {
      await redis.set(`tour:${tourId}:offer:${lang}`, JSON.stringify({
        offer: `Initialized offer for ${lang}`,
        status: 'pending'
      }))
    }))
    
    // Store tour ID in guide's active tours
    await redis.set(`guide:${user.id}:active_tour`, tourId);

    // Store the tourCode to tourId mapping
    await redis.set(`tour_codes:${tourCode}`, tourId);

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
