import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"

// POST endpoint for attendees to store their ICE candidates
export async function POST(request: Request) {
  try {
    // Verify authentication
    const headersList = headers()
    const token = headersList.get("cookie")?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    const user = token ? verifyToken(token) : null

    if (!user || user.role !== "attendee") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Parse request body
    const body = await request.json()
    const { language, candidate } = body

    if (!language || !candidate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
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
    
    // Store the ICE candidate in Redis
    await redis.rpush(`tour:${tourId}:ice:attendee:${language}:${user.id}`, JSON.stringify(candidate))
    
    return NextResponse.json({ message: "Attendee ICE candidate stored successfully" })
  } catch (error) {
    console.error("Error storing attendee ICE candidate:", error)
    return NextResponse.json({ 
      error: "Failed to store attendee ICE candidate",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

// GET endpoint for guides to retrieve attendee ICE candidates
export async function GET(request: Request) {
  try {
    // Verify authentication
    const headersList = headers()
    const token = headersList.get("cookie")?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    const user = token ? verifyToken(token) : null

    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get the language and attendee ID from query parameters
    const { searchParams } = new URL(request.url)
    const language = searchParams.get("language")
    const attendeeId = searchParams.get("attendeeId")

    if (!language || !attendeeId) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // Get Redis client
    const redis = await getRedisClient()
    
    // Get the active tour ID for this guide
    const tourId = await redis.get(`guide:${user.id}:active_tour`)
    
    if (!tourId) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 })
    }
    
    // Get all ICE candidates for this attendee
    const iceCandidatesJson = await redis.lrange(`tour:${tourId}:ice:attendee:${language}:${attendeeId}`, 0, -1)
    
    // Parse the candidates
    const candidates = iceCandidatesJson.map((json: string) => JSON.parse(json))
    
    return NextResponse.json({ candidates })
  } catch (error) {
    console.error("Error retrieving attendee ICE candidates:", error)
    return NextResponse.json({ 
      error: "Failed to retrieve attendee ICE candidates",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
