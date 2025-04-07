import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

async function validateTour(redisClient: any, tourId: string): Promise<boolean> {
  const tourExists = await redisClient.exists(`tour:${tourId}`);
  if (!tourExists) return false;
  
  const tourStatus = await redisClient.get(`tour:${tourId}:status`);
  return tourStatus === "active";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tourCode = searchParams.get("tourCode");
  const languageParam = searchParams.get("language");
  const language = languageParam ? languageParam.toLowerCase() : null;

  if (!tourCode || !language) {
    return NextResponse.json(
      { 
        error: "Missing tourCode or language",
        received: { tourCode, languageParam }
      }, 
      { status: 400 }
    );
  }

  const redisClient = await getRedisClient();
  if (!redisClient) {
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }

  try {
    // Get and validate tourId
    const tourId = await redisClient.get(`tour_codes:${tourCode}`);
    if (!tourId || !(await validateTour(redisClient, tourId))) {
      return NextResponse.json({ 
        error: "Invalid or inactive tour code", 
        providedTourCode: tourCode 
      }, { status: 404 });
    }

    // Validate language support
    const isSupported = await redisClient.sIsMember(
      `tour:${tourId}:supported_languages`,
      language
    );
    
    if (!isSupported) {
      const supportedLangs = await redisClient.smembers(`tour:${tourId}:supported_languages`);
      return NextResponse.json(
        { 
          error: "Language not supported",
          supportedLanguages: supportedLangs,
          requestedLanguage: language
        },
        { status: 400 }
      );
    }

    // Get WebRTC offer for this language
    const offerKey = `tour:${tourId}:offer:${language}`;
    const offerJson = await redisClient.get(offerKey);

    return NextResponse.json({ 
      tourId,
      offer: offerJson ? JSON.parse(offerJson) : null,
      streamReady: !!offerJson
    }, { status: 200 });
  } catch (error) {
    console.error("Redis error:", error);
    return NextResponse.json({ 
      error: "Failed to process join request",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
