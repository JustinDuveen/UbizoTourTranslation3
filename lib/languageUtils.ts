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
 * @param language The language (will be normalized if normalizeLanguage is true)
 * @param normalizeLanguage Whether to normalize the language (default: true)
 * @returns The Redis key for the offer
 */
export function getOfferKey(tourId: string, language: string, normalizeLanguage: boolean = true): string {
  const languageKey = normalizeLanguage ? normalizeLanguageForStorage(language) : language;
  return `tour:${tourId}:offer:${languageKey}`;
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
 * @param language The language (will be normalized if normalizeLanguage is true)
 * @param normalizeLanguage Whether to normalize the language (default: true)
 * @returns The Redis key for the language attendees set
 */
export function getLanguageAttendeesKey(tourId: string, language: string, normalizeLanguage: boolean = true): string {
  const languageKey = normalizeLanguage ? normalizeLanguageForStorage(language) : language;
  return `tour:${tourId}:language:${languageKey}:attendees`;
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
 * Generates alternative Redis keys for an offer to handle case variations
 * @param tourId The tour ID
 * @param language The original language string (not normalized)
 * @returns Array of alternative Redis keys
 */
export function getAlternativeOfferKeys(tourId: string, language: string): string[] {
  if (!language) return [];

  const primaryKey = getOfferKey(tourId, normalizeLanguageForStorage(language));

  const alternatives = [
    // Original with different normalizations
    `tour:${tourId}:offer:${language.toLowerCase()}`,
    `tour:${tourId}:offer:${language.toUpperCase()}`,
    `tour:${tourId}:offer:${language.charAt(0).toUpperCase() + language.slice(1).toLowerCase()}`,

    // Common variations
    `tour:${tourId}:offer:${language.trim().toLowerCase()}`,

    // Language variations
    `tour:${tourId}:offer:${formatLanguageForDisplay(language)}`,

    // Legacy format (if any)
    `tour:${tourId}:${language.toLowerCase()}:offer`
  ];

  // Remove duplicates and the primary key (which will be checked first)
  return [...new Set(alternatives)].filter(key => key !== primaryKey);
}

/**
 * Validates a WebRTC SDP offer object with enhanced checks
 * @param offer The offer object to validate
 * @returns Validation result with isValid flag and optional error message
 */
export function validateSdpOffer(offer: any): { isValid: boolean; error?: string } {
  if (!offer) {
    return { isValid: false, error: 'Offer is null or undefined' };
  }

  // Type validation
  if (typeof offer !== 'object') {
    return { isValid: false, error: `Invalid offer type: ${typeof offer}` };
  }

  // Structure validation
  if (!offer.type) {
    return { isValid: false, error: 'Missing offer type' };
  }

  // Check for valid type
  if (offer.type !== 'offer' && offer.type !== 'answer') {
    return { isValid: false, error: `Invalid offer type: ${offer.type}` };
  }

  // SDP content validation
  let sdpContent = '';
  if (offer.sdp && typeof offer.sdp === 'string') {
    sdpContent = offer.sdp;
  } else if (typeof offer === 'object') {
    // Handle different possible structures
    if (offer.offer && typeof offer.offer === 'string') {
      sdpContent = offer.offer;
    } else if (offer.offer && typeof offer.offer === 'object' && offer.offer.sdp && typeof offer.offer.sdp === 'string') {
      sdpContent = offer.offer.sdp;
    }
  }

  if (!sdpContent) {
    return { isValid: false, error: 'Missing or invalid SDP content' };
  }

  // Comprehensive SDP validation
  if (!sdpContent.includes('v=0')) {
    return { isValid: false, error: 'SDP missing version (v=0)' };
  }

  if (!sdpContent.includes('m=audio')) {
    return { isValid: false, error: 'SDP missing audio media section' };
  }

  // Check for required SDP attributes
  const requiredAttributes = ['c=IN', 'a=rtpmap:', 'a=fingerprint:'];
  const missingAttributes = requiredAttributes.filter(attr => !sdpContent.includes(attr));
  if (missingAttributes.length > 0) {
    return {
      isValid: false,
      error: `SDP missing required attributes: ${missingAttributes.join(', ')}`
    };
  }

  // Check for audio directionality
  const audioSection = sdpContent.split('m=audio')[1]?.split('m=')[0] || '';
  if (!audioSection) {
    return { isValid: false, error: 'Could not parse audio section from SDP' };
  }

  // For guide offers, we want sendrecv
  if (offer.type === 'offer' && !audioSection.includes('a=sendrecv')) {
    // Not invalid, but log a warning
    console.warn('SDP offer does not have a=sendrecv for audio');
  }

  return { isValid: true };
}

/**
 * Checks if an offer is a placeholder offer with enhanced detection
 * @param offer The offer object to check
 * @returns True if the offer is a placeholder, false otherwise
 */
export function isPlaceholderOffer(offer: any): boolean {
  if (!offer) return true;

  // Log the offer structure for debugging
  console.log(`[PLACEHOLDER-CHECK] Checking offer type: ${typeof offer}`);
  if (typeof offer === 'object') {
    console.log(`[PLACEHOLDER-CHECK] Offer keys: ${Object.keys(offer).join(', ')}`);
  }

  // Enhanced detection with multiple patterns
  const isPlaceholder = (
    // Status-based detection
    offer.status === 'pending' ||
    offer.status === 'initializing' ||

    // Content-based detection
    (offer.offer && typeof offer.offer === 'string' && (
      offer.offer.includes('Initialized offer for') ||
      offer.offer.includes('placeholder') ||
      offer.offer.includes('pending')
    )) ||

    // SDP validation
    (offer.sdp && typeof offer.sdp === 'string' && (
      !offer.sdp.includes('v=0') ||
      !offer.sdp.includes('m=audio')
    )) ||

    // Metadata checks
    !offer.version ||
    (offer.updated && new Date(offer.updated).getTime() < Date.now() - 3600000) || // Older than 1 hour

    // Type checks
    (offer.type === 'placeholder') ||

    // Structure checks
    (typeof offer === 'object' && Object.keys(offer).length < 2)
  );

  if (isPlaceholder) {
    console.log(`[PLACEHOLDER-CHECK] Detected placeholder offer`);
    // Log the specific reason
    if (offer.status === 'pending') console.log(`[PLACEHOLDER-CHECK] Reason: status is 'pending'`);
    if (offer.offer && typeof offer.offer === 'string' && offer.offer.includes('Initialized offer for'))
      console.log(`[PLACEHOLDER-CHECK] Reason: offer contains 'Initialized offer for'`);
    if (offer.sdp && typeof offer.sdp === 'string' && !offer.sdp.includes('v=0'))
      console.log(`[PLACEHOLDER-CHECK] Reason: SDP missing 'v=0'`);
    if (!offer.version) console.log(`[PLACEHOLDER-CHECK] Reason: missing version`);
  }

  return isPlaceholder;
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
    // Delete the active tour reference (singular key used in the application)
    ['DEL', `guide:${guideId}:active_tour`],
    // Mark the tour as inactive for the guide (plural key for backward compatibility)
    ['SREM', `guide:${guideId}:active_tours`, tourId],
    // Add to ended tours set
    ['SADD', `guide:${guideId}:ended_tours`, tourId]
  ];
}
