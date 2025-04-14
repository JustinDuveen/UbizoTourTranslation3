/**
 * Tour Utilities
 *
 * This module provides utility functions for tour operations.
 */

import { getRedisClient, executeRedisTransaction, validateTransactionResults } from "./redis";
import { createTourEndTransaction } from "./languageUtils";
import { MetricType, recordMetric, timeAsync } from "./monitoring";
import { createNotFoundError, createServerError } from "./errorHandling";

/**
 * Generate a unique tour code
 *
 * @param length Length of the code (default: 6)
 * @returns A unique alphanumeric tour code
 */
export function generateTourCode(length: number = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing characters like 0, O, 1, I
  let code = '';

  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}

/**
 * Execute a tour end transaction with proper handling of the tour info
 *
 * @param tourId The tour ID
 * @param guideId The guide ID
 * @returns The result of the transaction
 */
export async function executeTourEndTransaction(tourId: string, guideId: string): Promise<any> {
  const logPrefix = '[TOUR-END]';

  // Get the base transaction operations
  const operations = createTourEndTransaction(tourId, guideId);
  console.log(`${logPrefix} Created tour end transaction with operations:`, operations);

  // Execute the transaction with custom handling
  return await timeAsync(async () => {
    const redis = await getRedisClient();

    // First, get the current tour info
    const tourInfoJson = await redis.get(`tour:${tourId}`);
    if (!tourInfoJson) {
      throw createNotFoundError(`Tour info not found for tour ID: ${tourId}`);
    }

    try {
      // Parse the tour info
      const tourInfo = JSON.parse(tourInfoJson);

      // Update the tour info with ended status
      const updatedTourInfo = {
        ...tourInfo,
        status: "ended",
        endTime: new Date().toISOString()
      };

      // Replace the placeholder in the transaction
      operations[1].args = [JSON.stringify(updatedTourInfo), 'KEEPTTL'];

      // Check if active tour key exists before transaction
      const activeTourBefore = await redis.get(`guide:${guideId}:active_tour`);
      console.log(`${logPrefix} Active tour before transaction: ${activeTourBefore || 'None'}`);

      // Execute the transaction
      console.log(`${logPrefix} Executing Redis transaction with ${operations.length} operations`);
      const results = await executeRedisTransaction(operations, {
        maxRetries: 3,
        logPrefix,
        validateResults: (results) => validateTransactionResults(results, operations.length)
      });

      console.log(`${logPrefix} Transaction results:`, results);

      recordMetric(MetricType.TOUR_END, 1, { tourId });

      return {
        message: "Tour ended successfully",
        tourId,
        endTime: updatedTourInfo.endTime
      };
    } catch (error) {
      recordMetric(MetricType.TOUR_END_FAILURE, 1, { tourId });
      throw createServerError(`Failed to end tour: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, MetricType.TOUR_END_DURATION, { tourId });
}

/**
 * Validate that a tour exists and is active
 *
 * @param tourId The tour ID
 * @returns True if the tour exists and is active, false otherwise
 */
export async function validateActiveTour(tourId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();

    // Check if tour exists
    const tourExists = await redis.exists(`tour:${tourId}`);
    if (!tourExists) return false;

    // Get tour info
    const tourInfoJson = await redis.get(`tour:${tourId}`);
    if (!tourInfoJson) return false;

    // Parse tour info and check status
    const tourInfo = JSON.parse(tourInfoJson);
    return tourInfo.status === "active";
  } catch (error) {
    console.error(`Error validating tour ${tourId}:`, error);
    return false;
  }
}

/**
 * Get tour info
 *
 * @param tourId The tour ID
 * @returns The tour info or null if not found
 */
export async function getTourInfo(tourId: string): Promise<any | null> {
  try {
    const redis = await getRedisClient();

    // Get tour info
    const tourInfoJson = await redis.get(`tour:${tourId}`);
    if (!tourInfoJson) return null;

    // Parse tour info
    return JSON.parse(tourInfoJson);
  } catch (error) {
    console.error(`Error getting tour info for ${tourId}:`, error);
    return null;
  }
}
