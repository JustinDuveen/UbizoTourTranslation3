import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"

export async function POST(request: Request) {
  try {
    const headersList = headers()
    const token = headersList.get("cookie")?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    const user = token ? verifyToken(token) : null

    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get Redis client
    const redis = await getRedisClient()
    
    // Get the active tour ID for this guide
    const activeTourId = await redis.get(`guide:${user.id}:active_tour`)
    if (!activeTourId) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 })
    }

    // Get tour info
    const tourInfo = await redis.get(`tour:${activeTourId}`)
    if (!tourInfo) {
      return NextResponse.json({ error: "Tour info not found" }, { status: 404 })
    }

    // Update tour status to ended
    const updatedTourInfo = JSON.parse(tourInfo)
    updatedTourInfo.status = "ended"
    updatedTourInfo.endTime = new Date().toISOString()
    await redis.set(`tour:${activeTourId}`, JSON.stringify(updatedTourInfo))

    // Remove active tour reference
    await redis.del(`guide:${user.id}:active_tour`)

    return NextResponse.json({ 
      message: "Tour ended successfully",
      tourId: activeTourId
    })
  } catch (error) {
    console.error("Error ending tour:", error)
    return NextResponse.json({ 
      error: "Failed to end tour",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
