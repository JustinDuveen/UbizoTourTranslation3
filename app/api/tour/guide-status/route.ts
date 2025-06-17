import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";

/**
 * Helper function to extract the user from the request cookies.
 */
function getUserFromHeaders() {
  const headersList = headers();
  const cookieHeader = headersList.get("cookie") || "";
  const token = cookieHeader
    .split("; ")
    .find((row) => row.startsWith("token="))
    ?.split("=")[1];
  return token ? verifyToken(token) : null;
}

/**
 * POST endpoint for guides to update their broadcasting status
 */
export async function POST(request: Request) {
  try {
    // Authenticate the guide
    const user = getUserFromHeaders();
    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const { tourId, language, status, timestamp } = body;
    
    if (!tourId || !language || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate status values
    const validStatuses = ['broadcasting', 'stopped', 'paused', 'error'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Validate the tour exists
    const tourExists = await redis.exists(`tour:${tourId}`);
    if (!tourExists) {
      return NextResponse.json({ error: "No active tour found" }, { status: 404 });
    }

    // Store guide status
    const statusKey = `tour:${tourId}:guide_status`;
    const statusData = {
      status,
      language,
      timestamp: timestamp || Date.now(),
      guideId: user.id
    };

    await redis.set(statusKey, JSON.stringify(statusData), 'EX', 3600); // Expire in 1 hour

    // Also store language-specific status
    const langStatusKey = `tour:${tourId}:guide_status:${language}`;
    await redis.set(langStatusKey, JSON.stringify(statusData), 'EX', 3600);

    console.log(`[GUIDE-STATUS] Updated status for tour ${tourId}, language ${language}: ${status}`);

    return NextResponse.json({ 
      message: "Guide status updated successfully",
      status: statusData
    }, { status: 200 });

  } catch (error) {
    console.error("Error updating guide status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to retrieve guide status
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    const language = searchParams.get("language");

    if (!tourId) {
      return NextResponse.json(
        { error: "Missing tourId parameter" },
        { status: 400 }
      );
    }

    const redis = await getRedisClient();

    // Get general guide status
    const statusKey = `tour:${tourId}:guide_status`;
    const statusJson = await redis.get(statusKey);

    let generalStatus = null;
    if (statusJson) {
      generalStatus = JSON.parse(statusJson);
    }

    // Get language-specific status if requested
    let languageStatus = null;
    if (language) {
      const langStatusKey = `tour:${tourId}:guide_status:${language}`;
      const langStatusJson = await redis.get(langStatusKey);
      if (langStatusJson) {
        languageStatus = JSON.parse(langStatusJson);
      }
    }

    return NextResponse.json({
      generalStatus,
      languageStatus,
      tourId,
      language
    }, { status: 200 });

  } catch (error) {
    console.error("Error retrieving guide status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
