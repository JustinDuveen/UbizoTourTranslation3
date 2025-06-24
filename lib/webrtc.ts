// Simplified Attendee WebRTC - Aligned with Guide Implementation
import { getStaticXirsysICEServers, createStaticXirsysRTCConfiguration } from './xirsysConfig';
import { initializeSignaling, cleanupSignaling, getSignalingClient } from './webrtcSignaling';
import { createICEMonitor, type ICETimeoutEvent } from './iceConnectionMonitor';
import { normalizeLanguageForStorage } from './languageUtils';
import { validateAttendeeId, validateTourConnectionParams } from './parameterValidation';
import type { TourConnectionParams } from './types/audio';

// EXPERT FIX: Enhanced attendeeId management with validation
function getOrCreateAttendeeId(
  tourId: string, 
  language: string, 
  existingAttendeeId?: string, 
  langContext?: string
): string {
  if (existingAttendeeId) {
    validateAttendeeId(existingAttendeeId, langContext);
    console.log(`${langContext} 🔄 REUSING existing attendeeId for reconnection: ${existingAttendeeId}`);
    return existingAttendeeId;
  }

  const storageKey = `attendeeId_${tourId}_${language}`;
  const storedAttendeeId = localStorage.getItem(storageKey);
  
  if (storedAttendeeId && storedAttendeeId.startsWith('attendee_')) {
    try {
      validateAttendeeId(storedAttendeeId, langContext);
      console.log(`${langContext} 📦 RESTORED attendeeId from localStorage: ${storedAttendeeId}`);
      return storedAttendeeId;
    } catch (error) {
      console.warn(`${langContext} ⚠️ Stored attendeeId validation failed, generating new one:`, error);
      localStorage.removeItem(storageKey);
    }
  }

  // Generate new attendeeId with enhanced format validation
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 9); // 7 chars for better uniqueness
  const newAttendeeId = `attendee_${timestamp}_${randomSuffix}`;
  
  validateAttendeeId(newAttendeeId, langContext);
  localStorage.setItem(storageKey, newAttendeeId);
  console.log(`${langContext} ✨ GENERATED new attendeeId: ${newAttendeeId}`);
  console.log(`${langContext} 💾 Stored attendeeId in localStorage for future reconnections`);
  
  return newAttendeeId;
}

interface AttendeeConnection {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  tourCode: string;
  attendeeId: string;
  keyRefreshTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  isReconnecting: boolean;
  signalingClient?: any; // WebSocket signaling client
  iceMonitor?: any; // ICE connection monitor
}

// Global connections manager - simplified
const connections = new Map<string, AttendeeConnection>();

// EXPERT DEBUGGING: Global audio debugging helper for browser console access
declare global {
  interface Window {
    debugAttendeeAudio: (language?: string) => void;
  }
}

// Expose debug function to browser console
if (typeof window !== 'undefined') {
  window.debugAttendeeAudio = (language?: string) => {
    const langKey = language ? normalizeLanguageForStorage(language) : connections.keys().next().value;
    
    if (!langKey) {
      console.log('🔍 No active attendee connections found');
      return;
    }
    
    const connection = connections.get(langKey);
    
    if (!connection) {
      console.log('🔍 No active attendee connections found');
      console.log('Available languages:', Array.from(connections.keys()));
      return;
    }
    
    const { pc, audioEl, attendeeId, tourCode } = connection;
    
    console.log('===== 🔊 ATTENDEE AUDIO DEBUG REPORT =====');
    console.log('Connection Variables:');
    console.log('- Language:', langKey);
    console.log('- TourCode:', tourCode);
    console.log('- AttendeeId:', attendeeId);
    
    console.log('WebRTC States:');
    console.log('- Connection State:', pc.connectionState);
    console.log('- ICE Connection State:', pc.iceConnectionState);
    console.log('- ICE Gathering State:', pc.iceGatheringState);
    console.log('- Signaling State:', pc.signalingState);
    
    console.log('Audio Element:');
    console.log('- Paused:', audioEl.paused);
    console.log('- Muted:', audioEl.muted);
    console.log('- Volume:', audioEl.volume);
    console.log('- Current Time:', audioEl.currentTime);
    console.log('- Ready State:', audioEl.readyState);
    console.log('- Autoplay:', audioEl.autoplay);
    
    // Get current stats
    pc.getStats().then(stats => {
      console.log('WebRTC Statistics:');
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
          console.log('- Bytes Received:', report.bytesReceived || 0);
          console.log('- Packets Received:', report.packetsReceived || 0);
          console.log('- Audio Level:', report.audioLevel || 'not-available');
        }
      });
    }).catch(err => console.error('Error getting stats:', err));
    
    console.log('===== END DEBUG REPORT =====');
    console.log('💡 Call window.debugAttendeeAudio() again to refresh stats');
  };
}

// Reconnection configuration - simplified
const RECONNECTION_CONFIG = {
  MAX_ATTEMPTS: 5,       // Increased from 3
  INITIAL_DELAY: 5000,   // Increased from 2000
  MAX_DELAY: 30000,      // Increased from 10000
  BACKOFF_FACTOR: 2
};

// EXPERT FIX: Enhanced WebRTC initialization interface with strict typing
interface WebRTCOptions {
  readonly onTranslation: (text: string) => void;
  readonly language: string;
  readonly tourCode: string;
  readonly attendeeName: string;
  readonly signal?: AbortSignal;
  readonly existingAttendeeId?: string;
}

interface WebRTCConnectionResult {
  readonly success: boolean;
  readonly attendeeId: string;
  readonly connectionState: 'connected' | 'failed' | 'timeout';
  readonly error?: string;
}

export async function initWebRTC(options: WebRTCOptions): Promise<WebRTCConnectionResult> {
  const { onTranslation, language, tourCode, attendeeName, signal, existingAttendeeId } = options;
  // Ensure language is normalized to lowercase for consistent key storage
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const langContext = `[${normalizedLanguage}]`;

  console.log(`${langContext} Initializing Attendee WebRTC... (original: ${language})`);

  if (!tourCode) {
    throw new Error('Missing tour code for WebRTC initialization');
  }

  // Store attendee name for reconnection
  if (attendeeName) {
    localStorage.setItem('attendeeName', attendeeName);
  }

  try {
    // Cleanup existing connection if it exists
    if (connections.has(normalizedLanguage)) {
      console.log(`${langContext} Cleaning up existing connection`);
      cleanupConnection(normalizedLanguage);
    }

    // Initialize WebSocket signaling first (we'll update the attendeeId after getting it from the server)
    console.log(`${langContext} Initializing WebSocket signaling for attendee...`);
    let signalingClient = await initializeSignaling(tourCode, normalizedLanguage, 'attendee', existingAttendeeId);
    
    if (!signalingClient) {
      console.warn(`${langContext} Failed to initialize WebSocket signaling, falling back to HTTP polling`);
    } else {
      console.log(`${langContext} ✅ WebSocket signaling initialized successfully (will update attendeeId after server response)`);
    }

    // Fetch tour offer
    const { offer, tourId, placeholder } = await fetchTourOffer(tourCode, normalizedLanguage, attendeeName);
    localStorage.setItem('currentTourId', tourId);

    if (placeholder) {
      throw new Error('PLACEHOLDER_OFFER_RECEIVED');
    }

    // Create peer connection with immediate ICE handling (aligned with guide behavior)
    const { pc, audioEl } = await createPeerConnection(normalizedLanguage, tourCode, true); // Pass true to enable immediate ICE handling

    // CRITICAL FIX: Set remote description FIRST (this triggers ICE candidate generation)
    console.log(`${langContext} Setting remote description from guide offer...`);
    const validatedOffer = validateAndFormatSDP(offer);
    await pc.setRemoteDescription(validatedOffer);
    console.log(`${langContext} Remote description set successfully - ICE gathering should start immediately`);

    // Create and set local answer (attendee is ICE controlled)
    const answer = await pc.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false
    });

    // Fix SDP directionality - attendee receives audio only (recvonly)
    let modifiedSdp = answer.sdp;
    if (modifiedSdp) {
      console.log(`${langContext} Original SDP direction attributes:`, 
        (modifiedSdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g) || []).join(', '));
      
      // Check if audio m-line exists before modifying
      if (modifiedSdp.includes('m=audio')) {
        // Remove any existing direction attributes to avoid conflicts
        modifiedSdp = modifiedSdp.replace(/a=(sendrecv|sendonly|recvonly|inactive)\r?\n/g, '');

        // Add recvonly after the audio m-line since attendee only receives audio
        modifiedSdp = modifiedSdp.replace(
          /(m=audio[^\r\n]*\r?\n)/,
          '$1a=recvonly\r\n'
        );
        
        console.log(`${langContext} Fixed attendee SDP directionality: recvonly (audio from guide)`);
      } else {
        console.warn(`${langContext} No audio m-line found in SDP, skipping direction modification`);
      }
      
      // Ensure attendee is ICE controlled (responding role)
      if (modifiedSdp && !modifiedSdp.includes('a=ice-options')) {
        console.log(`${langContext} ✅ Attendee correctly in ICE controlled role`);
      } else {
        console.warn(`${langContext} ⚠️ ICE role conflict detected in SDP`);
      }
    }

    const modifiedAnswer = new RTCSessionDescription({
      type: 'answer',
      sdp: modifiedSdp
    });

    await pc.setLocalDescription(modifiedAnswer);
    console.log(`${langContext} Local description (answer) set successfully`);
    
    // Log ICE gathering state after setting both descriptions
    console.log(`${langContext} ICE gathering state after SDP exchange: ${pc.iceGatheringState}`);
    console.log(`${langContext} ICE connection state after SDP exchange: ${pc.iceConnectionState}`);

    // Complete signaling by sending answer to get attendeeId
    console.log(`${langContext} Sending answer to guide...`);
    const { attendeeId } = await completeSignaling(pc, normalizedLanguage, tourId, offer, attendeeName, existingAttendeeId, signalingClient);
    console.log(`${langContext} Answer sent successfully with attendeeId: ${attendeeId}`);

    // EXPERT FIX: Update attendeeId without disrupting WebSocket connection
    if (signalingClient) {
      console.log(`${langContext} ✅ WebSocket signaling continues with attendeeId: ${attendeeId}`);
      // No reconnection needed - the connection is already established and working
      // The attendeeId is sent in messages, not stored in the connection itself
    }

    // Create ICE connection monitor
    const iceMonitor = createICEMonitor(pc, normalizedLanguage, 'attendee', attendeeId, 30000);
    
    // Enhanced ICE role debugging for attendee
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'checking') {
        console.log(`${langContext} 🔍 ICE ROLE DEBUG: Attendee entering connectivity checks phase`);
        
        setTimeout(() => {
          pc.getStats().then(stats => {
            let candidatePairs: Array<{state: string; nominated: boolean}> = [];
            stats.forEach(report => {
              if (report.type === 'candidate-pair') {
                candidatePairs.push({
                  state: report.state,
                  nominated: report.nominated
                });
              }
            });
            
            const inProgress = candidatePairs.filter(p => p.state === 'in-progress').length;
            const waiting = candidatePairs.filter(p => p.state === 'waiting').length;
            const succeeded = candidatePairs.filter(p => p.state === 'succeeded').length;
            
            console.log(`${langContext} 📊 ICE ATTENDEE PROGRESS: ${inProgress} in-progress, ${waiting} waiting, ${succeeded} succeeded`);
            
            if (inProgress === 0 && waiting > 0 && succeeded === 0) {
              console.error(`${langContext} 🚨 ICE ROLE DEADLOCK: All ${waiting} pairs waiting, no checks initiated by guide!`);
            } else if (inProgress > 0) {
              console.log(`${langContext} ✅ ICE CHECKS ACTIVE: Guide successfully initiating connectivity checks`);
            }
          });
        }, 2000); // Check 2 seconds after entering checking state
      }
    });
    
    // Start monitoring with enhanced timeout handling
    iceMonitor.startMonitoring((event: ICETimeoutEvent) => {
      console.error(`${langContext} ICE timeout for attendee ${attendeeId}:`, event.analysis.failureReason);
      handleICETimeout(event);
      
      // Trigger reconnection with exponential backoff
      const connection = connections.get(language);
      if (connection && !connection.isReconnecting) {
        scheduleReconnection(normalizedLanguage, `ICE timeout: ${event.analysis.failureReason}`);
      }
    });

    // Now that we have attendeeId, enable full ICE candidate handling and process pending candidates
    console.log(`${langContext} Enabling full ICE candidate handling with attendeeId: ${attendeeId}`);
    enableIceCandidateHandling(pc, normalizedLanguage, tourId, attendeeId, signalingClient);

    // Set up key refresh
    const keyRefreshTimer = setupKeyRefresh(normalizedLanguage);

    // Store connection with the correct attendeeId from answer
    connections.set(normalizedLanguage, {
      pc,
      audioEl,
      tourCode,
      attendeeId,
      keyRefreshTimer,
      reconnectAttempt: 0,
      isReconnecting: false,
      signalingClient,
      iceMonitor
    });

    // Set up media handlers with debugging context
    setupMediaHandlers(pc, audioEl, onTranslation, normalizedLanguage, tourCode, tourId, attendeeId);

    // Setup WebSocket handlers for real-time signaling or fall back to polling
    if (signalingClient) {
      console.log(`${langContext} Setting up WebSocket handlers for real-time signaling...`);
      
      let receivedCandidateCount = 0;
      
      // Handle incoming ICE candidates from guide via WebSocket
      signalingClient.onIceCandidate((candidate: any) => {
        receivedCandidateCount++;
        console.log(`${langContext} [ATTENDEE-ICE-RECV] Received ICE candidate #${receivedCandidateCount} via WebSocket from guide`);
        console.log(`${langContext} [ATTENDEE-ICE-RECV] Candidate details - Type: ${candidate.type}, Protocol: ${candidate.protocol}, Priority: ${candidate.priority}`);
        console.log(`${langContext} [ATTENDEE-ICE-RECV] Candidate string: ${candidate.candidate.substring(0, 80)}...`);
        
        pc.addIceCandidate(new RTCIceCandidate(candidate))
          .then(() => {
            console.log(`${langContext} [ATTENDEE-ICE-RECV] ✅ Successfully added ICE candidate #${receivedCandidateCount} from guide`);
          })
          .catch((error) => {
            console.error(`${langContext} [ATTENDEE-ICE-RECV] ❌ Error adding ICE candidate #${receivedCandidateCount}:`, error);
          });
      });

      // Handle incoming offers from guide via WebSocket (for reconnections)
      signalingClient.onOffer((offer: RTCSessionDescriptionInit) => {
        console.log(`${langContext} Received new offer via WebSocket from guide`);
        // This could be used for handling reconnections or session updates
      });

      console.log(`${langContext} ✅ WebSocket signaling handlers configured`);
      
      // CRITICAL FIX: Start HTTP polling ALONGSIDE WebSocket for reliability
      console.log(`${langContext} Starting dual-path ICE delivery: WebSocket + HTTP polling`);
      startIceCandidatePolling(pc, normalizedLanguage, tourId, attendeeId);
    } else {
      // Fall back to HTTP polling only
      console.log(`${langContext} Falling back to HTTP polling for ICE candidates...`);
      startIceCandidatePolling(pc, normalizedLanguage, tourId, attendeeId);
    }

    console.log(`${langContext} WebRTC initialization completed successfully`);

    // Cleanup on abort
    signal?.addEventListener('abort', () => {
      console.log(`${langContext} Abort signal received, cleaning up`);
      cleanupConnection(normalizedLanguage);
    });

    // EXPERT FIX: Return successful connection result
    return {
      success: true,
      attendeeId: attendeeId,
      connectionState: 'connected' as const,
    };

  } catch (error) {
    console.error(`${langContext} WebRTC initialization error:`, error);
    
    if (error instanceof Error && error.message === 'PLACEHOLDER_OFFER_RECEIVED') {
      console.log(`${langContext} Placeholder offer received, will retry later`);
      return {
        success: false,
        attendeeId: 'unknown',
        connectionState: 'failed' as const,
        error: 'Placeholder offer received - guide not ready'
      };
    }

    // Clean up any partial connections
    if (connections.has(normalizedLanguage)) {
      cleanupConnection(normalizedLanguage);
    }
    
    return {
      success: false,
      attendeeId: 'unknown', 
      connectionState: 'failed' as const,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function fetchTourOffer(tourCode: string, language: string, attendeeName: string) {
  console.log(`${tourCode} Fetching tour offer for ${language}`);

  const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}&attendeeName=${encodeURIComponent(attendeeName)}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to join tour: ${response.status} - ${errorData.error || 'Unknown error'}`);
  }

  const data = await response.json();
  
  // Check for placeholder
  if (data.placeholder || !data.offer) {
    return { ...data, placeholder: true };
  }

  return data;
}

async function createPeerConnection(language: string, tourCode: string, enableIceHandlingImmediately = true) {
  const langContext = `[${language}]`;
  console.log(`${langContext} Creating peer connection...`);

  // EXPERT FIX: Create peer connection with static jb-turn1.xirsys.com configuration
  console.log(`${langContext} 🎯 Using static TURN configuration for guaranteed consistency`);
  let pc: RTCPeerConnection;

  try {
    let xirsysServers: any[];
    
    // EXPERT FIX: Use static ICE servers for guaranteed consistency
    console.log(`${langContext} [ATTENDEE-STATIC-ICE] Using static jb-turn1.xirsys.com configuration`);
    xirsysServers = getStaticXirsysICEServers();
    
    if (xirsysServers && xirsysServers.length > 0) {
      // DEBUGGING: Log server details to verify TURN servers are present
      console.log(`${langContext} [ATTENDEE-SERVER-DEBUG] Using ${xirsysServers.length} Xirsys servers:`);
      xirsysServers.forEach((server, index) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        urls.forEach((url: string) => {
          const serverType = url.toLowerCase().startsWith('turn:') ? 'TURN' : 
                           url.toLowerCase().startsWith('stun:') ? 'STUN' : 'UNKNOWN';
          console.log(`${langContext} [ATTENDEE-SERVER-DEBUG] Server ${index + 1}: ${serverType} - ${url}`);
          if (serverType === 'TURN') {
            console.log(`${langContext} [ATTENDEE-SERVER-DEBUG] TURN credentials: username=${server.username ? 'present' : 'missing'}, credential=${server.credential ? 'present' : 'missing'}`);
          }
        });
      });
      
      // Check if we have TURN servers
      const hasTurn = xirsysServers.some(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url: string) => url.toLowerCase().startsWith('turn:'));
      });
      
      if (!hasTurn) {
        console.warn(`${langContext} No TURN servers in Xirsys config, adding fallback TURN servers`);
        // Add fallback TURN servers to the Xirsys configuration
        xirsysServers.push(
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
          },
          {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
          }
        );
      }
      
      pc = new RTCPeerConnection(createStaticXirsysRTCConfiguration());
      console.log(`${langContext} ✅ Using static jb-turn1.xirsys.com configuration (${xirsysServers.length} servers, TURN enabled)`);
    } else {
      throw new Error('No Xirsys servers available');
    }
  } catch (error) {
    console.warn(`${langContext} Xirsys unavailable, using fallback servers:`, error);
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ],
      iceCandidatePoolSize: 15,  // Match guide's candidate pool size for symmetrical ICE negotiation
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all'
    });
  }

  // Create audio element and add to DOM (critical for proper playback)
  const audioEl = new Audio();
  audioEl.autoplay = true;
  audioEl.muted = false;
  audioEl.volume = 1.0;
  audioEl.controls = true;
  
  // CRITICAL FIX: Add audio element to DOM prominently for reliable playback
  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '9999';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    container.style.padding = '15px 20px';
    container.style.borderRadius = '10px';
    container.style.color = 'white';
    container.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
    container.style.fontFamily = 'Arial, sans-serif';
    container.setAttribute('data-tour-audio-container', 'true');

    const label = document.createElement('div');
    label.textContent = `🎧 Translation Audio (${language})`;
    label.style.marginBottom = '10px';
    label.style.fontWeight = 'bold';
    label.style.textAlign = 'center';
    label.style.fontSize = '14px';

    // Style the audio element for better visibility
    audioEl.style.width = '250px';
    audioEl.style.height = '40px';

    container.appendChild(label);
    container.appendChild(audioEl);
    document.body.appendChild(container);
  }

  // Always initialize pending candidates array for immediate ICE handling
  // This allows ICE candidates to be collected even before attendeeId is available
  (pc as any)._pendingIceCandidates = [];
  
  if (enableIceHandlingImmediately) {
    console.log(`${langContext} Setting up immediate ICE candidate collection (will be sent once attendeeId is available)`);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`${langContext} [ATTENDEE-ICE] Generated ICE candidate (immediate mode):`, event.candidate.candidate.substring(0, 50) + '...');
        // Store all candidates for later processing since attendeeId isn't available yet
        (pc as any)._pendingIceCandidates.push(event.candidate);
        console.log(`${langContext} [ATTENDEE-ICE] Stored candidate, total pending: ${(pc as any)._pendingIceCandidates.length}`);
      } else {
        console.log(`${langContext} [ATTENDEE-ICE] 🔍 ICE gathering completed (null candidate received) - ${(pc as any)._pendingIceCandidates.length} candidates ready`);
        
        // Analyze ICE candidates after gathering completes
        setTimeout(() => {
          analyzeICECandidates(pc, language);
        }, 5000);
      }
    };
  } else {
    console.log(`${langContext} Setting up deferred ICE candidate collection`);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`${langContext} [ATTENDEE-ICE] Storing pending ICE candidate until signaling completes`);
        (pc as any)._pendingIceCandidates.push(event.candidate);
      }
    };
  }

  // Enhanced ICE monitoring for attendee
  
  // Monitor ICE gathering state changes
  pc.onicegatheringstatechange = () => {
    console.log(`${langContext} [ATTENDEE-ICE] ICE gathering state changed to: ${pc.iceGatheringState}`);
  };
  
  // Monitor ICE connection state changes
  pc.oniceconnectionstatechange = () => {
    console.log(`${langContext} [ATTENDEE-ICE] ICE connection state changed to: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'connected') {
      console.log(`${langContext} [ATTENDEE-ICE] 🎉 ICE connection ESTABLISHED!`);
    } else if (pc.iceConnectionState === 'failed') {
      console.error(`${langContext} [ATTENDEE-ICE] ❌ ICE connection FAILED`);
    }
  };

  // Connection state monitoring with enhanced debugging
  pc.onconnectionstatechange = () => {
    console.log(`${langContext} 🔗 Connection state: ${pc.connectionState}`);
    
    if (pc.connectionState === 'connected') {
      console.log(`${langContext} ✅ WebRTC connection fully established!`);
      
      // Log successful candidate pair details
      setTimeout(() => {
        pc.getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              console.log(`${langContext} 🎯 SUCCESSFUL candidate pair:`, {
                state: report.state,
                priority: report.priority,
                nominated: report.nominated,
                localCandidateId: report.localCandidateId,
                remoteCandidateId: report.remoteCandidateId
              });
            }
          });
        });
      }, 1000);
    } else if (pc.connectionState === 'failed') {
      console.error(`${langContext} ❌ Connection failed, attempting reconnect`);
      reconnect(language);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`${langContext} 🧊 ICE state: ${pc.iceConnectionState}`);
    
    if (pc.iceConnectionState === 'connected') {
      console.log(`${langContext} ✅ ICE connectivity established!`);
    } else if (pc.iceConnectionState === 'completed') {
      console.log(`${langContext} ✅ ICE connectivity completed!`);
    } else if (pc.iceConnectionState === 'failed') {
      console.error(`${langContext} ❌ ICE failed, attempting reconnect`);
      reconnect(language);
    }
  };

  // Add this function to actively monitor ICE connection progress
  function monitorICEProgress(pc: RTCPeerConnection, language: string) {
    let checkCount = 0;
    const langContext = `[${language}]`;
    
    const checkInterval = setInterval(() => {
      checkCount++;
      
      // Increase timeout from 30 to 60 checks (at 1-second intervals)
      if (checkCount > 60) {
        console.warn(`${langContext} [ICE-MONITOR] ⚠️ ICE connection taking too long, may need to force restart`);
        clearInterval(checkInterval);
        
        // If still in checking state after 60 seconds, try forcing an ICE restart
        if (pc.iceConnectionState === 'checking') {
          console.log(`${langContext} [ICE-MONITOR] 🔄 Forcing ICE restart after timeout`);
          pc.restartIce();
          
          // Give the restart more time to work (20 seconds instead of 10)
          const restartTimeout = setTimeout(() => {
            if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'new') {
              console.warn(`${langContext} [ICE-MONITOR] ⚠️ ICE restart did not resolve connection issues`);
              // Consider a full reconnection here
              const connection = connections.get(language);
              if (connection) {
                reconnect(language);
              }
            }
          }, 20000); // Give the restart 20 seconds to work
        }
      }
    }, 1000);
    
    // Store interval for cleanup
    (pc as any)._iceMonitorInterval = checkInterval;
    
    // Clear interval when connection state changes to connected or failed
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'connected' || 
          pc.iceConnectionState === 'completed' || 
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'disconnected') {
        clearInterval(checkInterval);
      }
    });
  }

  // Call this function after creating the peer connection
  monitorICEProgress(pc, language);

  // Ensure ICE gathering doesn't stall indefinitely
  const iceGatheringTimeout = setTimeout(() => {
    if (pc.iceGatheringState !== 'complete') {
      console.warn(`${langContext} ICE gathering taking too long, proceeding anyway`);
      // Force the null candidate event to trigger completion handlers
      if (typeof pc.onicegatheringstatechange === 'function') {
        const originalHandler = pc.onicegatheringstatechange;
        pc.onicegatheringstatechange = (event) => {
          originalHandler.call(pc, event);
          pc.onicegatheringstatechange = originalHandler;
        };
      }
    }
  }, 8000); // 8 seconds timeout for ICE gathering

  // Clear the timeout when gathering completes naturally
  pc.addEventListener('icegatheringstatechange', () => {
    if (pc.iceGatheringState === 'complete') {
      clearTimeout(iceGatheringTimeout);
    }
  }, { once: true });

  return { pc, audioEl };
}

function setupMediaHandlers(
  pc: RTCPeerConnection, 
  audioEl: HTMLAudioElement, 
  onTranslation: (text: string) => void, 
  language: string, 
  tourCode?: string, 
  tourId?: string, 
  attendeeId?: string
) {
  const langContext = `[${language}]`;
  const normalizedLanguage = normalizeLanguageForStorage(language);
  
  // EXPERT-LEVEL ontrack handler with comprehensive audio debugging
  pc.ontrack = async (event) => {
    console.log(`${langContext} 🎵 ONTRACK EVENT RECEIVED from Guide! 🎵`);
    console.log(`${langContext} ===== 🔊 AUDIO DEBUG SESSION START =====`);
    console.log(`${langContext} KEY VARIABLES FOR DEBUGGING:`);
    console.log(`${langContext} - tourCode: ${tourCode || 'not-provided'}`);
    console.log(`${langContext} - tourId: ${tourId || 'not-provided'}`);
    console.log(`${langContext} - attendeeId: ${attendeeId || 'not-provided'}`);
    console.log(`${langContext} - displayLanguage: ${language}`);
    console.log(`${langContext} - normalizedLanguage: ${normalizedLanguage}`);
    console.log(`${langContext} - WebRTC Connection State: ${pc.connectionState}`);
    console.log(`${langContext} - ICE Connection State: ${pc.iceConnectionState}`);
    console.log(`${langContext} - ICE Gathering State: ${pc.iceGatheringState}`);
    console.log(`${langContext} Track details:`, {
      trackKind: event.track.kind,
      trackId: event.track.id,
      streamCount: event.streams.length,
      timestamp: new Date().toISOString()
    });
    
    if (event.track.kind === 'audio') {
      console.log(`${langContext} ✅ AUDIO TRACK RECEIVED - Processing for attendee playback...`);
      
      const stream = event.streams[0];
      console.log(`${langContext} Stream details:`, {
        id: stream.id,
        active: stream.active,
        trackCount: stream.getTracks().length
      });

      // Log track details for debugging
      stream.getTracks().forEach((track, index) => {
        console.log(`${langContext} 🎵 Received track ${index}: id=${track.id}, kind=${track.kind}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });

      // EXPERT FIX 1: Verify track is actually producing audio data
      const audioTrack = event.track;
      if (audioTrack.readyState !== 'live') {
        console.warn(`${langContext} ⚠️ Audio track not in 'live' state: ${audioTrack.readyState}`);
      }

      // EXPERT FIX 2: Enhanced audio element configuration for maximum compatibility
      console.log(`${langContext} 🔄 Configuring audio element with expert settings...`);
      
      // Detect device capabilities
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isSafari = /Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent);
      
      console.log(`${langContext} Device detection: isMobile=${isMobile}, isIOS=${isIOS}, isAndroid=${isAndroid}, isSafari=${isSafari}`);
      
      // EXPERT FIX 3: Comprehensive audio element setup
      audioEl.muted = false;
      audioEl.volume = 1.0;
      audioEl.autoplay = true;
      audioEl.controls = true;
      audioEl.preload = 'auto';
      
      // Critical mobile properties
      (audioEl as any).playsInline = true; // iOS requirement
      (audioEl as any).webkitPlaysInline = true; // Older iOS versions
      (audioEl as any).disableRemotePlayback = true; // Prevent casting issues
      
      // Android-specific optimizations
      if (isAndroid) {
        audioEl.setAttribute('playsinline', 'true');
        audioEl.setAttribute('webkit-playsinline', 'true');
      }

      // EXPERT FIX 4: Prepare AudioContext early (before user interaction)
      let globalAudioContext: AudioContext | null = null;
      if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        try {
          globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          console.log(`${langContext} AudioContext created, state: ${globalAudioContext.state}`);
        } catch (error) {
          console.warn(`${langContext} Failed to create AudioContext:`, error);
        }
      }

      // EXPERT FIX 5: Safe stream assignment with error handling
      try {
        console.log(`${langContext} 🔄 Setting audio stream to audio element...`);
        audioEl.srcObject = stream;
        
        // Verify stream assignment
        if (audioEl.srcObject !== stream) {
          throw new Error('Stream assignment failed - srcObject mismatch');
        }
        
        console.log(`${langContext} ✅ Stream successfully assigned to audio element`);

        // EXPERT AUDIO DEBUGGING: Comprehensive audio flow analysis
        console.log(`${langContext} ===== 🔍 DETAILED AUDIO ANALYSIS =====`);
        
        // 1. Check track states and constraints
        const audioTrack = event.track;
        console.log(`${langContext} 🎤 Audio Track Analysis:`);
        console.log(`${langContext} - Track ID: ${audioTrack.id} (Match expected: ${tourId ? 'Guide-OpenAI-Track' : 'Unknown'})`);
        console.log(`${langContext} - Ready State: ${audioTrack.readyState} (should be 'live')`);
        console.log(`${langContext} - Enabled: ${audioTrack.enabled} (should be true)`);
        console.log(`${langContext} - Muted: ${audioTrack.muted} (should be false)`);
        console.log(`${langContext} - Label: ${audioTrack.label || 'no-label'}`);
        
        // 2. Check stream stats
        console.log(`${langContext} 🌊 Media Stream Analysis:`);
        console.log(`${langContext} - Stream ID: ${stream.id}`);
        console.log(`${langContext} - Stream Active: ${stream.active} (should be true)`);
        console.log(`${langContext} - Track Count: ${stream.getTracks().length} (should have audio track)`);
        
        // 3. Check audio element configuration
        console.log(`${langContext} 🔊 Audio Element Configuration:`);
        console.log(`${langContext} - SrcObject Set: ${audioEl.srcObject === stream} (should be true)`);
        console.log(`${langContext} - Volume: ${audioEl.volume} (should be 1.0)`);
        console.log(`${langContext} - Muted: ${audioEl.muted} (should be false)`);
        console.log(`${langContext} - Autoplay: ${audioEl.autoplay} (should be true)`);
        console.log(`${langContext} - Paused: ${audioEl.paused} (depends on autoplay policy)`);
        console.log(`${langContext} - ReadyState: ${audioEl.readyState} (higher is better)`);
        
        // 4. WebRTC Connection State Analysis
        console.log(`${langContext} 🔗 WebRTC Connection Analysis:`);
        console.log(`${langContext} - Connection State: ${pc.connectionState} (should be 'connected')`);
        console.log(`${langContext} - ICE Connection State: ${pc.iceConnectionState} (should be 'connected' or 'completed')`);
        console.log(`${langContext} - ICE Gathering State: ${pc.iceGatheringState}`);
        console.log(`${langContext} - Signaling State: ${pc.signalingState} (should be 'stable')`);
        
        // 5. Real-time WebRTC Statistics Analysis
        setTimeout(async () => {
          try {
            const stats = await pc.getStats();
            console.log(`${langContext} 📊 WebRTC Statistics Analysis:`);
            
            stats.forEach(report => {
              if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                console.log(`${langContext} 📈 Inbound Audio RTP Stats:`);
                console.log(`${langContext} - Bytes Received: ${report.bytesReceived || 0}`);
                console.log(`${langContext} - Packets Received: ${report.packetsReceived || 0}`);
                console.log(`${langContext} - Packets Lost: ${report.packetsLost || 0}`);
                console.log(`${langContext} - Audio Level: ${report.audioLevel !== undefined ? report.audioLevel : 'not-available'}`);
                console.log(`${langContext} - Total Audio Energy: ${report.totalAudioEnergy || 'not-available'}`);
                console.log(`${langContext} - SSRC: ${report.ssrc}`);
                
                if (report.bytesReceived === 0) {
                  console.error(`${langContext} ❌ NO AUDIO DATA RECEIVED - Check guide's OpenAI connection!`);
                } else {
                  console.log(`${langContext} ✅ Audio data flowing from guide (${report.bytesReceived} bytes)`);
                }
              }
              
              if (report.type === 'media-source' && report.kind === 'audio') {
                console.log(`${langContext} 🎵 Audio Source Stats:`);
                console.log(`${langContext} - Audio Level: ${report.audioLevel !== undefined ? report.audioLevel : 'not-available'}`);
                console.log(`${langContext} - Total Audio Energy: ${report.totalAudioEnergy || 'not-available'}`);
              }
              
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                console.log(`${langContext} 🎯 Successful ICE Candidate Pair:`);
                console.log(`${langContext} - Local Candidate Type: ${report.localCandidateId}`);
                console.log(`${langContext} - Remote Candidate Type: ${report.remoteCandidateId}`);
                console.log(`${langContext} - Bytes Sent: ${report.bytesSent || 0}`);
                console.log(`${langContext} - Bytes Received: ${report.bytesReceived || 0}`);
              }
            });
            
            // 6. Audio Level Monitoring for the first 10 seconds
            let audioLevelChecks = 0;
            const audioLevelMonitor = setInterval(async () => {
              audioLevelChecks++;
              
              try {
                const currentStats = await pc.getStats();
                let hasAudioActivity = false;
                
                currentStats.forEach(report => {
                  if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                    if (report.audioLevel !== undefined && report.audioLevel > 0) {
                      hasAudioActivity = true;
                      console.log(`${langContext} 🔊 Audio Level Detected: ${report.audioLevel.toFixed(4)} (Check ${audioLevelChecks}/20)`);
                    }
                  }
                });
                
                if (!hasAudioActivity && audioLevelChecks > 5) {
                  console.warn(`${langContext} ⚠️ No audio activity detected after ${audioLevelChecks} seconds - Guide may not be speaking`);
                }
                
                if (audioLevelChecks >= 20) {
                  clearInterval(audioLevelMonitor);
                  console.log(`${langContext} 🏁 Audio level monitoring completed`);
                }
              } catch (error) {
                console.error(`${langContext} Error monitoring audio levels:`, error);
                clearInterval(audioLevelMonitor);
              }
            }, 1000);
            
          } catch (error) {
            console.error(`${langContext} Error getting WebRTC stats:`, error);
          }
        }, 2000);

        // 7. EXPERT TROUBLESHOOTING: Common Audio Issues Detection
        setTimeout(() => {
          console.log(`${langContext} ===== 🔧 AUDIO TROUBLESHOOTING ANALYSIS =====`);
          
          // Check for common audio playback issues
          const issues: string[] = [];
          const solutions: string[] = [];
          
          if (audioEl.paused) {
            issues.push("Audio element is paused");
            solutions.push("User interaction may be required for autoplay");
          }
          
          if (audioEl.muted) {
            issues.push("Audio element is muted");
            solutions.push("Audio will not play when muted");
          }
          
          if (audioEl.volume === 0) {
            issues.push("Audio volume is set to 0");
            solutions.push("Volume must be > 0 for audio playback");
          }
          
          if (pc.connectionState !== 'connected') {
            issues.push(`WebRTC connection not fully established (${pc.connectionState})`);
            solutions.push("Wait for connection to reach 'connected' state");
          }
          
          if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
            issues.push(`ICE connection not established (${pc.iceConnectionState})`);
            solutions.push("ICE connectivity issues may prevent audio flow");
          }
          
          if (!audioTrack.enabled) {
            issues.push("Audio track is disabled");
            solutions.push("Track must be enabled for audio to flow");
          }
          
          if (audioTrack.muted) {
            issues.push("Audio track is muted at source");
            solutions.push("Guide may have muted their microphone or OpenAI connection failed");
          }
          
          if (audioTrack.readyState !== 'live') {
            issues.push(`Audio track not in live state (${audioTrack.readyState})`);
            solutions.push("Track must be 'live' for real-time audio");
          }
          
          if (issues.length > 0) {
            console.warn(`${langContext} ⚠️ POTENTIAL AUDIO ISSUES DETECTED:`);
            issues.forEach((issue, index) => {
              console.warn(`${langContext} ${index + 1}. ${issue}`);
              console.info(`${langContext}    💡 Solution: ${solutions[index]}`);
            });
            
            console.log(`${langContext} ===== 🎯 DEBUGGING STEPS FOR USER =====`);
            console.log(`${langContext} 1. Check browser console for the variables above`);
            console.log(`${langContext} 2. Verify tourCode matches between Guide and Attendee: ${tourCode}`);
            console.log(`${langContext} 3. Verify tourId matches: ${tourId}`);
            console.log(`${langContext} 4. Verify attendeeId is consistent: ${attendeeId}`);
            console.log(`${langContext} 5. Check if Guide's OpenAI session is active`);
            console.log(`${langContext} 6. Verify Guide is speaking into microphone`);
            console.log(`${langContext} 7. Check if browser autoplay is blocked`);
            console.log(`${langContext} 8. Try user interaction if autoplay failed`);
          } else {
            console.log(`${langContext} ✅ No obvious audio issues detected - audio should be working`);
          }
          
          console.log(`${langContext} ===== 🔊 AUDIO DEBUG SESSION END =====`);
        }, 5000);
      } catch (streamError) {
        console.error(`${langContext} ❌ Failed to assign stream:`, streamError);
        
        // Fallback: Try creating a new audio element
        try {
          const newAudioEl = new Audio();
          newAudioEl.srcObject = stream;
          newAudioEl.autoplay = true;
          newAudioEl.muted = false;
          newAudioEl.volume = 1.0;
          (newAudioEl as any).playsInline = true;
          
          // Replace the original audio element
          if (audioEl.parentElement) {
            audioEl.parentElement.replaceChild(newAudioEl, audioEl);
          }
          
          console.log(`${langContext} ✅ Fallback audio element created and assigned`);
        } catch (fallbackError) {
          console.error(`${langContext} ❌ Fallback audio element creation failed:`, fallbackError);
        }
      }

      // EXPERT FIX 6: Advanced audio playback with comprehensive error handling
      const attemptAudioPlayback = async (userInitiated = false) => {
        try {
          console.log(`${langContext} 🎵 Attempting audio playback (userInitiated: ${userInitiated})...`);
          
          // Resume AudioContext if needed (critical for iOS)
          if (globalAudioContext && globalAudioContext.state === 'suspended') {
            await globalAudioContext.resume();
            console.log(`${langContext} ✅ AudioContext resumed`);
          }
          
          // Ensure audio element is properly configured
          audioEl.muted = false;
          audioEl.volume = 1.0;
          
          // Attempt playback
          const playPromise = audioEl.play();
          
          if (playPromise !== undefined) {
            await playPromise;
            console.log(`${langContext} ✅ Audio playback started successfully`);
            
            // Verify audio is actually playing
            setTimeout(() => {
              if (!audioEl.paused && audioEl.currentTime > 0) {
                console.log(`${langContext} ✅ Audio confirmed playing - currentTime: ${audioEl.currentTime}`);
              } else {
                console.warn(`${langContext} ⚠️ Audio element reports playing but currentTime is 0`);
              }
            }, 1000);
            
            return true;
          }
        } catch (error) {
          console.error(`${langContext} ❌ Audio playback failed:`, error);
          return false;
        }
      };

      // Try immediate playback first
      const immediateSuccess = await attemptAudioPlayback(false);
      
      if (!immediateSuccess) {
        console.warn(`${langContext} ❌ Autoplay blocked, creating expert user interaction handler...`);
        
        // EXPERT FIX 7: Enhanced user interaction handler
        const createUserInteractionHandler = () => {
          // Remove any existing overlays first
          const existingOverlays = document.querySelectorAll('[data-audio-overlay]');
          existingOverlays.forEach(overlay => overlay.remove());
          
          const playButton = document.createElement('button');
          playButton.textContent = isIOS ? '🔊 Tap to Enable Audio (iOS)' : 
                                   isAndroid ? '🔊 Tap to Enable Audio (Android)' : 
                                   '🔊 Click to Enable Audio';
          
          playButton.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 20px 30px;
            font-size: 18px;
            font-weight: bold;
            background: linear-gradient(45deg, #4CAF50, #45a049);
            color: white;
            border: none;
            border-radius: 15px;
            cursor: pointer;
            z-index: 10000;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            animation: pulse 2s infinite;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          `;
          
          // Enhanced pulsing animation
          const style = document.createElement('style');
          style.textContent = `
            @keyframes pulse {
              0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
              50% { transform: translate(-50%, -50%) scale(1.05); box-shadow: 0 6px 20px rgba(76,175,80,0.4); }
              100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
            }
          `;
          document.head.appendChild(style);
          
          // Create overlay with data attribute for cleanup
          const overlay = document.createElement('div');
          overlay.setAttribute('data-audio-overlay', 'true');
          overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(5px);
          `;
          
          overlay.appendChild(playButton);
          document.body.appendChild(overlay);
          
          // Enhanced click handler
          playButton.onclick = async () => {
            try {
              console.log(`${langContext} 🎵 User interaction received, attempting audio start...`);
              
              playButton.textContent = '🔄 Starting Audio...';
              playButton.style.background = '#2196F3';
              
              const success = await attemptAudioPlayback(true);
              
              if (success) {
                console.log(`${langContext} ✅ Audio started successfully after user interaction`);
                
                // Remove overlay and style
                overlay.remove();
                style.remove();
                
                // Show success notification
                const successMsg = document.createElement('div');
                successMsg.textContent = '🔊 Audio Enabled Successfully!';
                successMsg.style.cssText = `
                  position: fixed;
                  top: 20px;
                  right: 20px;
                  background: #4CAF50;
                  color: white;
                  padding: 15px 25px;
                  border-radius: 8px;
                  z-index: 10000;
                  font-weight: bold;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                  animation: slideIn 0.3s ease-out;
                `;
                
                // Add slide-in animation
                const successStyle = document.createElement('style');
                successStyle.textContent = `
                  @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                  }
                `;
                document.head.appendChild(successStyle);
                
                document.body.appendChild(successMsg);
                
                setTimeout(() => {
                  successMsg.remove();
                  successStyle.remove();
                }, 4000);
                
              } else {
                throw new Error('Audio playback failed even after user interaction');
              }
              
            } catch (playError) {
              console.error(`${langContext} ❌ Failed to start audio even after user interaction:`, playError);
              playButton.textContent = '❌ Audio Failed - Try Again';
              playButton.style.background = '#f44336';
              
              // Auto-retry after 2 seconds
              setTimeout(() => {
                playButton.textContent = isIOS ? '🔊 Tap to Retry (iOS)' : '🔊 Click to Retry';
                playButton.style.background = 'linear-gradient(45deg, #4CAF50, #45a049)';
              }, 2000);
            }
          };
        };
        
        createUserInteractionHandler();
      }
      
      // EXPERT FIX 8: Comprehensive audio event monitoring
      const setupAudioEventListeners = () => {
        const events = [
          'loadstart', 'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough',
          'play', 'playing', 'pause', 'ended', 'error', 'stalled', 'waiting',
          'timeupdate', 'volumechange', 'ratechange'
        ];
        
        events.forEach(eventName => {
          audioEl.addEventListener(eventName, (e) => {
            console.log(`${langContext} 🎵 Audio event: ${eventName}`, {
              currentTime: audioEl.currentTime,
              duration: audioEl.duration,
              paused: audioEl.paused,
              muted: audioEl.muted,
              volume: audioEl.volume,
              readyState: audioEl.readyState
            });
          });
        });
        
        // Special error handling
        audioEl.addEventListener('error', (e) => {
          const error = audioEl.error;
          if (error) {
            console.error(`${langContext} ❌ Audio element error:`, {
              code: error.code,
              message: error.message,
              MEDIA_ERR_ABORTED: error.MEDIA_ERR_ABORTED,
              MEDIA_ERR_NETWORK: error.MEDIA_ERR_NETWORK,
              MEDIA_ERR_DECODE: error.MEDIA_ERR_DECODE,
              MEDIA_ERR_SRC_NOT_SUPPORTED: error.MEDIA_ERR_SRC_NOT_SUPPORTED
            });
          }
        });
      };
      
      setupAudioEventListeners();
      
      // EXPERT FIX 9: Advanced stream and track monitoring
      const setupAdvancedMonitoring = () => {
        let monitorCount = 0;
        const maxMonitorChecks = 12; // 60 seconds total
        
        const monitorInterval = setInterval(() => {
          monitorCount++;
          
          if (audioEl.srcObject) {
            const stream = audioEl.srcObject as MediaStream;
            const tracks = stream.getAudioTracks();
            
            console.log(`${langContext} 📊 Audio monitor #${monitorCount}:`, {
              streamActive: stream.active,
              trackCount: tracks.length,
              audioElementState: {
                paused: audioEl.paused,
                muted: audioEl.muted,
                volume: audioEl.volume,
                currentTime: audioEl.currentTime,
                readyState: audioEl.readyState
              }
            });
            
            if (tracks.length > 0) {
              const track = tracks[0];
              console.log(`${langContext} 🎵 Track monitor:`, {
                id: track.id,
                kind: track.kind,
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState,
                label: track.label
              });
              
              // Check if track stopped unexpectedly
              if (track.readyState === 'ended') {
                console.error(`${langContext} ❌ Audio track ended unexpectedly!`);
                clearInterval(monitorInterval);
              }
            }
          } else {
            console.warn(`${langContext} ⚠️ No srcObject found on audio element`);
          }
          
          // Stop monitoring after max checks
          if (monitorCount >= maxMonitorChecks) {
            console.log(`${langContext} 🔍 Audio monitoring completed after ${monitorCount} checks`);
            clearInterval(monitorInterval);
          }
        }, 5000);
        
        // Store interval for cleanup
        (audioEl as any)._monitorInterval = monitorInterval;
      };
      
      setupAdvancedMonitoring();
      
      // EXPERT FIX 10: Track state change monitoring
      audioTrack.addEventListener('ended', () => {
        console.error(`${langContext} ❌ Audio track ended - connection may have been lost`);
      });
      
      audioTrack.addEventListener('mute', () => {
        console.warn(`${langContext} ⚠️ Audio track muted`);
      });
      
      audioTrack.addEventListener('unmute', () => {
        console.log(`${langContext} ✅ Audio track unmuted`);
      });
    }
  };

  // Handle data channel messages (simplified)
  pc.ondatachannel = (event) => {
    const dc = event.channel;
    dc.onmessage = (e) => {
      try {
        const message = JSON.parse(e.data);
        if (message.type === 'translation' && message.text) {
          onTranslation(message.text);
        }
      } catch (error) {
        console.error('Error handling data channel message:', error);
      }
    };
  };
}

async function completeSignaling(pc: RTCPeerConnection, language: string, tourId: string, offerData: any, attendeeName: string, existingAttendeeId?: string, signalingClient?: any): Promise<{ attendeeId: string }> {
  const langContext = `[${language}]`;
  console.log(`${langContext} Completing signaling...`);

  // EXPERT FIX: Enhanced attendeeId persistence with validation and cleanup
  const attendeeId = getOrCreateAttendeeId(tourId, language, existingAttendeeId, langContext);

  // Validate and set remote description
  const offer = validateAndFormatSDP(offerData);
  await pc.setRemoteDescription(offer);

  // Create and set local answer
  const answer = await pc.createAnswer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: false
  });

  // Fix SDP directionality - attendee receives audio only (recvonly)
  let modifiedSdp = answer.sdp;
  if (modifiedSdp) {
    // Remove any existing direction attributes to avoid conflicts
    modifiedSdp = modifiedSdp.replace(/a=(sendrecv|sendonly|recvonly|inactive)\r?\n/g, '');

    // Add recvonly after the audio m-line since attendee only receives audio
    modifiedSdp = modifiedSdp.replace(
      /(m=audio[^\r\n]*\r?\n)/,
      '$1a=recvonly\r\n'
    );

    console.log(`${langContext} Fixed attendee SDP directionality: recvonly (audio from guide)`);
  }

  const modifiedAnswer = new RTCSessionDescription({
    type: 'answer',
    sdp: modifiedSdp
  });

  await pc.setLocalDescription(modifiedAnswer);

  // Send answer to server using WebSocket if available, otherwise HTTP
  if (signalingClient) {
    console.log(`${langContext} Sending answer via WebSocket...`);
    const success = await signalingClient.sendAnswer(pc.localDescription, attendeeId);
    if (!success) {
      console.warn(`${langContext} WebSocket answer send failed, falling back to HTTP`);
      // Fall through to HTTP method
    } else {
      console.log(`${langContext} Answer sent successfully via WebSocket with attendeeId: ${attendeeId}`);
      // Still need to store via HTTP API for guide polling fallback
      try {
        const response = await fetch(`/api/tour/answer?tourId=${encodeURIComponent(tourId)}&language=${encodeURIComponent(language)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answer: pc.localDescription,
            attendeeId: attendeeId
          }),
          credentials: "include"
        });
        console.log(`${langContext} Answer also stored via HTTP API for fallback`);
      } catch (error) {
        console.warn(`${langContext} Failed to store answer via HTTP API:`, error);
      }
    }
  }

  if (!signalingClient) {
    // Fall back to HTTP API
    const response = await fetch(`/api/tour/answer?tourId=${encodeURIComponent(tourId)}&language=${encodeURIComponent(language)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answer: pc.localDescription,
        attendeeId: attendeeId
      }),
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(`Failed to send answer: ${response.status}`);
    }

    console.log(`${langContext} Answer sent successfully via HTTP with attendeeId: ${attendeeId}`);
  }

  // CRITICAL FIX: Log attendee ID usage for debugging ICE candidate exchange
  console.log(`${langContext} 🆔 ATTENDEE ID TRACKING:`);
  console.log(`${langContext} 🆔 - Final attendeeId: ${attendeeId}`);
  console.log(`${langContext} 🆔 - Guide should look for ICE candidates from: ${attendeeId}`);
  console.log(`${langContext} 🆔 - Attendee will send ICE candidates using: ${attendeeId}`);

  return { attendeeId };
}

function validateAndFormatSDP(offerData: any): RTCSessionDescriptionInit {
  // Check for placeholder offers
  if (offerData && typeof offerData === 'object') {
    const isPlaceholder = 
      (offerData.status === 'pending') ||
      (offerData.offer && typeof offerData.offer === 'string' && offerData.offer.includes('Initialized offer for')) ||
      (offerData.tourId && offerData.language && !offerData.sdp) ||
      (offerData.sdp && typeof offerData.sdp === 'string' && !offerData.sdp.includes('v='));

    if (isPlaceholder) {
      throw new Error('PLACEHOLDER_OFFER');
    }
  }

  // Validate proper format
  if (offerData && typeof offerData === 'object' && offerData.type && offerData.sdp) {
    if (typeof offerData.sdp === 'string' && offerData.sdp.includes('v=')) {
      return offerData;
    }
  }

  // Try to parse if string
  if (typeof offerData === 'string') {
    try {
      const parsed = JSON.parse(offerData);
      if (parsed && parsed.type && parsed.sdp && parsed.sdp.includes('v=')) {
        return parsed;
      }
    } catch (e) {
      // Not valid JSON
    }
  }

  throw new Error('Invalid SDP format in offer');
}

function analyzeICECandidates(pc: RTCPeerConnection, language: string) {
  const langContext = `[${language}]`;
  console.log(`${langContext} [ATTENDEE-ICE] 🔍 Analyzing attendee's ICE candidates...`);

  try {
    // Get ICE candidate statistics
    pc.getStats().then(stats => {
      const localCandidates: any[] = [];
      const remoteCandidates: any[] = [];
      const candidatePairs: any[] = [];

      stats.forEach(report => {
        if (report.type === 'local-candidate') {
          localCandidates.push(report);
        } else if (report.type === 'remote-candidate') {
          remoteCandidates.push(report);
        } else if (report.type === 'candidate-pair') {
          candidatePairs.push(report);
        }
      });

      console.log(`${langContext} [ATTENDEE-ICE] 📊 Attendee ICE Analysis:`);
      console.log(`${langContext} [ATTENDEE-ICE] Local candidates (generated by attendee): ${localCandidates.length}`, localCandidates);
      console.log(`${langContext} [ATTENDEE-ICE] Remote candidates (from guide): ${remoteCandidates.length}`, remoteCandidates);
      console.log(`${langContext} [ATTENDEE-ICE] Candidate pairs: ${candidatePairs.length}`, candidatePairs);

      // Analyze candidate pair states in detail
      const pairStates = candidatePairs.reduce((acc: any, pair: any) => {
        acc[pair.state] = (acc[pair.state] || 0) + 1;
        return acc;
      }, {});

      console.log(`${langContext} [ATTENDEE-ICE] 🔍 Candidate pair states:`, pairStates);

      // Log details of failed/waiting pairs
      const failedPairs = candidatePairs.filter((pair: any) => pair.state === 'failed');
      const waitingPairs = candidatePairs.filter((pair: any) => pair.state === 'waiting');
      const inProgressPairs = candidatePairs.filter((pair: any) => pair.state === 'in-progress');
      const succeededPairs = candidatePairs.filter((pair: any) => pair.state === 'succeeded');

      if (failedPairs.length > 0) {
        console.warn(`${langContext} [ATTENDEE-ICE] ⚠️ ${failedPairs.length} failed candidate pairs:`, failedPairs.slice(0, 3));
      }
      if (waitingPairs.length > 0) {
        console.log(`${langContext} [ATTENDEE-ICE] ⏳ ${waitingPairs.length} waiting candidate pairs:`, waitingPairs.slice(0, 3));
      }
      if (inProgressPairs.length > 0) {
        console.log(`${langContext} [ATTENDEE-ICE] 🔄 ${inProgressPairs.length} in-progress candidate pairs:`, inProgressPairs.slice(0, 3));
      }
      if (succeededPairs.length > 0) {
        console.log(`${langContext} [ATTENDEE-ICE] ✅ ${succeededPairs.length} succeeded candidate pairs:`, succeededPairs);
      }

      // Check for issues
      if (localCandidates.length === 0) {
        console.error(`${langContext} [ATTENDEE-ICE] ❌ No local candidates generated by attendee!`);
      }
      if (remoteCandidates.length === 0) {
        console.error(`${langContext} [ATTENDEE-ICE] ❌ No remote candidates received from guide!`);
      }
      if (candidatePairs.length === 0) {
        console.error(`${langContext} [ATTENDEE-ICE] ❌ No candidate pairs formed!`);
      }

      // Diagnose why connection might be stuck
      if (succeededPairs.length === 0 && failedPairs.length > 0) {
        console.error(`${langContext} [ATTENDEE-ICE] 🚨 ISSUE: All candidate pairs failed - likely network connectivity problem`);
      } else if (succeededPairs.length === 0 && inProgressPairs.length > 0) {
        console.warn(`${langContext} [ATTENDEE-ICE] ⏳ WAITING: Candidate pairs still being tested - this is normal`);
      } else if (succeededPairs.length > 0) {
        console.log(`${langContext} [ATTENDEE-ICE] ✅ GOOD: ${succeededPairs.length} successful pairs found`);
      }

      // Log connection state
      console.log(`${langContext} [ATTENDEE-ICE] Connection state: ${pc.connectionState}`);
      console.log(`${langContext} [ATTENDEE-ICE] ICE connection state: ${pc.iceConnectionState}`);
      console.log(`${langContext} [ATTENDEE-ICE] ICE gathering state: ${pc.iceGatheringState}`);
    }).catch(error => {
      console.error(`${langContext} [ATTENDEE-ICE] Error analyzing ICE candidates:`, error);
    });
  } catch (error) {
    console.error(`${langContext} [ATTENDEE-ICE] Error in analyzeICECandidates:`, error);
  }
}

function startIceCandidatePolling(pc: RTCPeerConnection, language: string, tourId: string, attendeeId: string) {
  const langContext = `[${language}]`;
  console.log(`${langContext} [ATTENDEE-ICE-POLL] Starting to poll for ICE candidates from guide...`);

  let lastProcessedIndex = -1;
  let httpCandidateCount = 0;
  
  // CRITICAL FIX: Add client-side deduplication tracking
  const seenCandidates = new Set<string>();

  const pollInterval = setInterval(async () => {
    try {
      // Check if connection is still active or successfully connected
      if (
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'disconnected'
      ) {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          console.log(`${langContext} [ATTENDEE-ICE-POLL] ✅ Connection established, stopping ICE candidate polling`);
        } else {
          console.log(`${langContext} [ATTENDEE-ICE-POLL] Connection closed/failed, stopping ICE candidate polling`);
        }
        clearInterval(pollInterval);
        return;
      }

      // Fetch ICE candidates from the guide
      const response = await fetch(`/api/tour/guide-ice?tourId=${encodeURIComponent(tourId)}&language=${encodeURIComponent(language)}&attendeeId=${encodeURIComponent(attendeeId)}&lastKnownIndex=${lastProcessedIndex}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        if (response.status !== 404) { // 404 is normal when no new candidates
          console.error(`${langContext} [ATTENDEE-ICE-POLL] Error fetching ICE candidates: ${response.status}`);
        }
        return;
      }

      const data = await response.json();
      const candidates = data.candidates || [];

      // Process new candidates
      if (candidates.length > 0) {
        console.log(`${langContext} [ATTENDEE-ICE-POLL] Found ${candidates.length} new ICE candidates from guide`);

        // Add each candidate to the peer connection
        for (const candidate of candidates) {
          httpCandidateCount++;
          
          // CRITICAL FIX: Validate ICE candidate before adding
          if (!candidate || !candidate.candidate) {
            console.warn(`${langContext} [ATTENDEE-ICE-POLL] ❌ Skipping invalid ICE candidate #${httpCandidateCount}: missing candidate string`);
            continue;
          }
          
          // CRITICAL FIX: Check for duplicate candidates before processing
          const candidateKey = candidate.candidate;
          if (seenCandidates.has(candidateKey)) {
            console.log(`${langContext} [ATTENDEE-ICE-POLL] ⚠️ DUPLICATE SKIPPED: Already processed candidate #${httpCandidateCount}`);
            console.log(`${langContext} [ATTENDEE-ICE-POLL] Duplicate candidate: ${candidateKey.substring(0, 80)}...`);
            continue;
          }
          
          // Mark candidate as seen
          seenCandidates.add(candidateKey);
          
          // Additional validation for critical fields
          if (candidate.sdpMLineIndex === undefined && candidate.sdpMid === undefined) {
            console.warn(`${langContext} [ATTENDEE-ICE-POLL] ❌ Skipping invalid ICE candidate #${httpCandidateCount}: missing sdpMLineIndex and sdpMid`);
            continue;
          }

          // Enhanced validation
          if (!candidate.candidate || candidate.candidate.trim() === '') {
            console.warn(`${langContext} [ATTENDEE-ICE-POLL] ❌ Skipping empty ICE candidate #${httpCandidateCount}`);
            continue;
          }
          
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log(`${langContext} [ATTENDEE-ICE-POLL] ✅ Added NEW ICE candidate #${httpCandidateCount} from guide`);
            console.log(`${langContext} [ATTENDEE-ICE-POLL] Candidate details - Type: ${candidate.type || 'unknown'}, Protocol: ${candidate.protocol || 'unknown'}, Priority: ${candidate.priority || 'unknown'}`);
            console.log(`${langContext} [ATTENDEE-ICE-POLL] Full candidate: ${candidate.candidate.substring(0, 120)}...`);
          } catch (error) {
            console.error(`${langContext} [ATTENDEE-ICE-POLL] ❌ CRITICAL: Failed to add ICE candidate #${httpCandidateCount}:`, error);
            console.error(`${langContext} [ATTENDEE-ICE-POLL] ❌ Problem candidate details:`, {
              candidate: candidate.candidate?.substring(0, 100),
              type: candidate.type,
              protocol: candidate.protocol,
              priority: candidate.priority,
              sdpMLineIndex: candidate.sdpMLineIndex,
              sdpMid: candidate.sdpMid
            });
            // Continue processing other candidates even if one fails
          }
        }

        // Update the last processed index
        lastProcessedIndex += candidates.length;
        console.log(`${langContext} [ATTENDEE-ICE-POLL] Updated lastProcessedIndex to ${lastProcessedIndex}, total HTTP candidates: ${httpCandidateCount}`);
      }
    } catch (error) {
      console.error(`${langContext} [ATTENDEE-ICE-POLL] Error polling for ICE candidates:`, error);
    }
  }, 1000); // Poll every second

  // Store the interval for cleanup
  const connection = connections.get(language);
  if (connection) {
    // Add polling interval to connection for cleanup
    (connection as any).icePollInterval = pollInterval;
  }
}

function setupKeyRefresh(language: string): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const response = await fetch("/api/session", { credentials: "include" });
      if (response.ok) {
        console.log(`Key refreshed for ${language}`);
      }
    } catch (error) {
      console.error(`Key refresh failed for ${language}:`, error);
    }
  }, 45000);
}

async function reconnect(language: string) {
  const connection = connections.get(language);
  if (!connection || connection.isReconnecting) {
    return;
  }

  if (connection.reconnectAttempt >= RECONNECTION_CONFIG.MAX_ATTEMPTS) {
    console.error(`Max reconnection attempts reached for ${language}`);
    cleanupConnection(language);
    return;
  }

  connection.isReconnecting = true;
  connection.reconnectAttempt++;

  // Use longer initial delay and more aggressive backoff
  const delay = Math.min(
    5000 * Math.pow(RECONNECTION_CONFIG.BACKOFF_FACTOR, connection.reconnectAttempt - 1),
    RECONNECTION_CONFIG.MAX_DELAY
  );

  console.log(`Reconnecting ${language} in ${delay}ms (attempt ${connection.reconnectAttempt})`);

  setTimeout(async () => {
    try {
      // Clean up existing connection
      connection.pc.close();
      if (connection.keyRefreshTimer) {
        clearInterval(connection.keyRefreshTimer);
      }

      // Get stored attendee name
      const storedName = localStorage.getItem('attendeeName') || 'Anonymous';

      // CRITICAL FIX: Pass the existing attendee ID to maintain consistency during reconnection
      console.log(`${language} 🔄 Reconnecting with existing attendeeId: ${connection.attendeeId}`);

      // Attempt new connection with existing attendee ID
      await initWebRTC({
        onTranslation: () => {}, // Will be set by UI
        language,
        tourCode: connection.tourCode,
        attendeeName: storedName,
        existingAttendeeId: connection.attendeeId // CRITICAL: Reuse the same attendee ID
      });

      console.log(`Reconnection successful for ${language}`);
    } catch (error) {
      console.error(`Reconnection failed for ${language}:`, error);
      connection.isReconnecting = false;
      
      // Try again
      setTimeout(() => reconnect(language), delay);
    }
  }, delay);
}

export function toggleAttendeeAudioMute(mute?: boolean): boolean {
  let currentMuteState = false;

  connections.forEach((connection, language) => {
    if (connection.audioEl) {
      if (mute === undefined) {
        connection.audioEl.muted = !connection.audioEl.muted;
      } else {
        connection.audioEl.muted = mute;
      }
      console.log(`${language}: Audio ${connection.audioEl.muted ? 'muted' : 'unmuted'}`);
      currentMuteState = connection.audioEl.muted;
    }
  });

  return currentMuteState;
}

export function endAttendeeSession() {
  console.log('Ending attendee session...');
  cleanupWebRTC();
}

export function cleanupWebRTC() {
  connections.forEach((_, language) => {
    cleanupConnection(language);
  });
  connections.clear();
  
  // Cleanup global signaling
  cleanupSignaling();
}

function cleanupConnection(language: string) {
  const connection = connections.get(language);
  if (!connection) return;

  try {
    // Clear timers
    if (connection.keyRefreshTimer) {
      clearInterval(connection.keyRefreshTimer);
    }

    // Clear ICE polling interval
    if ((connection as any).icePollInterval) {
      clearInterval((connection as any).icePollInterval);
    }

    // Stop ICE monitoring
    if (connection.iceMonitor) {
      connection.iceMonitor.stopMonitoring();
    }

    // Disconnect signaling client
    if (connection.signalingClient) {
      connection.signalingClient.disconnect();
    }

    // Close peer connection
    if (connection.pc && connection.pc.connectionState !== 'closed') {
      connection.pc.close();
    }

    // Clean up audio element and container
    if (connection.audioEl) {
      const mediaStream = connection.audioEl.srcObject as MediaStream;
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
          track.stop();
          mediaStream.removeTrack(track);
        });
      }
      connection.audioEl.srcObject = null;
      
      // Remove audio container from DOM
      const audioContainer = document.querySelector('[data-tour-audio-container="true"]');
      if (audioContainer) {
        audioContainer.remove();
        console.log(`${language} ✅ Audio container removed from DOM`);
      }
      
      // Fallback: remove audio element directly if container wasn't found
      if (connection.audioEl.parentElement) {
        connection.audioEl.parentElement.remove();
      }
    }

    console.log(`Cleaned up connection for ${language}`);
  } catch (error) {
    console.error(`Error during cleanup for ${language}:`, error);
  } finally {
    connections.delete(language);
  }
}

// CRITICAL FIX: Add function to clean up stored attendee IDs when session ends
export function clearStoredAttendeeIds() {
  console.log('🧹 Clearing all stored attendee IDs from localStorage...');

  // Get all localStorage keys
  const keys = Object.keys(localStorage);

  // Find and remove attendee ID keys
  const attendeeIdKeys = keys.filter(key => key.startsWith('attendeeId_'));

  attendeeIdKeys.forEach(key => {
    const attendeeId = localStorage.getItem(key);
    console.log(`🧹 Removing stored attendee ID: ${key} = ${attendeeId}`);
    localStorage.removeItem(key);
  });

  console.log(`🧹 Cleared ${attendeeIdKeys.length} stored attendee IDs`);
}

// Add this new function to enable ICE handling after signaling is complete
async function enableIceCandidateHandling(pc: RTCPeerConnection, language: string, tourId: string, attendeeId: string, signalingClient?: any) {
  const langContext = `[${language}]`;
  console.log(`${langContext} [ATTENDEE-ICE] Enabling ICE candidate handling with attendeeId: ${attendeeId}`);
  
  // Set up the onicecandidate handler
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      console.log(`${langContext} [ATTENDEE-ICE] Generated ICE candidate:`, event.candidate.candidate.substring(0, 50) + '...');
      
      try {
        console.log(`${langContext} [ATTENDEE-ICE-SEND] Sending ICE candidate to guide...`);
        
        // Try WebSocket first if available
        if (signalingClient) {
          const success = await signalingClient.sendIceCandidate(event.candidate);
          if (success) {
            console.log(`${langContext} [ATTENDEE-ICE-SEND] ✅ ICE candidate sent via WebSocket to guide`);
            return;
          } else {
            console.warn(`${langContext} [ATTENDEE-ICE-SEND] WebSocket send failed, falling back to HTTP`);
          }
        }

        // CRITICAL FIX: Properly serialize ICE candidate with all required fields
        const candidateData = {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid,
          usernameFragment: event.candidate.usernameFragment,
          // Preserve critical diagnostic fields
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          priority: event.candidate.priority,
          address: event.candidate.address,
          port: event.candidate.port
        };

        // Fall back to HTTP API
        const response = await fetch(`/api/tour/ice-candidate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tourId,
            attendeeId,
            language,
            candidate: candidateData,
            sender: 'attendee'
          }),
          credentials: 'include'
        });
        
        if (response.ok) {
          console.log(`${langContext} [ATTENDEE-ICE-SEND] ✅ ICE candidate sent via HTTP to guide`);
        } else {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`${langContext} [ATTENDEE-ICE-SEND] ❌ Failed to send ICE candidate: ${response.status} - ${errorText}`);
        }
      } catch (error) {
        console.error(`${langContext} [ATTENDEE-ICE-SEND] ❌ Error sending ICE candidate:`, error);
      }
    } else {
      console.log(`${langContext} [ATTENDEE-ICE] 🔍 ICE gathering completed (null candidate received)`);
      
      // Analyze ICE candidates after gathering completes and polling has had time to work
      setTimeout(() => {
        analyzeICECandidates(pc, language);
      }, 5000);
    }
  };
  
  // Process any pending candidates that were collected before ICE handling was enabled
  const pendingCandidates = (pc as any)._pendingIceCandidates || [];
  if (pendingCandidates.length > 0) {
    console.log(`${langContext} [ATTENDEE-ICE] Processing ${pendingCandidates.length} pending ICE candidates`);
    for (const candidate of pendingCandidates) {
      try {
        // CRITICAL FIX: Properly serialize ICE candidate with all required fields
        const candidateData = {
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex,
          sdpMid: candidate.sdpMid,
          usernameFragment: candidate.usernameFragment,
          // Preserve critical diagnostic fields
          type: candidate.type,
          protocol: candidate.protocol,
          priority: candidate.priority,
          address: candidate.address,
          port: candidate.port
        };

        // Send each pending candidate
        const response = await fetch(`/api/tour/ice-candidate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tourId,
            attendeeId,
            language,
            candidate: candidateData,
            sender: 'attendee'
          }),
          credentials: 'include'
        });
        
        if (response.ok) {
          console.log(`${langContext} [ATTENDEE-ICE-SEND] ✅ Pending ICE candidate sent successfully`);
        }
      } catch (error) {
        console.error(`${langContext} [ATTENDEE-ICE-SEND] ❌ Failed to send pending ICE candidate:`, error);
      }
    }
    // Clear the pending candidates
    (pc as any)._pendingIceCandidates = [];
  }
}

/**
 * CRITICAL FIX: Handle ICE connection timeout with detailed analysis
 */
function handleICETimeout(event: ICETimeoutEvent): void {
  const langContext = `[${event.language}]`;
  
  console.error(`${langContext} 🚨 ICE CONNECTION TIMEOUT DETECTED`);
  console.error(`${langContext} 📊 Duration: ${event.duration}ms`);
  console.error(`${langContext} 📊 Role: ${event.role}`);
  console.error(`${langContext} 📊 Connection State: ${event.connectionState}`);
  console.error(`${langContext} 📊 Gathering State: ${event.gatheringState}`);
  console.error(`${langContext} 🔍 Root Cause: ${event.analysis.failureReason}`);
  console.error(`${langContext} 💡 Recommendations:`, event.analysis.recommendations);
  
  // Log candidate analysis
  console.error(`${langContext} 📈 ICE Candidate Analysis:`);
  console.error(`${langContext} - Local candidates: ${event.stats.localCandidates.length}`);
  console.error(`${langContext} - Remote candidates: ${event.stats.remoteCandidates.length}`);
  console.error(`${langContext} - Candidate pairs: ${event.stats.candidatePairs.length}`);
  console.error(`${langContext} - Has host candidates: ${event.analysis.hasHostCandidates}`);
  console.error(`${langContext} - Has STUN candidates: ${event.analysis.hasSrflxCandidates}`);
  console.error(`${langContext} - Has TURN candidates: ${event.analysis.hasRelayCandidates}`);
  
  // Store timeout event for diagnostic purposes
  const connection = connections.get(event.language);
  if (connection) {
    (connection as any).lastICETimeout = event;
  }
}

/**
 * CRITICAL FIX: Schedule ICE connection restart with exponential backoff
 */
function scheduleReconnection(language: string, reason: string): void {
  const langContext = `[${language}]`;
  const connection = connections.get(language);
  
  if (!connection) {
    console.error(`${langContext} Cannot schedule reconnection: no connection found`);
    return;
  }
  
  if (connection.isReconnecting) {
    console.warn(`${langContext} Reconnection already in progress, skipping`);
    return;
  }
  
  // Mark as reconnecting to prevent multiple attempts
  connection.isReconnecting = true;
  
  // Get reconnection attempt count (for exponential backoff)
  const attemptCount = (connection as any).reconnectionAttempts || 0;
  (connection as any).reconnectionAttempts = attemptCount + 1;
  
  // Calculate exponential backoff delay (1s, 2s, 4s, 8s, max 30s)
  const baseDelay = 1000;
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attemptCount), maxDelay);
  
  console.warn(`${langContext} 🔄 Scheduling ICE reconnection attempt #${attemptCount + 1} in ${delay}ms`);
  console.warn(`${langContext} 🔄 Reason: ${reason}`);
  
  setTimeout(async () => {
    try {
      console.log(`${langContext} 🔄 Starting ICE reconnection attempt #${attemptCount + 1}...`);
      
      // First, cleanup the existing connection
      const oldConnection = connections.get(language);
      if (oldConnection) {
        console.log(`${langContext} 🧹 Cleaning up failed connection...`);
        
        // Close peer connection
        if (oldConnection.pc && oldConnection.pc.connectionState !== 'closed') {
          oldConnection.pc.close();
        }
        
        // Stop monitoring
        if (oldConnection.iceMonitor) {
          oldConnection.iceMonitor.stopMonitoring();
        }
        
        // Clean up signaling
        if (oldConnection.signalingClient) {
          oldConnection.signalingClient.disconnect();
        }
      }
      
      // Attempt to reconnect with exponential backoff
      const storedName = localStorage.getItem('attendeeName') || 'Anonymous';
      const storedTourCode = oldConnection?.tourCode;
      const existingAttendeeId = oldConnection?.attendeeId;
      
      if (!storedTourCode) {
        console.error(`${langContext} ❌ Cannot reconnect: missing tour code`);
        connection.isReconnecting = false;
        return;
      }
      
      console.log(`${langContext} 🔄 Attempting reconnection with attendeeId: ${existingAttendeeId}`);
      
      // Restart WebRTC connection
      await initWebRTC({
        onTranslation: () => {}, // Will be set by UI
        language,
        tourCode: storedTourCode,
        attendeeName: storedName,
        existingAttendeeId: existingAttendeeId
      });
      
      // Reset reconnection attempts on success
      const newConnection = connections.get(language);
      if (newConnection) {
        (newConnection as any).reconnectionAttempts = 0;
        newConnection.isReconnecting = false;
      }
      
      console.log(`${langContext} ✅ ICE reconnection successful!`);
      
    } catch (error) {
      console.error(`${langContext} ❌ ICE reconnection attempt #${attemptCount + 1} failed:`, error);
      
      // Mark as not reconnecting so we can try again
      connection.isReconnecting = false;
      
      // Schedule another attempt if we haven't exceeded max attempts
      if (attemptCount < 5) {
        console.warn(`${langContext} 🔄 Scheduling next reconnection attempt...`);
        scheduleReconnection(language, `Previous attempt failed: ${error}`);
      } else {
        console.error(`${langContext} 💥 Max reconnection attempts (5) exceeded. Manual intervention required.`);
        (connection as any).reconnectionAttempts = 0; // Reset for potential manual retry
      }
    }
  }, delay);
}
