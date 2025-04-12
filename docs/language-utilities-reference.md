# Language Utilities Quick Reference

This document provides a quick reference for the language utilities in the Tour Translator application.

## Import Utilities

```typescript
import { 
  normalizeLanguageForStorage, 
  formatLanguageForDisplay,
  getOfferKey,
  getSupportedLanguagesKey,
  getPrimaryLanguageKey,
  getLanguageAttendeesKey,
  getAttendeeKey,
  getAlternativeOfferKeys,
  validateSdpOffer,
  createOfferTransaction
} from "@/lib/languageUtils";
```

## Language Formatting

### Normalize Language for Storage

```typescript
// Convert to lowercase for Redis keys and storage
const normalizedLanguage = normalizeLanguageForStorage("English"); // "english"
```

### Format Language for Display

```typescript
// Capitalize for UI display
const displayLanguage = formatLanguageForDisplay("english"); // "English"
```

## Redis Key Generation

### WebRTC Offer Key

```typescript
// Generate key for WebRTC offer
const offerKey = getOfferKey("tour123", "English"); // "tour:tour123:offer:english"
```

### Supported Languages Key

```typescript
// Generate key for supported languages set
const supportedLanguagesKey = getSupportedLanguagesKey("tour123"); // "tour:tour123:supported_languages"
```

### Primary Language Key

```typescript
// Generate key for primary language
const primaryLanguageKey = getPrimaryLanguageKey("tour123"); // "tour:tour123:primary_language"
```

### Language Attendees Key

```typescript
// Generate key for language-specific attendees set
const languageAttendeesKey = getLanguageAttendeesKey("tour123", "English"); // "tour:tour123:language:english:attendees"
```

### Attendee Key

```typescript
// Generate key for attendee details
const attendeeKey = getAttendeeKey("tour123", "attendee456"); // "tour:tour123:attendee:attendee456"
```

### Alternative Offer Keys

```typescript
// Generate alternative case versions of an offer key for fallback lookups
const alternativeKeys = getAlternativeOfferKeys("tour123", "English");
// ["tour:tour123:offer:english", "tour:tour123:offer:English"]
```

## Validation

### Validate SDP Offer

```typescript
// Validate a WebRTC SDP offer object
const validation = validateSdpOffer(offerObject);
if (validation.isValid) {
  // Proceed with valid offer
} else {
  console.error(`Invalid offer: ${validation.error}`);
}
```

## Transactions

### Create Offer Transaction

```typescript
// Create a transaction for clearing a placeholder and storing a real offer
const operations = createOfferTransaction("tour123", "English", offerObject, 7200);
await executeRedisTransaction(operations);
```

## Common Patterns

### Handling Language in API Routes

```typescript
// Extract and normalize language from request
const languageParam = req.query.language;
const language = languageParam ? normalizeLanguageForStorage(languageParam) : null;
const displayLanguage = languageParam ? formatLanguageForDisplay(languageParam) : null;

// Generate Redis key
const offerKey = getOfferKey(tourId, language);

// Include both formats in response
return {
  language: language,
  displayLanguage: displayLanguage,
  // other response data
};
```

### Fallback for Backward Compatibility

```typescript
// Try primary key first
let data = await redis.get(primaryKey);

// If not found, try alternative keys
if (!data) {
  const alternativeKeys = getAlternativeOfferKeys(tourId, language);
  
  for (const altKey of alternativeKeys) {
    if (altKey === primaryKey) continue;
    
    data = await redis.get(altKey);
    if (data) break;
  }
}
```

### Language Handling in UI Components

```typescript
// Normalize language before setting
const handleLanguageChange = (newLanguage: string) => {
  const normalizedLanguage = normalizeLanguageForStorage(newLanguage);
  setLanguage(normalizedLanguage);
};

// Format language for display
return (
  <div>
    Selected Language: {formatLanguageForDisplay(language)}
  </div>
);
```

## Best Practices

1. Always normalize languages for Redis operations
2. Always format languages for UI display
3. Use utility functions for Redis key generation
4. Include both normalized and display formats in API responses
5. Validate SDP offers before storage
6. Use atomic transactions for critical operations
7. Implement fallback mechanisms for backward compatibility
