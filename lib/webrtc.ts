// Global connections manager
const connections = new Map<string, {
  pc: RTCPeerConnection,
  audioEl: HTMLAudioElement,
  tourCode: string,
  keyRefreshTimer: NodeJS.Timeout | null,
  audioContext?: AudioContext
}>();

// Audio configuration
const AUDIO_CODEC_PREFERENCES = [
  'opus/48000/2',
  'PCMU/8000',
  'PCMA/8000'
];

export async function initWebRTC(
  setTranslation: (text: string) => void,
  language: string,
  tourCode: string,
  options?: { signal?: AbortSignal }
) {
  try {
      // 1. Initialize connection and fetch offer
      const { offer, tourId } = await fetchTourOffer(tourCode, language);
      localStorage.setItem('currentTourId', tourId);

      // 2. Set up ephemeral key refresh
      const keyRefreshTimerId = setupKeyRefresh(language);

      // 3. Create optimized peer connection
      const { pc, audioEl } = createPeerConnection(language, tourCode, setTranslation);

      // 4. Configure media handlers
      setupMediaHandlers(pc, audioEl, setTranslation);

      // 5. Complete signaling
      await completeSignaling(pc, language, tourId);

      // 6. Store connection
      connections.set(language, { 
          pc, 
          audioEl, 
          tourCode, 
          keyRefreshTimer: keyRefreshTimerId 
      });

      // Cleanup on abort
      options?.signal?.addEventListener('abort', () => cleanupConnection(language));

  } catch (error) {
      console.error(`WebRTC initialization error for ${language}:`, error);
      throw error;
  }
}

// ========== Helper Functions ========== //

async function fetchTourOffer(tourCode: string, language: string) {
  const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}`);
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to join tour: ${response.status} ${response.statusText} ${errorText}`);
    throw new Error('Failed to join tour');
  }

  const data = await response.json();
  if (!data.offer) await pollForOffer(tourCode, language);

  return data;
}

async function pollForOffer(tourCode: string, language: string) {
  let attempts = 0;
  while (attempts++ < 12) { // 1 minute max
      await new Promise(resolve => setTimeout(resolve, 5000));
      const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}`);
      if (response.ok) {
          const data = await response.json();
          if (data.offer) return data;
      }
  }
  throw new Error('Timeout waiting for offer');
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

  // Connection state handlers
  pc.oniceconnectionstatechange = () => {
      if (["disconnected", "failed"].includes(pc.iceConnectionState)) {
          reconnect(setTranslation, language);
      }
  };

  return { pc, audioEl };
}

function setupMediaHandlers(pc: RTCPeerConnection, audioEl: HTMLAudioElement, setTranslation: (text: string) => void) {
  // Media track handler
  pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
          audioEl.srcObject = event.streams[0];
          audioEl.play().catch(e => console.error("Autoplay blocked:", e));
      }
  };

  // Data channel handler
  pc.ondatachannel = (event) => {
      const dc = event.channel;
      dc.onmessage = (e) => handleDataMessage(e, setTranslation);
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

  try {
      connection.pc.close();
      if (connection.keyRefreshTimer) clearInterval(connection.keyRefreshTimer);
      
      await initWebRTC(setTranslation, language, connection.tourCode);
  } catch (error) {
      console.error(`Reconnection failed for ${language}:`, error);
  }
}

export function cleanupWebRTC() {
  connections.forEach((connection, language) => {
      connection.pc.close();
      if (connection.keyRefreshTimer) clearInterval(connection.keyRefreshTimer);
      if (connection.audioContext) connection.audioContext.close();
  });
  connections.clear();
}

function cleanupConnection(language: string) {
  const connection = connections.get(language);
  if (connection) {
      connection.pc.close();
      if (connection.keyRefreshTimer) clearInterval(connection.keyRefreshTimer);
      connections.delete(language);
  }
}
