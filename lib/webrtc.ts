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
  try {
      // 1. Initialize connection and fetch offer with attendee name
      const { offer, tourId } = await fetchTourOffer(tourCode, language, attendeeName);
      localStorage.setItem('currentTourId', tourId);

      // 2. Set up ephemeral key refresh
      const keyRefreshTimerId = setupKeyRefresh(language);

      // 3. Create optimized peer connection
      const { pc, audioEl } = createPeerConnection(language, tourCode, onTranslation);

      // 4. Configure media handlers
      setupMediaHandlers(pc, audioEl, onTranslation);

      // 5. Complete signaling
      await completeSignaling(pc, language, tourId);

      // 6. Store connection with all audio-related properties
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

      // Cleanup on abort
      signal?.addEventListener('abort', () => cleanupConnection(language));

  } catch (error) {
      console.error(`WebRTC initialization error for ${language}:`, error);
      throw error;
  }
}

// ========== Helper Functions ========== //

async function fetchTourOffer(tourCode: string, language: string, attendeeName: string) {
  const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}&attendeeName=${encodeURIComponent(attendeeName)}`);
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to join tour: ${response.status} ${response.statusText} ${errorText}`);
    throw new Error('Failed to join tour');
  }

  const data = await response.json();
  if (!data.offer) await pollForOffer(tourCode, language, attendeeName);

  return data;
}

async function pollForOffer(tourCode: string, language: string, attendeeName: string) {
  const MAX_ATTEMPTS = 24; // 2 minutes max
  const POLL_INTERVAL = 5000; // 5 seconds
  let attempts = 0;

  while (attempts++ < MAX_ATTEMPTS) {
    try {
      const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}&attendeeName=${encodeURIComponent(attendeeName)}`);
      if (!response.ok) {
        const errorData = await response.json();
        console.warn(`Offer poll failed:`, errorData);
        if (response.status === 404) {
          throw new Error('Tour ended or invalid');
        }
        continue;
      }

      const data = await response.json();
      if (data.offer) {
        console.log(`WebRTC offer received for ${language}`);
        return data;
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
    
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
  
  throw new Error(`Timeout waiting for audio stream offer after ${MAX_ATTEMPTS * POLL_INTERVAL / 1000} seconds`);
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
    tourCode,
    keyRefreshTimer: null,
    audioContext: undefined,
    audioWorklet: undefined,
    mediaStream: undefined,
    reconnectAttempt: 0,
    isReconnecting: false
  };

  connections.set(language, connectionState);

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
  // Set remote description
  const offerResponse = await fetch(`/api/tour/join?tourCode=${encodeURIComponent(tourId)}&language=${encodeURIComponent(language)}`);
  const offerData = await offerResponse.json();
  await pc.setRemoteDescription(offerData.offer);

  // Create and set local answer
  const answer = await pc.createAnswer({
      offerToReceiveAudio: true,
      voiceActivityDetection: false
  });
  await pc.setLocalDescription(optimizeSdpForOpus(answer));

  // Send answer to server
  await fetch("/api/tour/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          language,
          answer: pc.localDescription,
          tourId
      }),
      credentials: "include"
  });

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
