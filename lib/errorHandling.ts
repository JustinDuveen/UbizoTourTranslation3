/**
 * Error Handling Utilities
 *
 * This module provides standardized error handling for the application.
 */

/**
 * Error types for the application
 */
export enum ErrorType {
  // Authentication errors
  AUTH_UNAUTHORIZED = 'auth/unauthorized',
  AUTH_INVALID_TOKEN = 'auth/invalid-token',
  AUTH_EXPIRED_TOKEN = 'auth/expired-token',

  // Tour errors
  TOUR_NOT_FOUND = 'tour/not-found',
  TOUR_INACTIVE = 'tour/inactive',
  TOUR_CODE_INVALID = 'tour/code-invalid',
  
  // Language errors
  LANGUAGE_NOT_SUPPORTED = 'language/not-supported',
  LANGUAGE_ALREADY_SUPPORTED = 'language/already-supported',
  LANGUAGE_PRIMARY = 'language/primary',
  
  // WebRTC errors
  WEBRTC_OFFER_INVALID = 'webrtc/offer-invalid',
  WEBRTC_OFFER_NOT_FOUND = 'webrtc/offer-not-found',
  WEBRTC_CONNECTION_FAILED = 'webrtc/connection-failed',
  WEBRTC_ICE_FAILED = 'webrtc/ice-failed',
  
  // Redis errors
  REDIS_CONNECTION_FAILED = 'redis/connection-failed',
  REDIS_TRANSACTION_FAILED = 'redis/transaction-failed',
  REDIS_KEY_NOT_FOUND = 'redis/key-not-found',
  
  // Request errors
  REQUEST_INVALID = 'request/invalid',
  REQUEST_MISSING_PARAMS = 'request/missing-params',
  
  // Server errors
  SERVER_ERROR = 'server/error',
  SERVER_TIMEOUT = 'server/timeout',
  
  // Unknown error
  UNKNOWN = 'unknown'
}

/**
 * Application error class
 */
export class AppError extends Error {
  type: ErrorType;
  status: number;
  details?: any;
  
  constructor(type: ErrorType, message: string, status: number = 500, details?: any) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.status = status;
    this.details = details;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
  
  /**
   * Convert the error to a JSON object for API responses
   */
  toJSON() {
    return {
      error: this.type,
      message: this.message,
      status: this.status,
      details: this.details
    };
  }
}

/**
 * Create an unauthorized error
 */
export function createUnauthorizedError(message: string = 'Unauthorized', details?: any): AppError {
  return new AppError(ErrorType.AUTH_UNAUTHORIZED, message, 401, details);
}

/**
 * Create a not found error
 */
export function createNotFoundError(message: string = 'Not found', details?: any): AppError {
  return new AppError(ErrorType.TOUR_NOT_FOUND, message, 404, details);
}

/**
 * Create a bad request error
 */
export function createBadRequestError(message: string = 'Bad request', details?: any): AppError {
  return new AppError(ErrorType.REQUEST_INVALID, message, 400, details);
}

/**
 * Create a language not supported error
 */
export function createLanguageNotSupportedError(language: string, supportedLanguages: string[]): AppError {
  return new AppError(
    ErrorType.LANGUAGE_NOT_SUPPORTED,
    `Language '${language}' is not supported for this tour`,
    404,
    { language, supportedLanguages }
  );
}

/**
 * Create a WebRTC offer not found error
 */
export function createOfferNotFoundError(language: string, tourId: string): AppError {
  return new AppError(
    ErrorType.WEBRTC_OFFER_NOT_FOUND,
    `WebRTC offer not found for language '${language}'`,
    404,
    { language, tourId }
  );
}

/**
 * Create a WebRTC offer invalid error
 */
export function createInvalidOfferError(message: string, details?: any): AppError {
  return new AppError(
    ErrorType.WEBRTC_OFFER_INVALID,
    message,
    400,
    details
  );
}

/**
 * Create a Redis transaction failed error
 */
export function createRedisTransactionError(message: string, details?: any): AppError {
  return new AppError(
    ErrorType.REDIS_TRANSACTION_FAILED,
    message,
    500,
    details
  );
}

/**
 * Create a server error
 */
export function createServerError(message: string = 'Internal server error', details?: any): AppError {
  return new AppError(
    ErrorType.SERVER_ERROR,
    message,
    500,
    details
  );
}

/**
 * Handle an error and return a standardized response
 * 
 * @param error The error to handle
 * @param logPrefix Optional prefix for logging
 * @returns Standardized error object for API responses
 */
export function handleError(error: any, logPrefix: string = 'ERROR'): { 
  error: string; 
  message: string; 
  status: number; 
  details?: any;
} {
  // If it's already an AppError, just return its JSON representation
  if (error instanceof AppError) {
    console.error(`${logPrefix} ${error.type}: ${error.message}`, error.details);
    return error.toJSON();
  }
  
  // Handle standard errors
  if (error instanceof Error) {
    console.error(`${logPrefix} ${error.name}: ${error.message}`, error.stack);
    return {
      error: ErrorType.UNKNOWN,
      message: error.message,
      status: 500
    };
  }
  
  // Handle unknown errors
  console.error(`${logPrefix} Unknown error:`, error);
  return {
    error: ErrorType.UNKNOWN,
    message: String(error),
    status: 500
  };
}

/**
 * Wrap an async function with error handling
 * 
 * @param fn The async function to wrap
 * @param logPrefix Optional prefix for logging
 * @returns A function that handles errors
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  logPrefix: string = 'ERROR'
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(`${logPrefix} Error in function:`, error);
      throw error instanceof AppError ? error : createServerError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };
}
