# Reliability Utilities Quick Reference

This document provides a quick reference for the reliability utilities implemented in Phase 4 of the Tour Translator application.

## Redis Transaction Utilities

### Execute Redis Transaction

```typescript
import { executeRedisTransaction } from "@/lib/redis";

// Execute a Redis transaction with enhanced options
const results = await executeRedisTransaction(operations, {
  maxRetries: 3,              // Maximum number of retry attempts
  initialDelay: 100,          // Initial delay in ms before first retry
  maxDelay: 5000,             // Maximum delay in ms between retries
  jitter: true,               // Add random jitter to prevent thundering herd
  logPrefix: '[MY-PREFIX]',   // Prefix for log messages
  validateResults: (results) => validateTransactionResults(results, operations.length)
});
```

### Execute With Retry

```typescript
import { executeWithRetry } from "@/lib/redis";

// Execute a Redis operation with retry logic
const result = await executeWithRetry(
  async () => await redis.get('my-key'),
  {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 5000,
    jitter: true,
    logPrefix: '[MY-PREFIX]',
    validateResult: (result) => result !== null
  }
);
```

### Validate Transaction Results

```typescript
import { validateTransactionResults } from "@/lib/redis";

// Validate transaction results
const isValid = validateTransactionResults(
  results,                  // Results from executeRedisTransaction
  expectedLength,           // Expected number of results
  (result, index) => result !== null  // Optional validator function
);
```

### Redis Health Check

```typescript
import { isRedisHealthy } from "@/lib/redis";

// Check if Redis is healthy
const healthy = await isRedisHealthy();
if (!healthy) {
  console.error('Redis is not healthy!');
}
```

## SDP Validation and Recovery

### Validate SDP Offer

```typescript
import { validateSdpOffer } from "@/lib/languageUtils";

// Validate an SDP offer
const validation = validateSdpOffer(offer, { strict: false });

if (!validation.isValid) {
  console.error(`SDP validation failed: ${validation.error}`);
} else {
  // Check for warnings
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn('SDP warnings:', validation.warnings);
  }
  
  // Access detailed information
  const { hasAudio, hasVideo, hasDataChannel } = validation.details;
}
```

### Repair SDP Offer

```typescript
import { repairSdpOffer } from "@/lib/languageUtils";

// Attempt to repair an SDP offer
const repairResult = repairSdpOffer(offer);

if (repairResult.repaired) {
  console.log('SDP repaired successfully. Changes:', repairResult.changes);
  offer = repairResult.offer;
} else {
  console.error(`SDP repair failed: ${repairResult.error}`);
}
```

## Error Handling

### Create Specific Errors

```typescript
import { 
  createUnauthorizedError,
  createNotFoundError,
  createBadRequestError,
  createLanguageNotSupportedError,
  createOfferNotFoundError,
  createInvalidOfferError,
  createRedisTransactionError,
  createServerError
} from "@/lib/errorHandling";

// Create specific error types
throw createUnauthorizedError('Only guides can store WebRTC offers');
throw createNotFoundError(`No active tour found with ID: ${tourId}`);
throw createBadRequestError('Missing required fields', { required, received });
throw createLanguageNotSupportedError(language, supportedLanguages);
throw createOfferNotFoundError(language, tourId);
throw createInvalidOfferError(`Invalid SDP offer: ${validation.error}`);
throw createRedisTransactionError('Transaction failed', { operations });
throw createServerError('Internal server error', { details });
```

### Handle Errors

```typescript
import { handleError } from "@/lib/errorHandling";

// Handle errors and return standardized response
try {
  // Operation that might throw an error
} catch (error) {
  const errorResponse = handleError(error, '[MY-PREFIX]');
  return NextResponse.json(errorResponse, { status: errorResponse.status });
}
```

### Wrap Functions with Error Handling

```typescript
import { withErrorHandling } from "@/lib/errorHandling";

// Wrap an async function with error handling
const safeFunction = withErrorHandling(async (param1, param2) => {
  // Function implementation
}, '[MY-PREFIX]');

// Call the wrapped function
const result = await safeFunction(value1, value2);
```

## Monitoring and Metrics

### Record Metrics

```typescript
import { MetricType, recordMetric } from "@/lib/monitoring";

// Record a metric
recordMetric(
  MetricType.API_REQUEST_SUCCESS,  // Metric type
  1,                               // Metric value
  { endpoint: 'atomic-offer' }     // Optional labels
);
```

### Time Async Operations

```typescript
import { MetricType, timeAsync } from "@/lib/monitoring";

// Time an async operation and record its duration
const result = await timeAsync(
  async () => {
    // Operation to time
    return await someAsyncOperation();
  },
  MetricType.API_REQUEST_DURATION,  // Metric type for duration
  { endpoint: 'atomic-offer' }      // Optional labels
);
```

### Get Metrics

```typescript
import { MetricType, getMetrics, getAverageMetric } from "@/lib/monitoring";

// Get metrics for a specific type
const metrics = getMetrics(
  MetricType.API_REQUEST_DURATION,  // Metric type
  3600000                           // Time range in ms (1 hour)
);

// Get average value for a specific metric type
const avgDuration = getAverageMetric(
  MetricType.API_REQUEST_DURATION,  // Metric type
  3600000                           // Time range in ms (1 hour)
);
```

### Monitor Memory Usage

```typescript
import { recordMemoryUsage, startPeriodicMonitoring } from "@/lib/monitoring";

// Record current memory usage
recordMemoryUsage();

// Start periodic monitoring (every minute)
const stopMonitoring = startPeriodicMonitoring(60000);

// Later, stop monitoring
stopMonitoring();
```

## Transaction Creation

### Create Offer Transaction

```typescript
import { createOfferTransaction } from "@/lib/languageUtils";

// Create a transaction for storing a WebRTC offer
const operations = createOfferTransaction(
  tourId,        // Tour ID
  language,      // Language name
  offerObject,   // WebRTC offer object
  7200           // Expiry time in seconds (2 hours)
);
```

### Create Attendee Registration Transaction

```typescript
import { createAttendeeRegistrationTransaction } from "@/lib/languageUtils";

// Create a transaction for registering an attendee
const operations = createAttendeeRegistrationTransaction(
  tourId,        // Tour ID
  attendeeId,    // Attendee ID
  attendeeData,  // Attendee data
  language,      // Language name
  14400          // Expiry time in seconds (4 hours)
);
```

## Best Practices

1. **Always use transactions for critical operations** that modify multiple Redis keys
2. **Validate SDP offers** before storing them
3. **Attempt to repair invalid SDP offers** before rejecting them
4. **Use specific error types** for better error handling
5. **Record metrics** for important operations
6. **Time async operations** to monitor performance
7. **Use retry logic** for operations that might fail transiently
8. **Validate transaction results** to ensure data integrity
