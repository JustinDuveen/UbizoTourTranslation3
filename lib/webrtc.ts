// Connection state interface
interface ConnectionState {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  tourCode: string;
  keyRefreshTimer: NodeJS.Timeout | null;
  audioContext?: AudioContext;
  audioWorklet?: AudioWorkletNode;  // Track audio processing nodes
  mediaStream?: MediaStream;        // Track media stream
  reconnectAttempt: number;
  isReconnecting: boolean;
  reconnectTimeout?: NodeJS.Timeout;
  statsInterval?: NodeJS.Timeout;   // For connection quality monitoring
  connectionStartTime?: number;     // Timestamp when connection was established
}

// Audio cleanup helper functions
function cleanupAudioElement(audioEl: HTMLAudioElement) {
  // Stop all tracks in the media stream
  const mediaStream = audioEl.srcObject as MediaStream;
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
      mediaStream.removeTrack(track);
    });
  }

  // Clear source and remove element
  audioEl.srcObject = null;
  audioEl.remove();
}

function cleanupAudioContext(audioContext: AudioContext | undefined) {
  if (!audioContext) return;

  // Suspend audio context first
  if (audioContext.state !== 'closed') {
    audioContext.suspend().then(() => {
      try {
        // Disconnect the destination node (this disconnects all connected nodes)
        audioContext.destination.disconnect();

        // If there's a specific worklet node, disconnect it
        if (audioContext.hasOwnProperty('audioWorklet')) {
          (audioContext as any).audioWorklet?.disconnect();
        }
      } catch (err) {
        console.error('Error disconnecting audio nodes:', err);
      }

      // Close the context
      if (audioContext.state !== 'closed') {
        audioContext.close();
      }
    }).catch(err => {
      console.error('Error cleaning up audio context:', err);
      // Force close if suspend fails
      if (audioContext.state !== 'closed') {
        audioContext.close();
      }
    });
  }
}

// Reconnection configuration
const RECONNECTION_CONFIG = {
  MAX_ATTEMPTS: 5,          // Maximum number of reconnection attempts
  INITIAL_DELAY: 1000,      // Start with 1 second delay
  MAX_DELAY: 32000,         // Cap maximum delay at 32 seconds
  BACKOFF_FACTOR: 2,        // Double the delay after each attempt
  JITTER: 0.1              // Add 10% random jitter to prevent thundering herd
};

// Global connections manager
const connections = new Map<string, ConnectionState>();

// Audio configuration
const AUDIO_CODEC_PREFERENCES = [
  'opus/48000/2',
  'PCMU/8000',
  'PCMA/8000'
];

interface WebRTCOptions {
  onTranslation: (text: string) => void;
  language: string;
  tourCode: string;
  attendeeName: string;
  signal?: AbortSignal;
}

export async function initWebRTC(options: WebRTCOptions) {
  const { onTranslation, language, tourCode, attendeeName, signal } = options;

  console.log(`Initializing WebRTC for language: ${language}, tour code: ${tourCode}`);

  if (!tourCode) {
    const error = new Error('Missing tour code for WebRTC initialization');
    console.error(error);
    throw error;
  }

  // Store attendee name for reconnection attempts
  if (attendeeName) {
    localStorage.setItem('attendeeName', attendeeName);
  }

  try {
      // 1. Initialize connection and fetch offer with attendee name
      console.log(`Step 1: Fetching tour offer for ${language}`);
      const { offer, tourId, placeholder } = await fetchTourOffer(tourCode, language, attendeeName);
      console.log(`Received tourId: ${tourId} for tour code: ${tourCode}`);
      localStorage.setItem('currentTourId', tourId);

      // Check if we received a placeholder response
      if (placeholder) {
        console.warn(`Received placeholder offer for ${language}, guide may not be broadcasting yet`);
        // Throw a specific error that can be caught by the UI
        throw new Error('PLACEHOLDER_OFFER_RECEIVED');
      }

      // 2. Set up ephemeral key refresh
      console.log(`Step 2: Setting up key refresh for ${language}`);
      const keyRefreshTimerId = setupKeyRefresh(language);

      // 3. Create optimized peer connection
      console.log(`Step 3: Creating peer connection for ${language}`);
      const { pc, audioEl } = createPeerConnection(language, tourCode, onTranslation);

      // 4. Configure media handlers
      console.log(`Step 4: Setting up media handlers for ${language}`);
      setupMediaHandlers(pc, audioEl, onTranslation);

      // 5. Complete signaling
      console.log(`Step 5: Completing signaling for ${language} with tourId: ${tourId}`);
      await completeSignaling(pc, language, tourId);
      console.log(`Signaling completed successfully for ${language}`);

      // 6. Update connection with all audio-related properties
      console.log(`Step 6: Updating connection state for ${language}`);
      const existingConnection = connections.get(language);
      if (existingConnection) {
        existingConnection.keyRefreshTimer = keyRefreshTimerId;
      } else {
        // This shouldn't happen as createPeerConnection already sets the connection,
        // but just in case, create a new entry
        connections.set(language, {
            pc,
            audioEl,
            tourCode,
            keyRefreshTimer: keyRefreshTimerId,
            audioContext: undefined,
            audioWorklet: undefined,
            mediaStream: undefined,
            reconnectAttempt: 0,
            isReconnecting: false
        });
      }
      console.log(`WebRTC initialization completed successfully for ${language}`);

      // 7. Set up connection quality monitoring
      console.log(`Step 7: Setting up connection quality monitoring for ${language}`);
      setupConnectionQualityMonitoring(language, onTranslation);

      // Cleanup on abort
      signal?.addEventListener('abort', () => {
        console.log(`Abort signal received for ${language}, cleaning up connection`);
        cleanupConnection(language);
      });

  } catch (error) {
      console.error(`WebRTC initialization error for ${language}:`, error);

      // Handle specific error types
      if (error instanceof Error) {
        if (error.message === 'PLACEHOLDER_OFFER_RECEIVED') {
          console.log(`Placeholder offer received for ${language}, will retry later`);
          // Schedule a retry after a delay
          setTimeout(() => {
            console.log(`Retrying connection for ${language} after placeholder offer`);
            // This will be caught by the UI's retry mechanism
          }, 5000);
        }
      }

      // Clean up any partial connections
      const connection = connections.get(language);
      if (connection) {
        console.log(`Cleaning up partial connection for ${language} due to error`);
        cleanupConnection(language);
      }
      throw error;
  }
}

// ========== Helper Functions ========== //

/**
 * Validates and formats SDP data for WebRTC
 * @param offerData - The offer data from the server
 * @returns A properly formatted RTCSessionDescriptionInit object
 */
function validateAndFormatSDP(offerData: any): RTCSessionDescriptionInit {
  console.log('Validating SDP format:', typeof offerData);

  // Debug: Log more details about the offer data
  if (typeof offerData === 'object') {
    console.log('Offer data keys:', Object.keys(offerData).join(', '));
    if (offerData.sdp) {
      console.log('SDP content preview:', offerData.sdp.substring(0, 100));
      console.log('SDP contains v=:', offerData.sdp.includes('v='));
    }
  } else if (typeof offerData === 'string') {
    console.log('Offer data string preview:', offerData.substring(0, 100));
  }

  // Enhanced check for placeholder offers
  if (offerData && typeof offerData === 'object') {
    // Detect placeholder offers with various patterns
    const isPlaceholder =
      // Check for pending status
      (offerData.status === 'pending') ||
      // Check for initialized offer message
      (offerData.offer && typeof offerData.offer === 'string' &&
       offerData.offer.includes('Initialized offer for')) ||
      // Check for offer object with tourId and language but no valid SDP
      (offerData.tourId && offerData.language && !offerData.sdp) ||
      // Check for invalid SDP content
      (offerData.sdp && typeof offerData.sdp === 'string' && !offerData.sdp.includes('v='));

    if (isPlaceholder) {
      console.error('Received placeholder offer, guide has not started broadcasting yet');
      console.log('Placeholder offer details:', JSON.stringify(offerData).substring(0, 200));
      console.log('Will attempt to poll for a real offer...');
      throw new Error('PLACEHOLDER_OFFER');
    }
  }

  // If it's already a proper RTCSessionDescriptionInit object with type and sdp
  if (offerData && typeof offerData === 'object' && offerData.type && offerData.sdp) {
    // Verify the SDP is valid (should start with v=)
    if (typeof offerData.sdp === 'string' && offerData.sdp.includes('v=')) {
      console.log('SDP already in correct format');
      return offerData;
    } else {
      console.error('SDP has type and sdp properties but sdp content is invalid');
      console.error('Invalid SDP content:', offerData.sdp);
      throw new Error('Invalid SDP content in offer');
    }
  }

  // If it's a string, try to parse it as JSON
  if (typeof offerData === 'string') {
    try {
      const parsedOffer = JSON.parse(offerData);
      console.log('Parsed SDP from string:', parsedOffer);

      // Check for placeholder in parsed JSON
      if (parsedOffer && parsedOffer.status === 'pending') {
        console.error('Received placeholder offer, guide has not started broadcasting yet');
        throw new Error('The guide has not started broadcasting in this language yet. Please wait and try again.');
      }

      if (parsedOffer && parsedOffer.type && parsedOffer.sdp) {
        // Verify the SDP is valid
        if (typeof parsedOffer.sdp === 'string' && parsedOffer.sdp.includes('v=')) {
          return parsedOffer;
        } else {
          console.error('Parsed SDP has invalid content');
          throw new Error('Invalid SDP content in parsed offer');
        }
      }

      // If it's just an SDP string without type
      if (typeof parsedOffer === 'string' && parsedOffer.includes('v=0')) {
        console.log('Converting raw SDP string to proper format');
        return {
          type: 'answer',
          sdp: parsedOffer
        };
      }
    } catch (e) {
      // If it's not valid JSON but looks like an SDP string
      if (offerData.includes('v=0')) {
        console.log('Using raw SDP string');
        return {
          type: 'answer',
          sdp: offerData
        };
      }
    }
  }

  // If we couldn't parse it properly
  console.error('Invalid SDP format:', offerData);
  throw new Error('Invalid SDP format in offer');
}

async function fetchTourOffer(tourCode: string, language: string, attendeeName: string) {
  console.log(`Fetching tour offer for code: ${tourCode}, language: ${language}`);

  if (!tourCode) {
    console.error('Cannot fetch tour offer: Missing tour code');
    throw new Error('Missing tour code');
  }

  try {
    const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}&attendeeName=${encodeURIComponent(attendeeName)}`);

    if (!response.ok) {
      let errorMessage = `Failed to join tour: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        console.error('Tour offer error:', errorData);
        errorMessage += ` - ${errorData.error || 'Unknown error'}`;
      } catch (e) {
        const errorText = await response.text();
        console.error(`Failed to parse error response: ${errorText}`);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log(`Tour offer response received with tourId: ${data.tourId}`);

    // Check for placeholder flag
    if (data.placeholder) {
      console.log(`Received placeholder offer, guide has not started broadcasting yet`);
      return { ...data, placeholder: true };
    }

    if (!data.offer) {
      console.log(`No offer available yet, polling for offer...`);
      return await pollForOffer(tourCode, language, attendeeName);
    }

    // Check if the offer is a placeholder by examining its content
    if (data.offer && typeof data.offer === 'object') {
      const offerObj = data.offer;

      // Check for common placeholder patterns
      if (offerObj.status === 'pending' ||
          (offerObj.offer && typeof offerObj.offer === 'string' &&
           offerObj.offer.includes('Initialized offer for'))) {
        console.log(`Detected placeholder offer in response`);
        return { ...data, placeholder: true };
      }

      // Check for invalid SDP
      if (offerObj.sdp && typeof offerObj.sdp === 'string' && !offerObj.sdp.includes('v=')) {
        console.log(`Detected invalid SDP in offer (missing v= marker)`);
        return { ...data, placeholder: true };
      }
    }

    return data;
  } catch (error) {
    console.error(`Error fetching tour offer:`, error);
    throw error;
  }
}

async function pollForOffer(tourCode: string, language: string, attendeeName: string) {
  const MAX_ATTEMPTS = 24; // 2 minutes max
  const POLL_INTERVAL = 5000; // 5 seconds
  let attempts = 0;

  console.log(`Polling for offer - tour code: ${tourCode}, language: ${language}`);

  if (!tourCode) {
    console.error('Cannot poll for offer: Missing tour code');
    throw new Error('Missing tour code for polling');
  }

  while (attempts++ < MAX_ATTEMPTS) {
    try {
      console.log(`Poll attempt ${attempts}/${MAX_ATTEMPTS} for tour code: ${tourCode}`);
      const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}&attendeeName=${encodeURIComponent(attendeeName)}`);

      if (!response.ok) {
        let errorMessage = '';
        try {
          const errorData = await response.json();
          console.warn(`Offer poll failed:`, errorData);
          errorMessage = errorData.error || 'Unknown error';

          if (response.status === 404) {
            throw new Error('Tour ended or invalid');
          }
        } catch (e) {
          console.warn(`Failed to parse error response: ${e}`);
        }
        console.log(`Continuing poll after error: ${errorMessage}`);
        continue;
      }

      const data = await response.json();

      // Check if we have an offer
      if (data.offer) {
        // Check if it's a placeholder offer
        if (data.offer.status === 'pending' ||
            (data.offer.offer && typeof data.offer.offer === 'string' &&
             data.offer.offer.includes('Initialized offer for'))) {
          console.log(`Received placeholder offer for ${language}, guide hasn't started broadcasting yet (attempt ${attempts}/${MAX_ATTEMPTS})...`);
        } else {
          // We have a real offer
          console.log(`Valid WebRTC offer received for ${language} on attempt ${attempts}`);
          return data;
        }
      } else {
        // No offer at all
        console.log(`No offer available yet for ${language} (attempt ${attempts}/${MAX_ATTEMPTS})...`);
      }

      // If no offer but stream is initializing, continue polling
      if (data.streamReady === false) {
        console.log(`Waiting for audio stream setup (attempt ${attempts}/${MAX_ATTEMPTS})...`);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error(`Error polling for offer:`, error);
        if (error.message === 'Tour ended or invalid') {
          throw error;
        }
      } else {
        console.error(`Unknown error while polling for offer:`, error);
      }
    }

    // Show a more informative message as we continue polling
    const remainingTime = (MAX_ATTEMPTS - attempts) * (POLL_INTERVAL / 1000);
    console.log(`Waiting ${POLL_INTERVAL/1000} seconds before next poll attempt... (${Math.round(remainingTime)}s remaining)`);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error(`Timed out waiting for the guide to start broadcasting in ${language}. Please try again later.`);
}

function setupKeyRefresh(language: string): NodeJS.Timeout {
  return setInterval(async () => {
      try {
          const response = await fetch("/api/session", { credentials: "include" });
          if (response.ok) {
              const data = await response.json();
              console.log(`Key refreshed for ${language}`);
          }
      } catch (error) {
          console.error(`Key refresh failed for ${language}:`, error);
      }
  }, 45000);
}

/**
 * Sets up monitoring for WebRTC connection quality
 * @param language The language of the connection to monitor
 * @param setTranslation Callback for translation updates
 */
function setupConnectionQualityMonitoring(language: string, setTranslation: (text: string) => void) {
  const connection = connections.get(language);
  if (!connection) {
    console.error(`Cannot set up monitoring: No connection found for ${language}`);
    return;
  }

  const { pc } = connection;

  // Set up periodic stats collection
  const statsInterval = setInterval(async () => {
    if (!pc || pc.connectionState === 'closed') {
      clearInterval(statsInterval);
      return;
    }

    try {
      const stats = await pc.getStats();
      let hasActiveAudio = false;
      let packetsLost = 0;
      let packetsReceived = 0;
      let audioLevel = 0;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsReceived = report.packetsReceived || 0;
          packetsLost = report.packetsLost || 0;
          hasActiveAudio = packetsReceived > 0;

          // Calculate packet loss percentage
          const totalPackets = packetsReceived + packetsLost;
          const lossRate = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

          if (lossRate > 15) {
            console.warn(`${language}: High packet loss detected (${lossRate.toFixed(2)}%)`);
          }
        }

        if (report.type === 'media-source' && report.kind === 'audio') {
          audioLevel = report.audioLevel || 0;
        }
      });

      // Check for audio activity
      if (!hasActiveAudio && pc.connectionState === 'connected') {
        console.warn(`${language}: No audio packets received despite connected state`);

        // If we've been connected for a while but have no audio, try reconnecting
        const connectionTime = Date.now() - (connection.connectionStartTime || Date.now());
        if (connectionTime > 10000) { // 10 seconds
          console.warn(`${language}: No audio after 10s of connection, attempting recovery...`);
          reconnect(setTranslation, language);
        }
      }
    } catch (error) {
      console.error(`${language}: Error collecting connection stats:`, error);
    }
  }, 5000); // Check every 5 seconds

  // Store the interval for cleanup
  connection.statsInterval = statsInterval;

  // Set connection start time for monitoring
  connection.connectionStartTime = Date.now();
}

// Helper functions for reconnection logic
function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = RECONNECTION_CONFIG.INITIAL_DELAY *
    Math.pow(RECONNECTION_CONFIG.BACKOFF_FACTOR, attempt);
  const jitter = exponentialDelay * RECONNECTION_CONFIG.JITTER * Math.random();
  return Math.min(exponentialDelay + jitter, RECONNECTION_CONFIG.MAX_DELAY);
}

function resetReconnectionState(language: string) {
  const connection = connections.get(language);
  if (connection) {
    connection.reconnectAttempt = 0;
    connection.isReconnecting = false;
    if (connection.reconnectTimeout) {
      clearTimeout(connection.reconnectTimeout);
      connection.reconnectTimeout = undefined;
    }
  }
}

function createPeerConnection(language: string, tourCode: string, setTranslation: (text: string) => void) {
  console.log(`Creating peer connection for language: ${language}, tour code: ${tourCode}`);

  if (!tourCode) {
    console.error('Cannot create peer connection: Missing tour code');
    throw new Error('Missing tour code for WebRTC connection');
  }

  const pc = new RTCPeerConnection({
      iceServers: [
          { urls: 'turn:192.168.245.82:3478', username: 'username1', credential: 'password1' },
          { urls: 'turn:192.168.245.82:443', username: 'username1', credential: 'password1' },
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
          { urls: "stun:stun4.l.google.com:19302" }
      ]
  });

  const audioEl = new Audio();
  audioEl.autoplay = true;

  // Store initial connection state with all audio-related properties
  const connectionState: ConnectionState = {
    pc,
    audioEl,
    tourCode, // Store the public tour code, not the internal tourId
    keyRefreshTimer: null,
    audioContext: undefined,
    audioWorklet: undefined,
    mediaStream: undefined,
    reconnectAttempt: 0,
    isReconnecting: false
  };

  // Store the connection state in the global map
  connections.set(language, connectionState);
  console.log(`Connection state stored for language: ${language} with tour code: ${tourCode}`);

  // Connection state handlers
  pc.oniceconnectionstatechange = () => {
    if (["disconnected", "failed"].includes(pc.iceConnectionState)) {
      reconnect(setTranslation, language);
    } else if (pc.iceConnectionState === "connected") {
      // Reset reconnection state when connection is restored
      resetReconnectionState(language);
    }
  };

  return { pc, audioEl };
}

function setupMediaHandlers(pc: RTCPeerConnection, audioEl: HTMLAudioElement, setTranslation: (text: string) => void) {
  // Media track handler with enhanced audio setup
  pc.ontrack = async (event) => {
    if (event.track.kind === 'audio') {
      try {
        // Store media stream reference for cleanup
        const mediaStream = event.streams[0];
        const connection = Array.from(connections.values())
          .find(conn => conn.audioEl === audioEl);

        if (connection) {
          // Clean up any existing stream
          if (connection.mediaStream) {
            connection.mediaStream.getTracks().forEach(track => {
              track.stop();
              connection.mediaStream?.removeTrack(track);
            });
          }

          connection.mediaStream = mediaStream;

          // Create AudioContext for better audio handling
          if (!connection.audioContext || connection.audioContext.state === 'closed') {
            connection.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          }

          if (connection.audioContext.state === 'suspended') {
            await connection.audioContext.resume();
          }

          // Connect audio processing chain
          const source = connection.audioContext.createMediaStreamSource(mediaStream);
          const gainNode = connection.audioContext.createGain();
          gainNode.gain.value = 1.0; // Adjustable volume

          source.connect(gainNode);
          gainNode.connect(connection.audioContext.destination);
        }

        // Set up audio element
        audioEl.srcObject = mediaStream;
        await audioEl.play().catch(async e => {
          console.warn("Autoplay blocked:", e);
          // Attempt to handle autoplay blocking
          document.addEventListener('click', () => {
            audioEl.play().catch(console.error);
          }, { once: true });
        });

        // Monitor audio track state
        event.track.onended = () => {
          console.log('Audio track ended');
          if (mediaStream) {
            mediaStream.removeTrack(event.track);
          }
          // Trigger reconnection if track ends unexpectedly
          if (pc.connectionState === 'connected') {
            console.log('Unexpected track end, attempting recovery...');
            const connEntry = Array.from(connections.entries())
              .find(([_, conn]) => conn.audioEl === audioEl);
            if (connEntry) {
              reconnect(setTranslation, connEntry[0]);
            }
          }
        };

        // Monitor audio levels to detect silence
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(analyser);

        const checkAudioLevels = () => {
          if (!analyser) return;
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(dataArray);
          const silence = dataArray.every(value => value === 0);

          if (silence && pc.connectionState === 'connected') {
            console.log('Detected silence, checking connection...');
            pc.getStats().then(stats => {
              let hasActiveAudio = false;
              stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                  hasActiveAudio = report.packetsReceived > 0;
                }
              });
              if (!hasActiveAudio) {
                console.log('No audio packets received, attempting recovery...');
                const connEntry = Array.from(connections.entries())
                  .find(([_, conn]) => conn.audioEl === audioEl);
                if (connEntry) {
                  reconnect(setTranslation, connEntry[0]);
                }
              }
            });
          }
        };

        // Check audio levels periodically
        const audioMonitorInterval = setInterval(checkAudioLevels, 5000);
        connection?.audioEl.addEventListener('ended', () => clearInterval(audioMonitorInterval));

      } catch (error) {
        console.error('Error setting up audio stream:', error);
        // Attempt recovery
        const connEntry = Array.from(connections.entries())
          .find(([_, conn]) => conn.audioEl === audioEl);
        if (connEntry) {
          reconnect(setTranslation, connEntry[0]);
        }
      }
    }
  };

  // Data channel handler (primarily for debugging and status updates)
  pc.ondatachannel = (event) => {
    const dc = event.channel;
    dc.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data);
        if (message.type === 'status') {
          console.log('Stream status:', message);
        }
        // Keep setTranslation for backward compatibility
        if (message.type?.includes('translation') && message.text) {
          setTranslation(message.text);
        }
      } catch (error) {
        console.error('Error handling data channel message:', error);
      }
    };
  };
}

function handleDataMessage(event: MessageEvent, setTranslation: (text: string) => void) {
  try {
      const message = JSON.parse(event.data);
      if (message.type.includes('translation') && message.text) {
          setTranslation(message.text);
      }
  } catch (error) {
      console.error("Message handling error:", error);
  }
}

async function completeSignaling(pc: RTCPeerConnection, language: string, tourId: string) {
  // Get the tour code from the connection state
  const connection = Array.from(connections.values())
    .find(conn => conn.pc === pc);

  if (!connection || !connection.tourCode) {
    console.error('Cannot complete signaling: Missing tour code in connection state');
    throw new Error('Missing tour code for WebRTC connection');
  }

  console.log(`Completing WebRTC signaling for language: ${language}, using tour code: ${connection.tourCode}`);

  // Set remote description - use the public tour code, not the internal tourId
  const offerResponse = await fetch(`/api/tour/join?tourCode=${encodeURIComponent(connection.tourCode)}&language=${encodeURIComponent(language)}`);
  if (!offerResponse.ok) {
    const errorData = await offerResponse.json();
    console.error('Failed to join tour:', errorData);

    // Handle specific error cases
    if (errorData.error === "Inactive tour") {
      console.log(`Tour ${errorData.tourId} is inactive. Status: ${errorData.status || 'unknown'}`);
      throw new Error(`Tour is no longer active. Please ask the guide to restart the tour.`);
    } else if (errorData.error === "Invalid tour code") {
      console.log(`Invalid tour code: ${connection.tourCode}`);
      throw new Error(`Invalid tour code. Please check and try again.`);
    } else if (errorData.error === "Language not supported") {
      console.log(`Language ${language} not supported for this tour. Supported languages: ${JSON.stringify(errorData.supportedLanguages)}`);
      throw new Error(`Language ${language} is not supported for this tour. Available languages: ${errorData.supportedLanguages?.join(', ') || 'none'}.`);
    } else {
      // Generic error
      throw new Error(`Failed to join tour: ${errorData.error || offerResponse.statusText}`);
    }
  }

  try {
    const offerData = await offerResponse.json();
    console.log(`Received offer data:`, offerData);

    if (!offerData.offer) {
      console.error('No offer found in response');
      throw new Error('No WebRTC offer available');
    }

    // Debug: Log the raw offer data before validation
    console.log(`Raw offer data type:`, typeof offerData.offer);
    if (typeof offerData.offer === 'object') {
      console.log(`Offer object keys:`, Object.keys(offerData.offer).join(', '));
      if (offerData.offer.sdp) {
        console.log(`SDP preview:`, offerData.offer.sdp.substring(0, 100));
      }
    }

    // Handle placeholder offers with polling
    let validOffer;
    try {
      // Try to validate the offer
      validOffer = validateAndFormatSDP(offerData.offer);
    } catch (validationError) {
      // Check if it's a placeholder offer
      if (validationError instanceof Error && validationError.message === 'PLACEHOLDER_OFFER') {
        console.log('Detected placeholder offer, will poll for a real offer');

        // Enhanced polling for a real offer with exponential backoff
        let attempts = 0;
        const maxAttempts = 15; // Increased from 10
        let pollInterval = 500; // Start with 500ms
        const maxPollInterval = 5000; // Cap at 5 seconds
        const backoffFactor = 1.5; // Exponential backoff factor

        while (attempts < maxAttempts) {
          attempts++;
          console.log(`Polling for real offer, attempt ${attempts}/${maxAttempts} (interval: ${pollInterval}ms)...`);

          // Wait before trying again with current interval
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          // Increase interval for next attempt (with exponential backoff)
          pollInterval = Math.min(pollInterval * backoffFactor, maxPollInterval);

          // Try to get a fresh offer
          try {
            const freshResponse = await fetch(`/api/tour/join?tourCode=${encodeURIComponent(connection.tourCode)}&language=${encodeURIComponent(language)}`);
            if (!freshResponse.ok) {
              const errorText = await freshResponse.text();
              console.error(`Failed to get fresh offer on attempt ${attempts}: ${freshResponse.status} ${errorText}`);

              // If tour ended or other permanent error, stop polling
              if (freshResponse.status === 404) {
                console.error('Tour may have ended, stopping polling');
                break;
              }
              continue;
            }

            const freshData = await freshResponse.json();
            if (!freshData.offer) {
              console.log(`No offer in fresh response on attempt ${attempts}`);
              continue;
            }

            // Try to validate the fresh offer
            try {
              validOffer = validateAndFormatSDP(freshData.offer);
              console.log(`Found valid offer on attempt ${attempts}!`);
              break;
            } catch (e) {
              if (e instanceof Error && e.message === 'PLACEHOLDER_OFFER') {
                console.log(`Still a placeholder offer on attempt ${attempts}`);
              } else {
                console.error(`Validation error on attempt ${attempts}:`, e);
              }
            }
          } catch (networkError) {
            console.error(`Network error during polling attempt ${attempts}:`, networkError);
            // Continue polling despite network errors
          }
        }

        if (!validOffer) {
          console.error(`Failed to get valid offer after ${maxAttempts} attempts`);
          throw new Error(`The guide has not started broadcasting yet. Please wait and try again.`);
        }
      } else {
        // It's some other validation error
        throw validationError;
      }
    }

    // We should have a valid offer by now
    console.log(`Validated SDP offer:`, validOffer.type, validOffer.sdp?.substring(0, 50));

    // Set the remote description with the proper format
    await pc.setRemoteDescription(validOffer);
    console.log(`Remote description set successfully for ${language}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error polling for offer:`, error);
      if (error.message === 'Tour ended or invalid') {
        throw error;
      }
    } else {
      console.error(`Unknown error while polling for offer:`, error);
    }
  }

  // Create and set local answer
  const answer = await pc.createAnswer({
      offerToReceiveAudio: true,
      voiceActivityDetection: false
  });
  await pc.setLocalDescription(optimizeSdpForOpus(answer));

  // Send answer to server with retry logic
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // 1 second
  let retryCount = 0;
  let lastError;

  while (retryCount <= MAX_RETRIES) {
    try {
      console.log(`Sending answer to server for language: ${language}, tourId: ${tourId}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`);

      const response = await fetch(`/api/tour/answer?tourId=${encodeURIComponent(tourId)}&language=${encodeURIComponent(language)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              answer: pc.localDescription
          }),
          credentials: "include"
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to send answer: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Failed to send answer: ${response.status} ${response.statusText}`);
      }

      console.log(`Answer sent successfully for language: ${language}`);
      return; // Success, exit the retry loop
    } catch (error) {
      lastError = error;
      console.error(`Error sending answer to server (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, error);

      if (retryCount < MAX_RETRIES) {
        // Wait before retrying
        console.log(`Retrying in ${RETRY_DELAY/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        retryCount++;
      } else {
        // Max retries reached, throw the last error
        console.error(`Failed to send answer after ${MAX_RETRIES + 1} attempts`);
        throw lastError;
      }
    }
  }

  // ICE candidate handling
  pc.onicecandidate = (event) => {
      if (event.candidate) {
          sendIceCandidate(event.candidate, language, tourId);
      }
  };
}

function optimizeSdpForOpus(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (description.type === 'answer' || description.type === 'offer') {
      return {
          type: description.type,
          sdp: description.sdp?.replace(/a=rtpmap:(\d+) opus\/48000/i,
              'a=rtpmap:$1 opus/48000/2\r\na=fmtp:$1 stereo=1; maxplaybackrate=48000')
      };
  }
  return description;
}

async function sendIceCandidate(candidate: RTCIceCandidate, language: string, tourId: string) {
  await fetch('/api/tour/attendee-ice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate, language, tourId }),
      credentials: "include"
  });
}

async function reconnect(setTranslation: (text: string) => void, language: string) {
  const connection = connections.get(language);
  if (!connection) return;

  // Prevent multiple simultaneous reconnection attempts
  if (connection.isReconnecting) {
    console.log(`Already attempting to reconnect for ${language}`);
    return;
  }

  // Check if max attempts reached
  if (connection.reconnectAttempt >= RECONNECTION_CONFIG.MAX_ATTEMPTS) {
    console.error(`Max reconnection attempts reached for ${language}`);
    cleanupConnection(language);
    return;
  }

  connection.isReconnecting = true;
  connection.reconnectAttempt++;

  // Calculate delay based on attempt number
  const delay = calculateBackoffDelay(connection.reconnectAttempt);

  try {
    console.log(`Attempting reconnection ${connection.reconnectAttempt}/${RECONNECTION_CONFIG.MAX_ATTEMPTS} for ${language} after ${delay}ms`);

    // Set timeout for this attempt
    connection.reconnectTimeout = setTimeout(async () => {
      try {
        // Clean up existing connection
        connection.pc.close();
        if (connection.keyRefreshTimer) clearInterval(connection.keyRefreshTimer);

        // Get stored attendee name from localStorage or use a default
        const storedName = localStorage.getItem('attendeeName') || 'Anonymous';

        // Verify we have a valid tour code
        if (!connection.tourCode) {
          console.error(`Missing tour code for reconnection attempt ${connection.reconnectAttempt} for ${language}`);
          throw new Error('Missing tour code for reconnection');
        }

        console.log(`Attempting to establish new connection for ${language} with tour code: ${connection.tourCode}`);

        // Attempt to establish new connection
        await initWebRTC({
          onTranslation: setTranslation,
          language,
          tourCode: connection.tourCode,
          attendeeName: storedName
        });

        // Reset reconnection state on success
        resetReconnectionState(language);

      } catch (error) {
        console.error(`Reconnection attempt ${connection.reconnectAttempt} failed for ${language}:`, error);
        connection.isReconnecting = false;

        // Trigger next reconnection attempt
        reconnect(setTranslation, language);
      }
    }, delay);

  } catch (error) {
    console.error(`Failed to schedule reconnection for ${language}:`, error);
    connection.isReconnecting = false;
    cleanupConnection(language);
  }
}

export function cleanupWebRTC() {
  connections.forEach((connection, language) => {
    cleanupConnection(language);
  });
  connections.clear();
}

function cleanupConnection(language: string) {
  const connection = connections.get(language);
  if (!connection) return;

  try {
    // 1. Clear any pending timeouts/intervals
    if (connection.reconnectTimeout) {
      clearTimeout(connection.reconnectTimeout);
    }
    if (connection.keyRefreshTimer) {
      clearInterval(connection.keyRefreshTimer);
    }
    if (connection.statsInterval) {
      clearInterval(connection.statsInterval);
    }

    // 2. Clean up WebRTC peer connection
    if (connection.pc) {
      // Remove all tracks
      connection.pc.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      connection.pc.getReceivers().forEach(receiver => {
        if (receiver.track) {
          receiver.track.stop();
        }
      });
      // Close connection
      connection.pc.close();
    }

    // 3. Clean up audio element and its resources
    cleanupAudioElement(connection.audioEl);

    // 4. Clean up audio context and worklets
    cleanupAudioContext(connection.audioContext);

    // 5. Clean up media stream if exists
    if (connection.mediaStream) {
      connection.mediaStream.getTracks().forEach(track => {
        track.stop();
        connection.mediaStream?.removeTrack(track);
      });
    }

  } catch (error) {
    console.error(`Error during connection cleanup for ${language}:`, error);
  } finally {
    // Always remove from connections map
    connections.delete(language);
  }
}
