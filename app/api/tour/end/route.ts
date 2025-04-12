import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { verifyToken } from "@/lib/auth"
import { getRedisClient } from "@/lib/redis"
import { executeTourEndTransaction, validateActiveTour } from "@/lib/tourUtils"
import { AppError, createUnauthorizedError, createNotFoundError, handleError } from "@/lib/errorHandling"
import { MetricType, recordMetric, timeAsync } from "@/lib/monitoring"

export async function POST(request: Request) {
  const logPrefix = '[TOUR-END]';

  try {
    // Record metric for API request
    recordMetric(MetricType.API_REQUEST_ATTEMPT, 1, { endpoint: 'tour-end' });

    // Authenticate the guide
    const headersList = headers();
    const token = headersList.get("cookie")?.split("; ").find(row => row.startsWith("token="))?.split("=")[1];
    const user = token ? verifyToken(token) : null;

    console.log(`${logPrefix} Authentication attempt:`, user ? `User ID: ${user.id}, Role: ${user.role}` : 'No user');

    if (!user || user.role !== "guide") {
      recordMetric(MetricType.API_REQUEST_FAILURE, 1, { endpoint: 'tour-end', reason: 'unauthorized' });
      throw createUnauthorizedError('Only guides can end tours');
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Get the active tour ID for this guide
    const activeTourId = await redis.get(`guide:${user.id}:active_tour`);
    if (!activeTourId) {
      recordMetric(MetricType.API_REQUEST_FAILURE, 1, { endpoint: 'tour-end', reason: 'no_active_tour' });
      throw createNotFoundError('No active tour found for this guide');
    }

    console.log(`${logPrefix} Found active tour: ${activeTourId}`);

    // Validate that the tour is active
    const isActive = await validateActiveTour(activeTourId);
    if (!isActive) {
      recordMetric(MetricType.API_REQUEST_FAILURE, 1, { endpoint: 'tour-end', reason: 'tour_not_active' });
      throw createNotFoundError(`Tour ${activeTourId} is not active`);
    }

    // Execute the tour end transaction
    const result = await executeTourEndTransaction(activeTourId, user.id);

    // Record success metric
    recordMetric(MetricType.API_REQUEST_SUCCESS, 1, { endpoint: 'tour-end' });

    return NextResponse.json(result);
  } catch (error) {
    // Handle any errors
    console.error(`${logPrefix} Error in tour end operation:`, error);
    recordMetric(MetricType.API_REQUEST_FAILURE, 1, { endpoint: 'tour-end' });

    // Use the error handling utility to standardize the response
    const errorResponse = handleError(error, logPrefix);
    return NextResponse.json(errorResponse, { status: errorResponse.status });
  }
}
