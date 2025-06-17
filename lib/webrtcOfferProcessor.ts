/**
 * WebRTC Offer Processing Utility
 * 
 * This module provides comprehensive utilities for processing WebRTC offers,
 * including placeholder detection, SDP validation, polling with exponential backoff,
 * and offer formatting for the tour translation system.
 * 
 * Expert Implementation: 989b63a2-00a4-4fcc-a1e4-6cf8f328f40f
 */

import { validateSdpOffer, isPlaceholderOffer } from './sdpUtils';

export interface OfferProcessingOptions {
  maxAttempts?: number;
  initialPollInterval?: number;
  maxPollInterval?: number;
  backoffFactor?: number;
  enableLogging?: boolean;
}

export interface OfferProcessingResult {
  success: boolean;
  offer?: RTCSessionDescriptionInit;
  isPlaceholder?: boolean;
  error?: string;
  attempts?: number;
  streamReady: boolean;
}

export interface PlaceholderOfferResponse {
  tourId: string;
  offer: RTCSessionDescriptionInit;
  streamReady: boolean;
  placeholder: boolean;
  message: string;
}

/**
 * Default configuration for offer processing
 */
const DEFAULT_OPTIONS: Required<OfferProcessingOptions> = {
  maxAttempts: 8,
  initialPollInterval: 500,
  maxPollInterval: 3000,
  backoffFactor: 1.5,
  enableLogging: true
};

/**
 * Enhanced placeholder detection with multiple validation patterns
 */
export function detectPlaceholderOffer(parsedOffer: any): boolean {
  if (!parsedOffer || typeof parsedOffer !== 'object') {
    return true;
  }

  return (
    // Status-based detection
    (parsedOffer.status === 'pending') ||
    
    // Content-based detection
    (parsedOffer.offer && typeof parsedOffer.offer === 'string' &&
     parsedOffer.offer.includes('Initialized offer for')) ||
    
    // SDP validation - missing valid SDP content
    (parsedOffer.sdp && typeof parsedOffer.sdp === 'string' &&
     !parsedOffer.sdp.includes('v=')) ||
     
    // Structure validation - incomplete offer
    (!parsedOffer.type || !parsedOffer.sdp)
  );
}

/**
 * Validates and formats SDP offer for WebRTC consumption
 */
export function formatWebRTCOffer(parsedOffer: any): RTCSessionDescriptionInit | null {
  // If it's already a proper RTCSessionDescription object
  if (parsedOffer && typeof parsedOffer === 'object' && parsedOffer.type && parsedOffer.sdp) {
    // Validate SDP content
    if (typeof parsedOffer.sdp === 'string') {
      if (parsedOffer.sdp.includes('v=')) {
        return parsedOffer;
      } else {
        // Try to extract valid SDP if it's embedded
        const potentialSdp = parsedOffer.sdp.match(/v=0[\s\S]*m=audio/g);
        if (potentialSdp) {
          return {
            type: parsedOffer.type,
            sdp: potentialSdp[0]
          };
        }
      }
    }
  }
  
  // If it's just an SDP string
  if (typeof parsedOffer === 'string' && parsedOffer.includes('v=0')) {
    return {
      type: 'answer',
      sdp: parsedOffer
    };
  }
  
  return null;
}

/**
 * Creates a placeholder offer response for when guide hasn't started broadcasting
 */
export function createPlaceholderResponse(tourId: string): PlaceholderOfferResponse {
  return {
    tourId,
    offer: {
      type: 'answer',
      sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Placeholder\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\nc=IN IP4 0.0.0.0\r\na=inactive\r\n"
    },
    streamReady: false,
    placeholder: true,
    message: "Guide has not started broadcasting yet. Please try again later."
  };
}

/**
 * Polls for a valid WebRTC offer with exponential backoff
 */
export async function pollForValidOffer(
  redisClient: any,
  offerKey: string,
  options: OfferProcessingOptions = {}
): Promise<OfferProcessingResult> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const logPrefix = config.enableLogging ? '[OFFER-POLL]' : '';
  
  let attempts = 0;
  let pollInterval = config.initialPollInterval;
  
  while (attempts < config.maxAttempts) {
    attempts++;
    
    if (config.enableLogging) {
      console.log(`${logPrefix} Polling attempt ${attempts}/${config.maxAttempts} (interval: ${pollInterval}ms)...`);
    }
    
    // Wait before trying again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    
    // Increase interval for next attempt (exponential backoff)
    pollInterval = Math.min(pollInterval * config.backoffFactor, config.maxPollInterval);
    
    try {
      // Try to get the offer again
      const freshOfferJson = await redisClient.get(offerKey);
      if (!freshOfferJson) {
        if (config.enableLogging) {
          console.log(`${logPrefix} Still no offer available after polling`);
        }
        continue;
      }
      
      const freshOffer = JSON.parse(freshOfferJson);
      
      // Check if it's still a placeholder
      if (detectPlaceholderOffer(freshOffer)) {
        if (config.enableLogging) {
          console.log(`${logPrefix} Still a placeholder offer after polling attempt ${attempts}`);
        }
        continue;
      }
      
      // Validate the offer
      const validation = validateSdpOffer(freshOffer);
      if (!validation.isValid) {
        if (config.enableLogging) {
          console.log(`${logPrefix} Invalid offer after polling: ${validation.error}`);
        }
        continue;
      }
      
      // Format the offer
      const formattedOffer = formatWebRTCOffer(freshOffer);
      if (!formattedOffer) {
        if (config.enableLogging) {
          console.log(`${logPrefix} Could not format offer after polling`);
        }
        continue;
      }
      
      if (config.enableLogging) {
        console.log(`${logPrefix} Found valid offer after ${attempts} attempts!`);
      }
      
      return {
        success: true,
        offer: formattedOffer,
        isPlaceholder: false,
        attempts,
        streamReady: true
      };
      
    } catch (error) {
      if (config.enableLogging) {
        console.error(`${logPrefix} Error parsing fresh offer:`, error);
      }
    }
  }
  
  return {
    success: false,
    error: `Failed to get valid offer after ${config.maxAttempts} attempts`,
    attempts,
    streamReady: false
  };
}

/**
 * Main function to process WebRTC offers with comprehensive validation and polling
 */
export async function processWebRTCOffer(
  redisClient: any,
  offerKey: string,
  tourId: string,
  language: string,
  options: OfferProcessingOptions = {}
): Promise<OfferProcessingResult> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const logPrefix = config.enableLogging ? `[ATTENDEE] [${language.toUpperCase()}]` : '';
  
  try {
    // Get the initial offer
    const offerJson = await redisClient.get(offerKey);
    
    if (!offerJson) {
      if (config.enableLogging) {
        console.log(`${logPrefix} No offer available for tour ${tourId}, language ${language}`);
      }
      return {
        success: false,
        error: "No offer available",
        streamReady: false
      };
    }
    
    if (config.enableLogging) {
      console.log(`${logPrefix} Raw offer JSON from Redis: ${offerJson.substring(0, 200)}${offerJson.length > 200 ? '...' : ''}`);
    }
    
    // Parse the offer
    const parsedOffer = JSON.parse(offerJson);
    
    // Check if it's a placeholder
    if (detectPlaceholderOffer(parsedOffer)) {
      if (config.enableLogging) {
        console.log(`${logPrefix} Detected placeholder offer, attempting to poll for real offer...`);
      }
      
      // Poll for a valid offer
      const pollResult = await pollForValidOffer(redisClient, offerKey, config);
      
      if (!pollResult.success) {
        return {
          success: false,
          isPlaceholder: true,
          error: pollResult.error,
          attempts: pollResult.attempts,
          streamReady: false
        };
      }
      
      return pollResult;
    }
    
    // Validate the offer
    const validation = validateSdpOffer(parsedOffer);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid SDP offer: ${validation.error}`,
        streamReady: false
      };
    }
    
    // Format the offer
    const formattedOffer = formatWebRTCOffer(parsedOffer);
    if (!formattedOffer) {
      return {
        success: false,
        error: "Could not format WebRTC offer",
        streamReady: false
      };
    }
    
    if (config.enableLogging) {
      console.log(`${logPrefix} Successfully processed offer with type: ${formattedOffer.type}`);
    }
    
    return {
      success: true,
      offer: formattedOffer,
      isPlaceholder: false,
      streamReady: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (config.enableLogging) {
      console.error(`${logPrefix} Error processing WebRTC offer:`, errorMessage);
    }
    
    return {
      success: false,
      error: `Failed to process offer: ${errorMessage}`,
      streamReady: false
    };
  }
}
