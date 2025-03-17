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
    const { language } = body

    if (!language) {
      return NextResponse.json({ error: "Missing language parameter" }, { status: 400 })
    }

    // Store tour info in Redis
    await redis.set(`tour:${tourId}`, JSON.stringify({
      guideId: user.id,
      startTime: new Date().toISOString(),
      status: "active",
      language: language // Store the language
    }))

    // Store tour code in Redis, linking it to tourId
    await redis.set(`tour_codes:${tourCode}`, tourId)

    // Store tour ID in guide's active tours (no change)
    await redis.set(`guide:${user.id}:active_tour`, tourId)

    return NextResponse.json({ 
      message: "Tour started successfully",
      tourId,
      tourCode // Include tourCode in the response
    })
  } catch (error) {
    console.error("Error starting tour:", error)
    return NextResponse.json({ 
      error: "Failed to start tour",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
