import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"

export async function GET() {
  try {
    // Verify authentication
    const headersList = headers()
    const token = headersList.get("cookie")?.split("; ").find(row => row.startsWith("token="))?.split("=")[1]
    const user = token ? verifyToken(token) : null

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get Redis client (will use mock if Redis is unavailable)
    const redis = await getRedisClient()
    
    // Check if we have a cached session
    const cachedSession = await redis.get("openai_session")
    if (cachedSession) {
      console.log("Using cached OpenAI session")
      return NextResponse.json(JSON.parse(cachedSession))
    }
    
    // If no cached session, create a new one
    console.log("Creating new OpenAI session")
    console.log("OPENAI_API_KEY from env:", process.env.OPENAI_API_KEY);
    const apiKey = process.env.OPENAI_API_KEY;
    console.log("Extracted OPENAI_API_KEY:", apiKey ? "Yes" : "No");

    const apiUrl = "https://api.openai.com/v1/realtime/sessions";
    const apiHeaders = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    };
    const apiBody = JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
    });

    console.log("OpenAI API request:", apiUrl);
    console.log("OpenAI API headers:", apiHeaders);
    console.log("OpenAI API body:", apiBody);


    const response = await fetch(apiUrl, {
      method: "POST",
      headers: apiHeaders,
      body: apiBody,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API request failed: ${response.status} ${response.statusText}`, errorText)
      throw new Error(`API request failed: ${response.statusText}`)
    }

    const data = await response.json()
    
    // Cache the session for future use (with 55 second expiry to ensure we don't use expired keys)
    // OpenAI requires ephemeral keys to expire after 1 minute
    await redis.set("openai_session", JSON.stringify(data), { EX: 55 })
    
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error generating ephemeral key:", error)
    return NextResponse.json({ 
      error: "Error generating ephemeral key",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
