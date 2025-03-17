import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

// Handle POST requests for tour answers
export async function POST(request: Request) {
  const { tourId, language, answer } = await request.json();
  
  if (!tourId || !language || !answer) {
    return NextResponse.json({ error: "Missing tour Code, language, or answer" }, { status: 400 });
  }
  
  const redisClient = await getRedisClient();
  if (!redisClient) {
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }
  
  const redisChannel = `tour:${tourId}:${language}:answers`;
  
  try {
    await redisClient.publish(redisChannel, JSON.stringify(answer));
    return NextResponse.json({ message: "Answer published" }, { status: 200 });
  } catch (error) {
    console.error("Redis error:", error);
    return NextResponse.json({ error: "Failed to publish answer" }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}

// Add GET handler to provide better error messages and guidance
export async function GET(request: Request) {
  return NextResponse.json(
    { 
      error: "Method not allowed", 
      message: "This endpoint requires a POST request with tourId, language, and answer in the JSON body" 
    }, 
    { status: 405 }
  );
}