/**
 * SDP (Session Description Protocol) validation utilities
 * Separated from languageUtils.ts to improve compilation performance
 */

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

  return isPlaceholder;
}
