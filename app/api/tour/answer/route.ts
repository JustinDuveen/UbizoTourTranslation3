import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

// Handle requests for tour answers

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const language = searchParams.get("language");

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
    const language = searchParams.get("language");
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

    const redisClient = await getRedisClient();
    await redisClient.rPush(`tour:${tourId}:${language}:answers`, answer);

    return NextResponse.json({ message: "Answer added successfully" });
  } catch (error) {
    console.error("POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}