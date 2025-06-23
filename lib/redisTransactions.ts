/**
 * Redis transaction utilities
 * Separated from languageUtils.ts to improve compilation performance
 */

import { normalizeLanguageForStorage } from './languageUtils';
import { getOfferKey } from './redisKeys';
import { isPlaceholderOffer } from './sdpUtils';

/**
 * Creates a Redis transaction for safely replacing a placeholder offer with a real offer
 * @param tourId The tour ID
 * @param language The language
 * @param realOffer The real SDP offer to store
 * @param expirySeconds Expiry time in seconds for the offer
 * @returns Array of Redis commands for the transaction
 */
export function createReplaceOfferTransaction(tourId: string, language: string, realOffer: any, expirySeconds: number = 7200): any[] {
  // Normalize the language first
  const normalizedLanguage = normalizeLanguageForStorage(language);
  // Use normalizeLanguage=false since we've already normalized the language
  const offerKey = getOfferKey(tourId, normalizedLanguage, false);

  // Add version to the offer
  const versionedOffer = {
    ...realOffer,
    version: Date.now(),
    updated: new Date().toISOString()
  };

  const serializedOffer = JSON.stringify(versionedOffer);

  return [
    // 1. Get the current offer to check if it's a placeholder
    ['GET', offerKey],
    // 2. Set the new offer with expiry (this will be executed conditionally)
    ['SET', offerKey, serializedOffer, 'EX', expirySeconds]
  ];
}

/**
 * Executes a Redis transaction that replaces a placeholder offer with a real offer
 * @param redis The Redis client
 * @param tourId The tour ID
 * @param language The language
 * @param realOffer The real SDP offer to store
 * @param expirySeconds Expiry time in seconds for the offer
 * @returns Promise resolving to true if successful, false if failed
 */
export async function executeReplaceOfferTransaction(redis: any, tourId: string, language: string, realOffer: any, expirySeconds: number = 7200): Promise<boolean> {
  // Normalize the language first
  const normalizedLanguage = normalizeLanguageForStorage(language);
  // Use normalizeLanguage=false since we've already normalized the language
  const offerKey = getOfferKey(tourId, normalizedLanguage, false);
  const langContext = `[${language}]`;

  // Add version and timestamp to the offer
  const versionedOffer = {
    ...realOffer,
    version: Date.now(),
    updated: new Date().toISOString()
  };

  const serializedOffer = JSON.stringify(versionedOffer);

  try {
    // Get the current offer
    const currentOfferJson = await redis.get(offerKey);
    let currentOffer = null;

    try {
      if (currentOfferJson) {
        currentOffer = JSON.parse(currentOfferJson);
      }
    } catch (e) {
      console.error(`${langContext} Error parsing current offer:`, e);
      // If we can't parse it, assume it's not a valid offer
      currentOffer = null;
    }

    // Check if it's a placeholder or doesn't exist
    if (!currentOffer || isPlaceholderOffer(currentOffer)) {
      console.log(`${langContext} Current offer is a placeholder or doesn't exist, replacing with real offer`);
      // Set the new offer with expiry
      await redis.set(offerKey, serializedOffer, 'EX', expirySeconds);

      // Verify the offer was stored correctly
      const verifiedOffer = await redis.get(offerKey);
      if (verifiedOffer) {
        console.log(`${langContext} Successfully replaced placeholder with real offer`);
        return true;
      } else {
        console.error(`${langContext} Failed to verify offer storage`);
        return false;
      }
    } else {
      // If it's already a real offer, check if our version is newer
      if (currentOffer.version && versionedOffer.version > currentOffer.version) {
        console.log(`${langContext} Replacing older real offer with newer version`);
        await redis.set(offerKey, serializedOffer, 'EX', expirySeconds);
        return true;
      } else {
        console.log(`${langContext} Current offer is already a real offer with same or newer version, not replacing`);
        return false;
      }
    }
  } catch (error) {
    console.error(`${langContext} Error executing replace offer transaction:`, error);
    return false;
  }
}

/**
 * Creates a Redis transaction for ending a tour
 * @param tourId The tour ID
 * @param guideId The guide ID
 * @returns Array of Redis transaction operations
 */
export function createTourEndTransaction(tourId: string, guideId: string): any[] {
  return [
    // Get the tour info (placeholder for validation)
    ['GET', `tour:${tourId}`],
    // Update the tour info with ended status (placeholder, will be replaced with actual data)
    ['SET', `tour:${tourId}`, ''],
    // Remove the tour code mapping
    ['DEL', `tour_codes:${tourId}`],
    // Delete the active tour reference (singular key used in the application)
    ['DEL', `guide:${guideId}:active_tour`],
    // Mark the tour as inactive for the guide (plural key for backward compatibility)
    ['SREM', `guide:${guideId}:active_tours`, tourId],
    // Add to ended tours set
    ['SADD', `guide:${guideId}:ended_tours`, tourId]
  ];
}
