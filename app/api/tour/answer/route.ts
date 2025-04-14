import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";
import { normalizeLanguageForStorage } from "@/lib/languageUtils";

// Handle requests for tour answers

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const languageParam = searchParams.get("language");
    const language = languageParam ? normalizeLanguageForStorage(languageParam) : null;

    if (!tourId || !language) {
      return NextResponse.json(
        { error: "Missing tourId or language" },
        { status: 400 }
      );
    }

    const redisClient = await getRedisClient();
    const answers = await redisClient.lRange(`tour:${tourId}:${language}:answers`, 0, -1);

    return NextResponse.json({ answers });
  } catch (error) {
    console.error("GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const languageParam = searchParams.get("language");
    const language = languageParam ? normalizeLanguageForStorage(languageParam) : null;
    const body = await request.json(); // Extract the request body

    if (!tourId || !language) {
      return NextResponse.json(
        { error: "Missing tourId or language" },
        { status: 400 }
      );
    }

    if (!body || !body.answer) {
      return NextResponse.json({ error: "Missing answer in body" }, {status: 400});
    }

    const answer = body.answer;
    console.log(`Storing answer for tourId: ${tourId}, language: ${language}`);

    const redisClient = await getRedisClient();
    await redisClient.rPush(`tour:${tourId}:${language}:answers`, JSON.stringify(answer));
    console.log(`Answer stored successfully in Redis for tourId: ${tourId}, language: ${language}`);

    return NextResponse.json({ message: "Answer added successfully" });
  } catch (error) {
    console.error("POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}