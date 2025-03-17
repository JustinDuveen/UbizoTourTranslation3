import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tourCode = searchParams.get("tourCode");
  const language = searchParams.get("language");

  if (!tourCode || !language) {
    return NextResponse.json({ error: "Missing tourCode or language" }, { status: 400 });
  }

  const redisClient = await getRedisClient();
  if (!redisClient) {
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }

  const redisKey = `tour:${tourCode}:${language}`;

  try {
    const offer = await redisClient.get(redisKey);

    if (!offer) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }

    return NextResponse.json({ offer }, { status: 200 });
  } catch (error) {
    console.error("Redis error:", error);
    return NextResponse.json({ error: "Failed to retrieve offer from Redis" }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}
