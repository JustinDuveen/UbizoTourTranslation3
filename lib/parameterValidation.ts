/**
 * Parameter validation utilities for audio system
 * EXPERT FIX: Runtime validation with TypeScript type safety
 */

import { normalizeLanguageForStorage } from './languageUtils';
import { 
  TourConnectionParams, 
  ParameterValidationResult, 
  ParameterMismatchError,
  AttendeeIdValidationError 
} from './types/audio';

/**
 * Validates and normalizes tour connection parameters
 */
export function validateTourConnectionParams(params: {
  tourId?: string;
  attendeeId?: string;
  language?: string;
  tourCode?: string;
}): ParameterValidationResult {
  const errors: string[] = [];

  // Validate required parameters
  if (!params.tourId || typeof params.tourId !== 'string') {
    errors.push('tourId is required and must be a string');
  }

  if (!params.attendeeId || typeof params.attendeeId !== 'string') {
    errors.push('attendeeId is required and must be a string');
  } else if (!params.attendeeId.startsWith('attendee_')) {
    errors.push('attendeeId must start with "attendee_"');
  }

  if (!params.language || typeof params.language !== 'string') {
    errors.push('language is required and must be a string');
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Normalize parameters
  const normalizedParams: TourConnectionParams = {
    tourId: params.tourId!,
    attendeeId: params.attendeeId!,
    language: normalizeLanguageForStorage(params.language!),
    tourCode: params.tourCode
  };

  return { 
    isValid: true, 
    errors: [], 
    normalizedParams 
  };
}

/**
 * Validates attendeeId format and consistency
 */
export function validateAttendeeId(attendeeId: string, context?: string): void {
  if (!attendeeId) {
    throw new AttendeeIdValidationError(attendeeId, 'AttendeeId cannot be empty');
  }

  if (!attendeeId.startsWith('attendee_')) {
    throw new AttendeeIdValidationError(attendeeId, 'AttendeeId must start with "attendee_"');
  }

  const parts = attendeeId.split('_');
  if (parts.length !== 3) {
    throw new AttendeeIdValidationError(attendeeId, 'AttendeeId must have format "attendee_timestamp_random"');
  }

  const timestamp = parseInt(parts[1]);
  if (isNaN(timestamp) || timestamp <= 0) {
    throw new AttendeeIdValidationError(attendeeId, 'AttendeeId timestamp must be a valid positive number');
  }

  const randomPart = parts[2];
  if (!randomPart || randomPart.length < 5) {
    throw new AttendeeIdValidationError(attendeeId, 'AttendeeId random part must be at least 5 characters');
  }

  console.log(`${context || '[VALIDATION]'} ✅ AttendeeId validation passed: ${attendeeId}`);
}

/**
 * Validates parameter consistency between guide and attendee
 */
export function validateParameterConsistency(
  guideParams: TourConnectionParams,
  attendeeParams: TourConnectionParams
): void {
  if (guideParams.tourId !== attendeeParams.tourId) {
    throw new ParameterMismatchError('tourId', guideParams.tourId, attendeeParams.tourId);
  }

  if (guideParams.language !== attendeeParams.language) {
    throw new ParameterMismatchError('language', guideParams.language, attendeeParams.language);
  }

  console.log(`✅ Parameter consistency validation passed for tour ${guideParams.tourId}`);
}

/**
 * Validates Redis key format
 */
export function validateRedisKey(key: string, expectedPattern: RegExp): boolean {
  return expectedPattern.test(key);
}

/**
 * Runtime parameter validation decorator
 */
export function validateParams<T extends (...args: any[]) => any>(
  validationFn: (...args: Parameters<T>) => ParameterValidationResult
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: Parameters<T>) {
      const validationResult = validationFn(...args);
      
      if (!validationResult.isValid) {
        throw new Error(`Parameter validation failed: ${validationResult.errors.join(', ')}`);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}