/**
 * Normalizes a language string for storage by converting to lowercase and removing special characters
 * @param language The language string to normalize
 * @returns The normalized language string
 */
export function normalizeLanguageForStorage(language: string): string {
  return language.toLowerCase().trim();
}

/**
 * Formats a language string for display by capitalizing the first letter
 * @param language The language string to format
 * @returns The formatted language string
 */
export function formatLanguageForDisplay(language: string): string {
  if (!language) return '';
  return language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
}

/**
 * Generates a Redis key for a WebRTC offer
 * @param tourId The tour ID
 * @param language The language (will be normalized)
 * @returns The Redis key for the offer
 */
export function getOfferKey(tourId: string, language: string): string {
  return `tour:${tourId}:offer:${normalizeLanguageForStorage(language)}`;
}

/**
 * Generates a Redis key for supported languages set
 * @param tourId The tour ID
 * @returns The Redis key for the supported languages set
 */
export function getSupportedLanguagesKey(tourId: string): string {
  return `tour:${tourId}:supported_languages`;
}

/**
 * Generates a Redis key for primary language
 * @param tourId The tour ID
 * @returns The Redis key for the primary language
 */
export function getPrimaryLanguageKey(tourId: string): string {
  return `tour:${tourId}:primary_language`;
}

/**
 * Generates a Redis key for language-specific attendees set
 * @param tourId The tour ID
 * @param language The language (will be normalized)
 * @returns The Redis key for the language attendees set
 */
export function getLanguageAttendeesKey(tourId: string, language: string): string {
  return `tour:${tourId}:language:${normalizeLanguageForStorage(language)}:attendees`;
}

/**
 * Generates a Redis key for attendee details
 * @param tourId The tour ID
 * @param attendeeId The attendee ID
 * @returns The Redis key for the attendee details
 */
export function getAttendeeKey(tourId: string, attendeeId: string): string {
  return `tour:${tourId}:attendee:${attendeeId}`;
}

/**
 * Generates alternative case versions of an offer key for fallback lookups
 * @param tourId The tour ID
 * @param language The language
 * @returns Array of alternative keys with different case variations
 */
export function getAlternativeOfferKeys(tourId: string, language: string): string[] {
  const normalizedLang = normalizeLanguageForStorage(language);
  const displayLang = formatLanguageForDisplay(language);

  return [
    `tour:${tourId}:offer:${normalizedLang}`,
    `tour:${tourId}:offer:${displayLang}`
  ];
}

/**
 * Validates a WebRTC SDP offer object
 * @param offer The offer object to validate
 * @returns Validation result with isValid flag and optional error message
 */
export function validateSdpOffer(offer: any): { isValid: boolean; error?: string } {
  if (!offer) {
    return { isValid: false, error: 'Offer is empty or undefined' };
  }

  // Basic validation - can be expanded as needed
  if (typeof offer !== 'object') {
    return { isValid: false, error: 'Offer must be an object' };
  }

  return { isValid: true };
}

/**
 * Checks if an offer is a placeholder offer
 * @param offer The offer object to check
 * @returns True if the offer is a placeholder, false otherwise
 */
export function isPlaceholderOffer(offer: any): boolean {
  if (!offer) return true;

  return (
    offer.status === 'pending' ||
    (offer.offer && typeof offer.offer === 'string' &&
     offer.offer.includes('Initialized offer for')) ||
    // Check if it's missing valid SDP content
    (offer.sdp && typeof offer.sdp === 'string' &&
     !offer.sdp.includes('v=')) ||
    // Version check - if no version, it's likely a placeholder
    !offer.version
  );
}

/**
 * Creates a Redis transaction for safely replacing a placeholder offer with a real offer
 * @param tourId The tour ID
 * @param language The language
 * @param realOffer The real SDP offer to store
 * @param expirySeconds Expiry time in seconds for the offer
 * @returns Array of Redis commands for the transaction
 */
export function createReplaceOfferTransaction(tourId: string, language: string, realOffer: any, expirySeconds: number = 7200): any[] {
  const offerKey = getOfferKey(tourId, language);

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
  const offerKey = getOfferKey(tourId, language);
  const langContext = `[${language}]`;

  // Add version and timestamp to the offer
  const versionedOffer = {
    ...realOffer,
    version: Date.now(),
    updated: new Date().toISOString()
  };

  const serializedOffer = JSON.stringify(versionedOffer);

  try {
    // Start a transaction
    const multi = redis.multi();

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
    // Mark the tour as inactive for the guide
    ['SREM', `guide:${guideId}:active_tours`, tourId],
    // Add to ended tours set
    ['SADD', `guide:${guideId}:ended_tours`, tourId]
  ];
}
