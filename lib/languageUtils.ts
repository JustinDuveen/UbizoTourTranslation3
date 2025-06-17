/**
 * Language utilities - main export file
 * Heavy functions have been moved to separate modules for better compilation performance
 */

// Re-export from modular files for backward compatibility
export {
  normalizeLanguageForStorage,
  formatLanguageForDisplay,
  getOfferKey,
  getSupportedLanguagesKey,
  getPrimaryLanguageKey,
  getLanguageAttendeesKey,
  getAttendeeKey,
  getAlternativeOfferKeys
} from './redisKeys';

export {
  validateSdpOffer,
  isPlaceholderOffer
} from './sdpUtils';

export {
  createReplaceOfferTransaction,
  executeReplaceOfferTransaction,
  createTourEndTransaction
} from './redisTransactions';


