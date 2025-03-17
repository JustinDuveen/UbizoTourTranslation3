import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"

// GET endpoint for attendees to retrieve guide's ICE candidates
export async function GET(request: Request) {
  try {
    // Verify authentication
    const headersList = headers()
    const token = headersList.get("cookie")?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    const user = token ? verifyToken(token) : null

    if (!user || user.role !== "attendee") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get the language from query parameters
    const { searchParams } = new URL(request.url)
    const language = searchParams.get("language")

    if (!language) {
      return NextResponse.json({ error: "Missing language parameter" }, { status: 400 })
    }

    // Get Redis client
    const redis = await getRedisClient()
    
    // Find active tours with offers for this language
    const keys = await redis.keys("tour:*:offer:*")
    const offerKeys = keys.filter((key: string) => key.endsWith(`:${language}`))
    
    if (offerKeys.length === 0) {
      return NextResponse.json({ error: "No active tour found for this language" }, { status: 404 })
    }
    
    // Use the most recent offer (assuming the last one in the list)
    const offerKey = offerKeys[offerKeys.length - 1]
    
    // Extract the tour ID from the key
    const tourId = offerKey.split(":")[1]
    
    // Get all ICE candidates for this tour and language
    const iceCandidatesJson = await redis.lrange(`tour:${tourId}:ice:guide:${language}`, 0, -1)
    
    // Parse the candidates
    const candidates = iceCandidatesJson.map((json: string) => JSON.parse(json))
    
    return NextResponse.json({ candidates })
  } catch (error) {
    console.error("Error retrieving guide ICE candidates:", error)
    return NextResponse.json({ 
      error: "Failed to retrieve guide ICE candidates",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
