import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getRedisClient } from "@/lib/redis";

// Helper to create SSE message
function createSSEMessage(data: any) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  try {
    // Authenticate the guide
    const headersList = headers();
    const cookieHeader = headersList.get("cookie") || "";
    const token = cookieHeader
      .split("; ")
      .find((row) => row.startsWith("token="))
      ?.split("=")[1];
    const user = token ? verifyToken(token) : null;

    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get tourId from query params
    const { searchParams } = new URL(request.url);
    const tourId = searchParams.get("tourId");
    if (!tourId) {
      return NextResponse.json({ error: "Missing tourId" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Verify tour exists and belongs to this guide
    const tourData = await redis.get(`tour:${tourId}`);
    if (!tourData) {
      return NextResponse.json({ error: "Tour not found" }, { status: 404 });
    }

    const tour = JSON.parse(tourData);
    if (tour.guideId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create SSE stream
    let subscriber: any = null;
    const stream = new ReadableStream({
      async start(controller) {
        // Subscribe to tour events
        subscriber = await getRedisClient();

        // Set up message listener
        subscriber.on('message', (channel: string, message: string) => {
          if (channel === `tour:${tourId}:events`) {
            try {
              const event = JSON.parse(message);
              controller.enqueue(createSSEMessage(event));
            } catch (error) {
              console.error('Error processing event:', error);
            }
          }
        });

        // Subscribe to the channel
        await subscriber.subscribe(`tour:${tourId}:events`);

        // Send initial event
        controller.enqueue(createSSEMessage({ type: 'connected' }));
      },
      cancel() {
        // Cleanup subscription
        if (subscriber) {
          subscriber.unsubscribe(`tour:${tourId}:events`);
          subscriber.quit();
        }
      }
    });

    // Return SSE response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    console.error("Error setting up event stream:", error);
    return NextResponse.json(
      { error: "Failed to setup event stream" },
      { status: 500 }
    );
  }
}
