import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

export async function POST(request: Request) {
  const { tourId, language, candidate } = await request.json();

  if (!tourId || !language || !candidate) {
    return NextResponse.json({ error: "Missing tour Code, language, or candidate" }, { status: 400 });
  }

  const redisClient = await getRedisClient();
  if (!redisClient) {
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }

  const redisChannel = `tour:${tourId}:${language}:ice-candidates`;

  try {
    await redisClient.publish(redisChannel, JSON.stringify(candidate));
    return NextResponse.json({ message: "ICE candidate published" }, { status: 200 });
  } catch (error) {
    console.error("Redis error:", error);
    return NextResponse.json({ error: "Failed to publish ICE candidate" }, { status: 500 });
  }
}
