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

    // Get the language and tourId from query parameters
    const { searchParams } = new URL(request.url)
    const language = searchParams.get("language")
    const tourId = searchParams.get("tourId")
    
    if (!language || !tourId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // Get Redis client
    const redis = await getRedisClient()
    
    // Get ICE candidates using the correct tourId
    const iceCandidatesJson = await redis.lrange(
      `tour:${tourId}:ice:guide:${language}`,
      0,
      -1
    )
    
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
