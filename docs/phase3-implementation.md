# Phase 3: Centralized Language Handling Implementation

## Overview

This document details the implementation of Phase 3 of the Tour Translator improvement plan, which focused on centralizing language handling to address case sensitivity issues in Redis operations while maintaining proper capitalization for UI display.

## Background

The Tour Translator application was experiencing issues with case sensitivity in language handling, particularly with Redis keys. This led to connection failures when the case of language names didn't match exactly between different parts of the application.

## Implementation Details

### 1. Language Utilities Module

The foundation of the implementation is the `lib/languageUtils.ts` module, which provides standardized functions for language normalization and Redis key generation.

Key functions:
- `normalizeLanguageForStorage(language: string)`: Converts language names to lowercase for consistent storage
- `formatLanguageForDisplay(language: string)`: Capitalizes language names for UI display
- Various key generation functions for standardized Redis key patterns

### 2. API Routes Updates

All API routes that handle languages were updated to use the language utilities:

#### a. `app/api/tour/offer/route.ts`
- Updated to use normalized language for Redis key generation
- Improved SDP validation using the `validateSdpOffer()` utility
- Enhanced error handling and logging

```typescript
// Before
const offerKey = `tour:${tourId}:offer:${language}`;

// After
const normalizedLanguage = normalizeLanguageForStorage(language);
const offerKey = getOfferKey(tourId, normalizedLanguage);
```

#### b. `app/api/tour/join/route.ts`
- Implemented proper language normalization for request parameters
- Updated Redis key generation to use utility functions
- Added fallback mechanisms for backward compatibility

```typescript
// Before
const language = languageParam ? languageParam.toLowerCase() : null;

// After
const language = languageParam ? normalizeLanguageForStorage(languageParam) : null;
const displayLanguage = languageParam ? formatLanguageForDisplay(languageParam) : null;
```

#### c. `app/api/tour/clear-placeholder/route.ts`
- Updated to use normalized language for Redis key generation
- Improved logging with normalized language information

#### d. `app/api/tour/answer/route.ts`
- Implemented proper language normalization in both GET and POST methods

#### e. `app/api/tour/languages/route.ts`
- Updated to use utility functions for Redis key generation
- Enhanced response objects with both normalized and display language information

```typescript
// Before
return {
  languages,
  primaryLanguage,
  attendeeCounts
};

// After
const displayLanguages = languages.map(lang => ({
  code: lang,
  display: formatLanguageForDisplay(lang)
}));

return {
  languages,
  displayLanguages,
  primaryLanguage,
  primaryDisplayLanguage: primaryLanguage ? formatLanguageForDisplay(primaryLanguage) : null,
  attendeeCounts
};
```

### 3. UI Components Updates

#### a. `components/LanguageSelector.tsx`
- Updated to normalize language before setting it
- Enhanced SelectItem rendering to use both normalized and display language formats

```typescript
// Before
const handleLanguageChange = (newLanguage: string) => {
  setLanguage(newLanguage);
  connectToGuide?.();
};

// After
const handleLanguageChange = (newLanguage: string) => {
  const normalizedLanguage = normalizeLanguageForStorage(newLanguage);
  setLanguage(normalizedLanguage);
  connectToGuide?.();
};
```

```typescript
// Before
<SelectItem key={lang.toLowerCase()} value={lang.toLowerCase()}>
  {lang}
</SelectItem>

// After
<SelectItem key={normalizedLang} value={normalizedLang}>
  {displayLang}
</SelectItem>
```

### 4. Backward Compatibility

To ensure backward compatibility with existing Redis keys that might use different case formats, the implementation includes fallback mechanisms:

```typescript
// Try to get the offer using the primary key first
let offerJson = await redis.get(primaryOfferKey);

// If not found, try alternative keys for backward compatibility
if (!offerJson) {
  const alternativeKeys = getAlternativeOfferKeys(tourId, language);
  
  // Try each alternative key
  for (const altKey of alternativeKeys) {
    if (altKey === primaryOfferKey) continue;
    
    offerJson = await redis.get(altKey);
    if (offerJson) {
      console.log(`Found offer using alternative key: ${altKey}`);
      break;
    }
  }
}
```

## Benefits

The implementation of Phase 3 provides several benefits:

1. **Consistency**: Ensures consistent language handling across the application
2. **Robustness**: Reduces the risk of case sensitivity issues in Redis operations
3. **User Experience**: Maintains proper capitalization for UI display
4. **Maintainability**: Centralizes language handling logic in a single module
5. **Backward Compatibility**: Includes fallback mechanisms for existing Redis keys

## Testing

The implementation has been tested with various language formats to ensure:

1. Languages are properly normalized for Redis operations
2. Languages are properly formatted for UI display
3. Fallback mechanisms work for existing Redis keys
4. SDP validation works correctly

## Next Steps

1. **Monitoring**: Monitor for any language-related issues in production
2. **Migration**: Consider implementing a migration script to normalize existing Redis keys
3. **Documentation**: Ensure all developers are aware of the new language handling approach
4. **Phase 4**: Proceed with Phase 4 of the implementation plan (Ensure Atomicity and Reliability)

## Conclusion

The implementation of Phase 3 has successfully addressed the case sensitivity issues in the Tour Translator application by centralizing language handling and ensuring consistent normalization for Redis operations while maintaining proper capitalization for UI display. This lays a solid foundation for the remaining phases of the implementation plan.
