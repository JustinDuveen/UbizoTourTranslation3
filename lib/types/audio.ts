/**
 * TypeScript interfaces for audio system parameter validation
 * EXPERT FIX: Centralized type definitions for consistent parameter handling
 */

// Core parameter types
export interface TourConnectionParams {
  readonly tourId: string;
  readonly attendeeId: string;
  readonly language: string;
  readonly tourCode?: string;
}

export interface WebRTCConnectionConfig {
  readonly tourId: string;
  readonly attendeeId: string;
  readonly normalizedLanguage: string;
  readonly signalingEndpoints: readonly string[];
}

export interface AudioStreamParams {
  readonly tourId: string;
  readonly language: string;
  readonly attendeeId?: string;
  readonly isGuide: boolean;
}

// Validation result types  
export interface ParameterValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly normalizedParams?: TourConnectionParams;
}

// Redis key validation
export type RedisKeyPattern = 
  | `tour:${string}`
  | `ice:${string}:${string}:${string}:${string}`
  | `tour_codes:${string}`;

// Audio connection states
export type ConnectionState = 
  | 'idle'
  | 'connecting' 
  | 'connected'
  | 'failed'
  | 'waiting'
  | 'guide_not_ready';

// Error types for parameter mismatches
export class ParameterMismatchError extends Error {
  constructor(
    readonly parameter: string,
    readonly expected: string,
    readonly received: string
  ) {
    super(`Parameter mismatch: ${parameter}. Expected: ${expected}, Received: ${received}`);
    this.name = 'ParameterMismatchError';
  }
}

export class AttendeeIdValidationError extends Error {
  constructor(attendeeId: string, reason: string) {
    super(`Invalid attendeeId: ${attendeeId}. Reason: ${reason}`);
    this.name = 'AttendeeIdValidationError';
  }
}