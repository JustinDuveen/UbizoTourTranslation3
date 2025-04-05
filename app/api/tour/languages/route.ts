// app/api/tour/languages/route.ts
import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

export async function POST(request: Request) {
  try {
    const { tourId, languages } = await request.json();
    const redis = await getRedisClient();
    
    // Store as both Set and String for flexibility
    await redis.sadd(`tour:${tourId}:languages`, ...languages);
    await redis.set(`tour:${tourId}:languages_list`, languages.join(','), 'EX', 3600);
    
    return NextResponse.json({ 
      success: true,
      message: "Language map stored successfully"
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to store language map" },
      { status: 500 }
    );
  }
}