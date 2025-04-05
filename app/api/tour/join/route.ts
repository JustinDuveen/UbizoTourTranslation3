  import { NextResponse } from "next/server";
  import { getRedisClient } from "@/lib/redis";
  
  export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const tourCode = searchParams.get("tourCode");
    const languageParam = searchParams.get("language");
    const language = languageParam ? languageParam.toLowerCase() : null;
  
    if (!tourCode || !language) {
      return NextResponse.json(
        { 
          error: "Missing tourCode or language",
          received: { tourCode, languageParam } // Add debugging info
        }, 
        { status: 400 }
      );
    }
  
    const redisClient = await getRedisClient();
    if (!redisClient) {
      return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
    }
  
    try {
      // Get the tourId from the tourCode
      console.log(`Attempting to retrieve tourId for tourCode: ${tourCode}`);
      const tourId = await redisClient.get(`tour_codes:${tourCode}`);
      console.log(`tourId retrieved: ${tourId}`);
      if (!tourId) {
        console.log(`Invalid tour code: ${tourCode}`);
        return NextResponse.json({ error: "Invalid tour code", providedTourCode: tourCode }, { status: 404 });
      }
  
      // ===== NEW LANGUAGE VALIDATION =====
      // Check if requested language is supported
      const isSupported = await redisClient.sIsMember(
        `tour:${tourId}:supported_languages`,
        language
      );
      
      if (!isSupported) {
        // Get list of supported languages for error message
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
