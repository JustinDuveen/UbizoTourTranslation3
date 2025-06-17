import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";
import { normalizeLanguageForStorage } from "@/lib/redisKeys";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tourId = searchParams.get('tourId');
  const language = searchParams.get('language');

  if (!tourId || !language) {
    return NextResponse.json(
      { error: "Missing tourId or language" },
      { status: 400 }
    );
  }

  try {
    const redisClient = await getRedisClient();
    // CRITICAL FIX: Use standardized language normalization instead of hardcoded toLowerCase()
    const normalizedLanguage = normalizeLanguageForStorage(language);
    const offerKey = `tour:${tourId}:offer:${normalizedLanguage}`;
    console.log(`[STORED-OFFER] Using normalized language "${normalizedLanguage}" for key: ${offerKey}`);
    const storedOfferJson = await redisClient.get(offerKey);

    if (!storedOfferJson) {
      return NextResponse.json(
        { error: "No stored offer found" },
        { status: 404 }
      );
    }

    const storedOffer = JSON.parse(storedOfferJson);
    console.log(`Retrieved stored offer for tourId: ${tourId}, language: ${language}`);

    return NextResponse.json({ offer: storedOffer }, { status: 200 });
  } catch (error) {
    console.error(`Error retrieving stored offer for tourId: ${tourId}, language: ${language}:`, error);
    return NextResponse.json(
      { error: "Failed to retrieve stored offer" },
      { status: 500 }
    );
  }
}
