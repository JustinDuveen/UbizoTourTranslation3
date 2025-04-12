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
    const { language, candidate, tourId } = body

    if (!language || !candidate || !tourId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Get Redis client
    const redisClient = await getRedisClient()

    // Store the ICE candidate in Redis
    await redisClient.rPush(`tour:${tourId}:ice:attendee:${language}:${user.id}`, JSON.stringify(candidate))

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
    const redisClient = await getRedisClient()

    // Get the active tour ID for this guide
    const tourId = await redisClient.get(`guide:${user.id}:active_tour`)

    if (!tourId) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 })
    }

    // Get all ICE candidates for this attendee
    const iceCandidatesJson = await redisClient.lRange(`tour:${tourId}:ice:attendee:${language}:${attendeeId}`, 0, -1)

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
