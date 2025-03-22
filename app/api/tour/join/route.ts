import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tourCode = searchParams.get("tourCode");
  const languageParam = searchParams.get("language");
  const language = languageParam ? languageParam.toLowerCase() : null;

  if (!tourCode || !language) {
    return NextResponse.json({ error: "Missing tourCode or language" }, { status: 400 });
  }

  const redisClient = await getRedisClient();
  if (!redisClient) {
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }

  try {
    // First, get the tourId from the tourCode
    const tourId = await redisClient.get(`tour_codes:${tourCode}`);

    if (!tourId) {
      return NextResponse.json({ error: "Invalid tour code" }, { status: 404 });
    }

    // Now get the translated audio using the correct key format
  const translatedAudioJson = await redisClient.get(`tour:${tourId}:translated_audio:${language}`);
  let translatedAudio = null;
  if (translatedAudioJson) {
    translatedAudio = JSON.parse(translatedAudioJson);
  }

  // Return the tourId with indicator for translationStarted and the translatedAudio (which may be null if not available)
  return NextResponse.json({ 
    tourId,
    translationStarted: translatedAudio !== null,
    translatedAudio
  }, { status: 200 });
  } catch (error) {
    console.error("Redis error:", error);
    return NextResponse.json({ error: "Failed to retrieve offer from Redis" }, { status: 500 });
  }
}
