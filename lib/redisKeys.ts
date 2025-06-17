/**
 * Redis key generation utilities
 * Separated from languageUtils.ts to improve compilation performance
 */

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
 * Generates a Redis key for attendee answers list
 * @param tourId The tour ID
 * @param language The language (will be normalized if normalizeLanguage is true)
 * @param normalizeLanguage Whether to normalize the language (default: true)
 * @returns The Redis key for the attendee answers list
 */
export function getAnswersKey(tourId: string, language: string, normalizeLanguage: boolean = true): string {
  const languageKey = normalizeLanguage ? normalizeLanguageForStorage(language) : language;
  return `tour:${tourId}:${languageKey}:answers`;
}

/**
 * Generates a Redis key for ICE candidates
 * @param sender The sender type ('guide' or 'attendee')
 * @param tourId The tour ID
 * @param attendeeId The attendee ID
 * @param language The language (will be normalized if normalizeLanguage is true)
 * @param normalizeLanguage Whether to normalize the language (default: true)
 * @returns The Redis key for ICE candidates
 */
export function getIceCandidateKey(sender: string, tourId: string, attendeeId: string, language: string, normalizeLanguage: boolean = true): string {
  const languageKey = normalizeLanguage ? normalizeLanguageForStorage(language) : language;
  return `ice:${sender}:${tourId}:${attendeeId}:${languageKey}`;
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
