import { executeReplaceOfferTransaction, normalizeLanguageForStorage } from "@/lib/languageUtils";
import { getSignalingClient, initializeSignaling } from "@/lib/webrtcSignaling";
import { createICEMonitor, handleICETimeout, type ICETimeoutEvent } from "@/lib/iceConnectionMonitor";
import { forwardAudioToAttendees } from "@/lib/audioHandlerFix";
import { getStaticXirsysICEServers, createStaticXirsysRTCConfiguration } from "@/lib/xirsysConfig";

// Audio monitoring and connection handling classes
class AudioMonitor {
  private audioContext: AudioContext;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private monitorInterval: NodeJS.Timeout | null = null;
  private instructionRefreshInterval: NodeJS.Timeout | null = null;

  constructor(stream: MediaStream) {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  startMonitoring(onSilence: () => void, onActive: () => void, onSpeechResumed?: () => void) {
    let silenceCounter = 0;
    let wasInSilence = false;

    this.monitorInterval = setInterval(() => {
      this.analyser.getByteFrequencyData(this.dataArray);
      const sum = this.dataArray.reduce((acc, val) => acc + val, 0);
      const audioLevel = sum / this.dataArray.length / 255;

      if (audioLevel < 0.01) {
        silenceCounter++;
        if (silenceCounter > 50) {
          wasInSilence = true;
          onSilence();
        }
      } else {
        // If we were in silence and now have audio, trigger speech resumed
        if (wasInSilence && silenceCounter > 50 && onSpeechResumed) {
          onSpeechResumed();
        }
        silenceCounter = 0;
        wasInSilence = false;
        onActive();
      }
    }, 100);
  }

  // Start periodic instruction refresh
  startInstructionRefresh(onRefreshNeeded: () => void, intervalMs: number = 120000) {
    this.instructionRefreshInterval = setInterval(() => {
      onRefreshNeeded();
    }, intervalMs);
  }

  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    if (this.instructionRefreshInterval) {
      clearInterval(this.instructionRefreshInterval);
      this.instructionRefreshInterval = null;
    }
    this.audioContext.close();
  }
}

class StatsCollector {
  private stats: Array<{
    timestamp: number;
    rtt: number;
    packetsLost: number;
    packetsReceived?: number;
    bytesReceived?: number;
    audioInputLevel?: number;
    audioOutputLevel?: number;
    jitter?: number;
    audioEnergy?: number;
  }> = [];

  async collectStats(pc: RTCPeerConnection) {
    const stats = await pc.getStats();
    const currentStats = {
      timestamp: Date.now(),
      rtt: 0,
      packetsLost: 0,
      packetsReceived: 0,
      bytesReceived: 0,
      jitter: 0,
      audioEnergy: 0,
      hasAudioData: false
    };

    stats.forEach(report => {
      // Connection stats
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        currentStats.rtt = report.currentRoundTripTime;
        currentStats.packetsLost = report.packetsLost || 0;
      }

      // Audio inbound stats - critical for diagnosing audio issues
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        currentStats.packetsReceived = report.packetsReceived || 0;
        currentStats.bytesReceived = report.bytesReceived || 0;
        currentStats.packetsLost = report.packetsLost || 0;
        currentStats.jitter = report.jitter || 0;

        // Check if we're actually receiving audio data
        if (report.bytesReceived > 0 && report.packetsReceived > 0) {
          currentStats.hasAudioData = true;
        }
      }

      // Audio track stats
      if (report.type === 'track' && report.kind === 'audio') {
        currentStats.audioEnergy = report.audioLevel || report.totalAudioEnergy || 0;
      }
    });

    this.stats.push(currentStats);
    this.stats = this.stats.filter(s => s.timestamp > Date.now() - 5 * 60 * 1000);

    return currentStats;
  }
}

interface AttendeeConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  iceMonitor?: any; // ICE connection monitor
}

// Track active connections and sent instructions by language
const openAIConnectionsByLanguage = new Map<string, OpenAIConnection>();
// Track attendee connections by language
const attendeeConnectionsByLanguage = new Map<string, Map<string, AttendeeConnection>>();
const sentInstructions = new Set<string>();

// Lazy initialization of AudioContext to avoid SSR issues
let sharedAudioContext: AudioContext | null = null;

// Function to safely get or create AudioContext
function getAudioContext(): AudioContext {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') {
    throw new Error('AudioContext is not available in server-side environment');
  }

  // Create AudioContext if it doesn't exist yet
  if (!sharedAudioContext) {
    // Use the standard AudioContext or the prefixed version for older browsers
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AudioContext is not supported in this browser');
    }
    sharedAudioContext = new AudioContextClass();
  }

  return sharedAudioContext;
}

// Audio instruction loading function removed

// Audio tracks verification function removed

// Audio segment sending function removed

/**
 * Gets translation instructions for a specific language
 * @param language The target language for translation
 * @returns The translation instructions optimized for OpenAI Realtime API
 */
function getTranslationInstructions(language: string): string {
  return `You are an expert live Tour Translator. Your role is to provide real-time translation of spoken content.

CRITICAL INSTRUCTIONS:
- Translate ONLY into ${language}
- Translate exactly what you hear - do not add, omit, or interpret
- Maintain the speaker's tone and emotion
- Use natural, colloquial ${language} that sounds native
- Begin translation immediately when you detect speech
- Continue translating until speech stops
- Do NOT answer questions or provide commentary
- Do NOT speak in any language other than ${language}
- If you hear multiple languages, translate everything into ${language}

RESPONSE FORMAT:
- Provide only the translation
- No prefixes like "Translation:" or explanations
- Speak naturally as if you are the original speaker in ${language}

Begin translation now.`;
}

/**
 * Sends system-level translation instructions to OpenAI using session.update
 * @param dataChannel The WebRTC data channel to send instructions through
 * @param language The target language for translation
 * @param langContext The language context for logging
 * @param forceResend Whether to force resending instructions even if previously sent
 */
function sendTranslationInstructions(
  dataChannel: RTCDataChannel,
  language: string,
  langContext: string,
  forceResend: boolean = false
): void {
  try {
    // Skip if data channel is not open
    if (dataChannel.readyState !== 'open') {
      console.warn(`${langContext} Data channel not open, cannot send instructions`);
      return;
    }

    // Skip if instructions already sent and not forcing resend
    if (sentInstructions.has(language) && !forceResend) {
      console.log(`${langContext} Instructions already sent for ${language}, skipping`);
      return;
    }

    // Get instructions for the language
    const instructions = getTranslationInstructions(language);

    // CORRECTED: Use session.update for system instructions (not response.create)
    const sessionUpdateEvent = {
      type: "session.update",
      session: {
        instructions: instructions,
        // Ensure modalities are set correctly
        modalities: ["audio", "text"],
        // Maintain VAD settings
        turn_detection: {
          type: "server_vad",
          silence_duration_ms: 300,
          create_response: true
        }
      }
    };

    // Send the session update with instructions
    console.log(`${langContext} ${forceResend ? 'Resending' : 'Sending'} system instructions for ${language} translation via session.update`);
    dataChannel.send(JSON.stringify(sessionUpdateEvent));
    console.log(`${langContext} System translation instructions sent successfully`);

    // Mark instructions as sent
    sentInstructions.add(language);
  } catch (error) {
    console.error(`${langContext} Error sending translation instructions:`, error);
  }
}

interface OpenAIConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioMonitor?: AudioMonitor;
  statsCollector?: StatsCollector;
  audioElement?: HTMLAudioElement;
  audioStream?: MediaStream;
  microphoneTracks?: MediaStreamTrack[]; // Store microphone tracks for proper cleanup
  answerPollInterval?: NodeJS.Timeout;
  signalingClient?: any; // WebSocket signaling client
}

interface OpenAITrackDetails {
  id: string;
  readyState: string;
  enabled: boolean;
  muted: boolean;
}

/**
 * Updates the guide's audio element state based on attendee connections
 * DISABLED: This was incorrectly muting OpenAI translated audio that should go to attendees
 * @param language The language to update audio state for
 */
function updateGuideAudioState(language: string): void {
  const langContext = `[${language}]`;
  const connection = openAIConnectionsByLanguage.get(language);
  if (!connection || !connection.audioElement) {
    console.log(`${langContext} No audio element found to update`);
    return;
  }

  const attendeeConnections = attendeeConnectionsByLanguage.get(language) || new Map();
  const hasAttendees = attendeeConnections.size > 0;

  // DISABLED: This was muting OpenAI translated audio instead of guide microphone feedback
  // The OpenAI audio should ALWAYS be available for forwarding to attendees
  console.log(`${langContext} Guide audio state update: ${attendeeConnections.size} attendee(s) connected, keeping OpenAI audio unmuted for forwarding`);

  // Ensure OpenAI audio is always unmuted so it can be forwarded to attendees
  if (connection.audioElement && connection.audioElement.muted) {
    connection.audioElement.muted = false;
    console.log(`${langContext} ✅ OpenAI audio unmuted to enable forwarding to attendees`);
  }
}

export async function initGuideWebRTC(
  setTranslation: (translation: string) => void,
  language: string,
  setAttendees: (attendees: string[]) => void,
  tourId: string,
  tourCode: string
): Promise<void> {
  // Ensure language is normalized to lowercase for consistent key storage
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const langContext = `[${normalizedLanguage}]`;
  console.log(`${langContext} Initializing Guide WebRTC with WebSocket signaling... (original: ${language})`);

  // Cleanup existing connection for this language if it exists
  if (openAIConnectionsByLanguage.has(normalizedLanguage)) {
    console.log(`${langContext} Cleaning up existing connection before reinitializing`);
    cleanupGuideWebRTC(normalizedLanguage);
  }

  // Use tourCode directly for WebSocket room consistency with attendees
  console.log(`${langContext} Using tourCode for WebSocket: ${tourCode} (tourId: ${tourId})`);

  // Initialize WebSocket signaling first
  console.log(`${langContext} Initializing WebSocket signaling for guide...`);
  const signalingClient = await initializeSignaling(tourCode, normalizedLanguage, 'guide');
  
  if (!signalingClient) {
    console.error(`${langContext} Failed to initialize WebSocket signaling`);
    // Fall back to HTTP polling
    console.log(`${langContext} Falling back to HTTP polling for signaling`);
  } else {
    console.log(`${langContext} ✅ WebSocket signaling initialized successfully`);
  }

  // Log existing connections for debugging
  if (openAIConnectionsByLanguage.size > 0) {
    console.log(`${langContext} Existing connections before setup:`);
    for (const [existingLang, conn] of openAIConnectionsByLanguage.entries()) {
      console.log(`${langContext} - ${existingLang}: Connection state=${conn.pc.connectionState}, tracks=${conn.microphoneTracks?.length || 0}`);
    }
  }

  const connection = await setupOpenAIConnection(normalizedLanguage, setTranslation, setAttendees, tourId, signalingClient);
  if (connection) {
    // Check if connection was already stored (timing fix)
    if (!openAIConnectionsByLanguage.has(normalizedLanguage)) {
      openAIConnectionsByLanguage.set(normalizedLanguage, connection);
    }
    console.log(`${langContext} Guide WebRTC initialized successfully`);
  } else {
    console.error(`${langContext} Failed to initialize Guide WebRTC`);
    throw new Error(`Failed to initialize WebRTC for ${normalizedLanguage}`);
  }
}

/**
 * Toggles the mute state of the guide's microphone without disconnecting WebRTC connections
 * @param mute Whether to mute (true) or unmute (false) the microphone
 */
export function toggleMicrophoneMute(mute: boolean): void {
  console.log(`${mute ? 'Muting' : 'Unmuting'} guide microphone...`);

  // Iterate through all language connections
  for (const [language, connection] of openAIConnectionsByLanguage.entries()) {
    const langContext = `[${language}]`;

    // Find all audio senders in the peer connection
    const audioSenders = connection.pc.getSenders().filter(sender =>
      sender.track && sender.track.kind === 'audio'
    );

    if (audioSenders.length === 0) {
      console.warn(`${langContext} No audio senders found to ${mute ? 'mute' : 'unmute'}`);
      continue;
    }

    // Toggle the enabled state of each audio track
    audioSenders.forEach(sender => {
      if (sender.track) {
        sender.track.enabled = !mute;
        console.log(`${langContext} ${mute ? 'Muted' : 'Unmuted'} audio track: ${sender.track.id}`);
      }
    });

    console.log(`${langContext} Microphone ${mute ? 'muted' : 'unmuted'} successfully`);
  }
}

export function cleanupGuideWebRTC(specificLanguage?: string): void {
  // Normalize language for consistent cleanup if specified
  const normalizedSpecificLanguage = specificLanguage ? normalizeLanguageForStorage(specificLanguage) : undefined;
  console.log(`Cleaning up Guide WebRTC connection${normalizedSpecificLanguage ? ` for ${normalizedSpecificLanguage}` : 's'}...`);


  const cleanupConnection = (language: string, connection: OpenAIConnection) => {
    const langContext = `[${language}]`;
    console.log(`${langContext} Cleaning up connection...`);

    // Stop audio monitoring
    if (connection.audioMonitor) {
      connection.audioMonitor.stop();
    }

    // Clean up audio element
    if (connection.audioElement) {
      connection.audioElement.srcObject = null;
    }

    // Handle microphone tracks carefully - only stop if not used by other connections
    if (connection.microphoneTracks && connection.microphoneTracks.length > 0) {
      console.log(`${langContext} Checking if microphone tracks can be stopped...`);

      // Check if any other active connections are using these tracks
      let tracksInUse = false;
      const trackIds = connection.microphoneTracks.map(track => track.id);

      for (const [otherLang, otherConn] of openAIConnectionsByLanguage.entries()) {
        // Skip the current connection being cleaned up
        if (otherLang === language) continue;

        // Check if the other connection is using any of our tracks
        if (otherConn.microphoneTracks) {
          const sharedTracks = otherConn.microphoneTracks.filter(track =>
            trackIds.includes(track.id) && track.readyState === 'live'
          );

          if (sharedTracks.length > 0) {
            console.log(`${langContext} Microphone tracks are still in use by ${otherLang} connection, not stopping them`);
            tracksInUse = true;
            break;
          }
        }
      }

      // Only stop tracks if they're not used by other connections
      if (!tracksInUse) {
        console.log(`${langContext} Stopping ${connection.microphoneTracks.length} microphone tracks...`);
        connection.microphoneTracks.forEach(track => {
          track.stop();
          console.log(`${langContext} Stopped microphone track: ${track.id}`);
        });
      } else {
        console.log(`${langContext} Microphone tracks are shared with other connections, not stopping them`);
      }
    } else {
      console.log(`${langContext} No microphone tracks to stop`);
    }

    // Close data channel if open
    if (connection.dc.readyState === 'open') {
      connection.dc.close();
    }

    // Close peer connection if not already closed
    if (connection.pc.connectionState !== 'closed') {
      connection.pc.close();
    }

    // Clean up attendee connections
    const attendeeConnections = attendeeConnectionsByLanguage.get(language);
    if (attendeeConnections) {
      for (const [attendeeId, _] of attendeeConnections.entries()) {
        cleanupAttendeeConnection(language, attendeeId);
      }
    }

    // Clear the answer polling interval
    if (connection.answerPollInterval) {
      clearInterval(connection.answerPollInterval);
    }

    // Disconnect signaling client
    if (connection.signalingClient) {
      connection.signalingClient.disconnect();
    }

    // Remove from tracked connections
    openAIConnectionsByLanguage.delete(language);
  };

  if (normalizedSpecificLanguage) {
    const connection = openAIConnectionsByLanguage.get(normalizedSpecificLanguage);
    if (connection) {
      cleanupConnection(normalizedSpecificLanguage, connection);
      console.log(`[${normalizedSpecificLanguage}] Connection cleaned up`);
    }
  } else {
    // Clean up all connections
    for (const [language, connection] of openAIConnectionsByLanguage.entries()) {
      cleanupConnection(language, connection);
    }
    openAIConnectionsByLanguage.clear();
    console.log('All Guide WebRTC connections cleaned up');
  }
}

async function setupOpenAIConnection(
  language: string,
  setTranslation: (translation: string) => void,
  setAttendees: (attendees: string[]) => void,
  tourId: string,
  signalingClient?: any
): Promise<OpenAIConnection | null> {
  const langContext = `[${language}]`;
  console.log(`${langContext} Setting up OpenAI connection...`);

  let ephemeralKeyExpiryTime: number | null = null;
  let EPHEMERAL_KEY: string | null = null;

  async function fetchEphemeralKey(): Promise<{ key: string; expires: number }> {
    console.log(`${langContext} Fetching ephemeral key...`);
    try {
      const response = await fetch('/api/session');
      if (!response.ok) {
        throw new Error(`Session API error: ${response.status}`);
      }
      const data = await response.json();
      const key = data.client_secret.value;
      ephemeralKeyExpiryTime = Date.now() + 60000; // For logging only
      console.log(`${langContext} Ephemeral key obtained, expires approx: ${new Date(ephemeralKeyExpiryTime).toISOString()}`);
      return { key: key, expires: ephemeralKeyExpiryTime };
    } catch (error) {
      console.error(`${langContext} Error fetching ephemeral key:`, error);
      throw error;
    }
  }

  try {
    console.log(`${langContext} Fetching initial ephemeral key...`);
    const keyData = await fetchEphemeralKey();
    EPHEMERAL_KEY = keyData.key;
    console.log(`${langContext} Initial ephemeral key obtained successfully.`);
  } catch (error) {
    console.error(`${langContext} Initial ephemeral key fetch failed:`, error);
    return null;
  }

  // Create and configure the OpenAI peer connection with Xirsys
  let openaiPC: RTCPeerConnection;

  try {
    console.log(`${langContext} [GUIDE-OPENAI-ICE] Using static Xirsys TURN configuration for OpenAI connection...`);

    // EXPERT FIX: Use static TURN configuration for guaranteed consistency
    const xirsysServers = getStaticXirsysICEServers();
    console.log(`${langContext} [GUIDE-OPENAI-ICE] ✅ Using static jb-turn1.xirsys.com configuration (${xirsysServers.length} servers)`);
    
    openaiPC = new RTCPeerConnection(createStaticXirsysRTCConfiguration());
  } catch (error) {
    console.warn(`${langContext} [GUIDE-OPENAI-ICE] ⚠️ Xirsys unavailable, using fallback servers:`, error);

    // Fallback to public servers
    openaiPC = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
        { urls: "stun:stun.cloudflare.com:3478" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ],
      // Expert WebRTC configuration optimized for production
      iceCandidatePoolSize: 6,   // Increased for global infrastructure
      bundlePolicy: 'max-bundle', // Bundle all media on single transport
      rtcpMuxPolicy: 'require',   // Multiplex RTP and RTCP for efficiency
      iceTransportPolicy: 'all'   // Use all transport types
    });
  }

  console.log(`${langContext} [GUIDE-OPENAI-ICE] Created OpenAI peer connection with ${openaiPC.getConfiguration().iceServers?.length} ICE servers (Xirsys TURN/STUN)`);

  // Instruction audio loading removed

  // Create data channel for OpenAI events
  const openaiDC = openaiPC.createDataChannel('oai-events');

  /**
   * Updates the session settings to optimize VAD for real-time translation
   * Note: This function is now integrated into sendTranslationInstructions to avoid conflicts
   * @param dataChannel The WebRTC data channel to send updates through
   * @param langContext The language context for logging
   */
  function updateSessionVADSettings(dataChannel: RTCDataChannel, langContext: string): void {
    try {
      if (dataChannel.readyState !== 'open') {
        console.warn(`${langContext} Data channel not open, cannot update VAD settings`);
        return;
      }

      // Note: VAD settings are now included in the main session.update with instructions
      // This function is kept for backward compatibility but should use the combined approach
      console.log(`${langContext} VAD settings are now managed through sendTranslationInstructions to avoid session conflicts`);

      // If instructions haven't been sent yet, send them with VAD settings
      if (!sentInstructions.has(language)) {
        const instructions = getTranslationInstructions(language);
        const sessionUpdateEvent = {
          type: "session.update",
          session: {
            instructions: instructions,
            modalities: ["audio", "text"],
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 300,
              create_response: true
            }
          }
        };

        console.log(`${langContext} Sending combined instructions and VAD settings`);
        dataChannel.send(JSON.stringify(sessionUpdateEvent));
        sentInstructions.add(language);
      }
    } catch (error) {
      console.error(`${langContext} Error updating session VAD settings:`, error);
    }
  }

  // Add onopen handler to send instructions when the channel is ready
  openaiDC.onopen = () => {
    console.log(`${langContext} Data channel opened, sending translation instructions`);
    sendTranslationInstructions(openaiDC, language, langContext);

    // Update VAD settings for more responsive translations
    updateSessionVADSettings(openaiDC, langContext);
  };

  openaiDC.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      console.log(`${langContext} Received message type: ${data.type}`);
      switch (data.type) {
        case 'response.text.delta':
          if (data.delta) {
            // Pass language-specific translation
            setTranslation(data.delta);
            console.log(`${langContext} Translation received for ${language}:`, data.delta);

            // Forward to attendees
            forwardTranslationToAttendees(language, data.delta);
          }
          break;
        case 'response.audio.start':
          console.log(`${langContext} Audio translation started for ${language}`);
          break;
        case 'response.audio.end':
          console.log(`${langContext} Audio translation completed for ${language}`);
          break;
        case 'session.updated':
          console.log(`${langContext} Session updated successfully:`, data.session);
          // Log VAD settings if present
          if (data.session?.turn_detection) {
            console.log(`${langContext} VAD settings:`, {
              type: data.session.turn_detection.type,
              silence_duration_ms: data.session.turn_detection.silence_duration_ms,
              create_response: data.session.turn_detection.create_response
            });
          }
          break;
        case 'input_audio_buffer.speech_stopped':
          console.log(`${langContext} Speech stopped, OpenAI may generate a response`);
          // Resend instructions after speech stops to maintain context
          sendTranslationInstructions(openaiDC, language, langContext, true);
          break;
        case 'error':
          console.error(`${langContext} Error from OpenAI:`, data.error || data);
          // If we get an error related to VAD or turn detection, try to update settings
          if (data.error?.message?.toLowerCase().includes('turn') ||
              data.error?.message?.toLowerCase().includes('vad') ||
              data.error?.message?.toLowerCase().includes('detection')) {
            console.log(`${langContext} Attempting to fix VAD settings after error`);
            updateSessionVADSettings(openaiDC, langContext);
          }
          break;
        case 'response.error':
          console.error(`${langContext} Translation error for ${language}:`, data.error);
          break;
        case 'output_audio_buffer.started':
          console.log(`${langContext} 🎵 Audio output generation started`);
          break;
        case 'output_audio_buffer.delta':
          console.log(`${langContext} 🎵 Audio output delta received (${data.delta ? 'with data' : 'empty'})`);
          // The actual audio data is sent via WebRTC audio track, not data channel
          // This event just indicates audio is being generated
          break;
        case 'output_audio_buffer.done':
          console.log(`${langContext} 🎵 Audio output generation completed`);
          break;
        case 'output_audio_buffer.stopped':
          console.log(`${langContext} 🎵 Audio output stopped`);
          break;
        default:
          console.log(`${langContext} Received message for ${language}:`, data);
      }
    } catch (error) {
      console.error(`${langContext} Error processing data channel message:`, error);
    }
  };

  // Initialize stats collector
  const statsCollector = new StatsCollector();
  let statsInterval: NodeJS.Timeout | null = null;

  // Get microphone access and set up audio processing
  let audioMonitor: AudioMonitor | null = null;
  let microphoneTracks: MediaStreamTrack[] = [];
  try {
    console.log(`${langContext} Requesting microphone access...`);

    // Check if we already have an active microphone stream from another connection
    let existingMicStream: MediaStream | null = null;
    let sourceLanguage: string | null = null;

    // First, look for an existing connection with live tracks
    for (const [existingLang, conn] of openAIConnectionsByLanguage.entries()) {
      if (conn.microphoneTracks && conn.microphoneTracks.length > 0 &&
          conn.microphoneTracks[0].readyState === 'live') {
        console.log(`${langContext} Found existing LIVE microphone stream from ${existingLang} connection`);
        console.log(`${langContext} Track details: id=${conn.microphoneTracks[0].id}, enabled=${conn.microphoneTracks[0].enabled}`);

        // Create a new stream with cloned tracks to avoid interference
        existingMicStream = new MediaStream();
        conn.microphoneTracks.forEach(track => {
          // Don't clone, use the same track to ensure mute state is synchronized
          existingMicStream!.addTrack(track);
        });

        sourceLanguage = existingLang;
        break;
      }
    }

    // Use existing stream or request a new one
    let stream: MediaStream;
    if (existingMicStream) {
      console.log(`${langContext} Reusing existing microphone stream from ${sourceLanguage} connection`);
      stream = existingMicStream;

      // Log all tracks in the reused stream
      const tracks = stream.getTracks();
      console.log(`${langContext} Reused stream has ${tracks.length} tracks:`);
      tracks.forEach((track, index) => {
        console.log(`${langContext} Track ${index}: id=${track.id}, kind=${track.kind}, enabled=${track.enabled}, readyState=${track.readyState}`);
      });
    } else {
      console.log(`${langContext} No existing microphone stream found, requesting new one...`);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this environment');
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Mono audio for better translation
          sampleRate: 16000, // Optimal for speech recognition
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log(`${langContext} New microphone stream acquired successfully`);
    }

    // Get and store microphone tracks for later cleanup
    microphoneTracks = stream.getTracks();
    console.log(`${langContext} Acquired ${microphoneTracks.length} microphone tracks`);
    microphoneTracks.forEach(track => {
      console.log(`${langContext} Microphone track: ${track.id}, kind: ${track.kind}, readyState: ${track.readyState}, enabled=${track.enabled}`);
    });

    // Set up audio monitoring with speech resumption handler
    audioMonitor = new AudioMonitor(stream);
    audioMonitor.startMonitoring(
      () => {/* Silence detected - log removed */},
      () => {/* Audio activity detected - log removed */},
      () => {
        // Speech resumed after silence - resend instructions
        if (openaiDC.readyState === 'open') {
          console.log(`${langContext} Speech resumed after silence, resending translation instructions`);
          sendTranslationInstructions(openaiDC, language, langContext, true);
        }
      }
    );

    // Set up periodic instruction refresh (every 2 minutes)
    audioMonitor.startInstructionRefresh(() => {
      if (openaiDC.readyState === 'open') {
        console.log(`${langContext} Periodic instruction refresh, resending translation instructions`);
        sendTranslationInstructions(openaiDC, language, langContext, true);

        // Also refresh VAD settings periodically to ensure they're maintained
        updateSessionVADSettings(openaiDC, langContext);
      }
    }, 120000);

    // Add audio track to peer connection
    microphoneTracks.forEach(track => {
      console.log(`${langContext} 🎤 Adding microphone track to OpenAI: id=${track.id}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      openaiPC.addTrack(track, stream);
    });

    // Instruction audio playback removed
  } catch (error) {
    console.error(`${langContext} Error accessing microphone:`, error);
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      console.error(`${langContext} Microphone access denied by user or system`);
      throw new Error(`Microphone access denied. Please allow microphone access and try again.`);
    } else if (error instanceof DOMException && error.name === 'NotFoundError') {
      console.error(`${langContext} No microphone found`);
      throw new Error(`No microphone found. Please connect a microphone and try again.`);
    } else if (error instanceof DOMException && error.name === 'NotReadableError') {
      console.error(`${langContext} Microphone is already in use by another application`);
      throw new Error(`Microphone is already in use by another application. Please close other applications using the microphone.`);
    }
    return null;
  }

  // Create audio element for remote stream - OpenAI specification
  const audioElement = document.createElement('audio');
  audioElement.autoplay = true;
  audioElement.setAttribute('data-language', language);
  console.log(`${langContext} Created audio element for OpenAI audio reception`);

  // CRITICAL FIX: Store connection object BEFORE ontrack handler can fire
  const connectionObj = {
    pc: openaiPC,
    dc: openaiDC,
    audioMonitor,
    statsCollector,
    audioElement,
    audioStream: undefined, // Will be set by ontrack handler
    microphoneTracks: microphoneTracks,
    signalingClient: signalingClient
  };
  
  // Store connection immediately to prevent timing issues
  openAIConnectionsByLanguage.set(language, connectionObj);
  console.log(`${langContext} ✅ Connection object stored - ready for ontrack audio reception`);

  // Set up connection state monitoring
  openaiPC.oniceconnectionstatechange = () => {
    console.log(`${langContext} ICE connection state: ${openaiPC.iceConnectionState}`);
  };

  openaiPC.onicegatheringstatechange = () => {
    console.log(`${langContext} ICE gathering state: ${openaiPC.iceGatheringState}`);
  };

  // Handle incoming audio tracks - SIMPLIFIED OpenAI Pattern
  // Following OpenAI WebRTC documentation: pc.ontrack = e => audioEl.srcObject = e.streams[0];
  openaiPC.ontrack = (e: RTCTrackEvent) => {
    console.log(`${langContext} 🎵 AUDIO TRACK RECEIVED from OpenAI 🎵`);
    
    if (e.track.kind === 'audio') {
      console.log(`${langContext} ✅ OpenAI audio track received - setting up audio stream`);
      
      // Get the stream - OpenAI pattern
      const stream = e.streams[0];
      
      // Store in connection immediately
      let connection = openAIConnectionsByLanguage.get(language);
      
      if (!connection) {
        // FALLBACK: Create connection if timing issue occurred
        console.log(`${langContext} 🔄 Creating missing connection object for audio reception`);
        connection = {
          pc: openaiPC,
          dc: openaiDC,
          audioMonitor,
          statsCollector,
          audioElement,
          audioStream: stream,
          microphoneTracks: microphoneTracks,
          signalingClient: signalingClient
        };
        openAIConnectionsByLanguage.set(language, connection);
      } else {
        connection.audioStream = stream;
      }
      
      // Set audio element source - OpenAI pattern
      if (connection.audioElement) {
        connection.audioElement.srcObject = stream;
        console.log(`${langContext} ✅ Audio stream connected to audio element`);
      }
      
      // Forward audio to attendees immediately
      forwardAudioToAttendees(language, stream);
      
      console.log(`${langContext} ✅ Audio stream stored and forwarded - attendees will now receive translations`);
    }
  };

  // Simple connection state monitoring - no redundant receiver checking
  openaiPC.onconnectionstatechange = () => {
    console.log(`${langContext} 🔗 OpenAI connection state changed to: ${openaiPC.connectionState}`);
    
    if (openaiPC.connectionState === 'connected') {
      console.log(`${langContext} ✅ OpenAI WebRTC connection established - ready for audio reception`);
    }
  };

  // Create and set local description
  try {
    const offer = await openaiPC.createOffer();

    // Enhance the SDP for better audio compatibility
    let modifiedSdp = offer.sdp;

    // CRITICAL FIX: Guide needs sendrecv - receives from OpenAI, sends to attendees
    if (modifiedSdp) {
      // Remove any existing direction attributes to avoid conflicts
      modifiedSdp = modifiedSdp.replace(/a=(sendrecv|sendonly|recvonly|inactive)\r?\n/g, '');

      // Add sendrecv after the audio m-line since guide receives from OpenAI AND sends to attendees
      modifiedSdp = modifiedSdp.replace(
        /(m=audio[^\r\n]*\r?\n)/,
        '$1a=sendrecv\r\n'
      );

      console.log(`${langContext} FIXED SDP directionality: guide sendrecv (receives from OpenAI, sends to attendees)`);
    }

    // Prioritize Opus codec for better audio quality
    if (modifiedSdp?.includes('opus/48000/2')) {
      console.log(`${langContext} Prioritizing Opus codec in SDP for better audio quality`);

      // Extract the m=audio line and all its attributes
      const audioSection = modifiedSdp.match(/(m=audio [^\r\n]+)(\r\n[a-z]=[^\r\n]+)*/g)?.[0];

      if (audioSection) {
        // Find the Opus payload type
        const opusPayloadType = audioSection.match(/a=rtpmap:(\d+) opus\/48000\/2/)?.[1];

        if (opusPayloadType) {
          console.log(`${langContext} Found Opus payload type: ${opusPayloadType}`);

          // Extract the m=audio line
          const mLine = audioSection.match(/m=audio [^\r\n]+/)?.[0];

          if (mLine) {
            // Split the m-line into parts
            const parts = mLine.split(' ');

            // Find all payload types
            const payloadTypes = parts.slice(3);

            // Remove the Opus payload type from the list
            const filteredPayloadTypes = payloadTypes.filter(pt => pt !== opusPayloadType);

            // Create a new m-line with Opus first
            const newMLine = `${parts[0]} ${parts[1]} ${parts[2]} ${opusPayloadType} ${filteredPayloadTypes.join(' ')}`;

            // Replace the old m-line with the new one
            modifiedSdp = modifiedSdp.replace(mLine, newMLine);

            console.log(`${langContext} Modified m-line to prioritize Opus: ${newMLine}`);
          }
        }
      }
    }

    const modifiedOffer = new RTCSessionDescription({
      type: 'offer',
      sdp: modifiedSdp
    });

    await openaiPC.setLocalDescription(modifiedOffer);

    // Wait for ICE gathering to complete
    await new Promise<void>((resolve) => {
      if (openaiPC.iceGatheringState === 'complete') {
        resolve();
      } else {
        openaiPC.onicegatheringstatechange = () => {
          if (openaiPC.iceGatheringState === 'complete') {
            resolve();
          }
        };
      }
    });

    console.log(`${langContext} ICE gathering complete. Local SDP ready.`);

    // Send offer to OpenAI API
    if (!EPHEMERAL_KEY) {
      throw new Error('Cannot send SDP offer: Ephemeral key is missing.');
    }

    const baseUrl = 'https://api.openai.com/v1/realtime';
    const model = 'gpt-4o-mini-realtime-preview-2024-12-17';
    const apiUrl = `${baseUrl}?model=${model}`;

    console.log(`${langContext} Sending SDP offer to OpenAI API: ${apiUrl}`);

    const sdpResponse = await fetch(apiUrl, {
      method: 'POST',
      body: openaiPC.localDescription?.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        'Content-Type': 'application/sdp'
      },
      credentials: 'omit'
    });

    if (!sdpResponse.ok) {
      throw new Error(`OpenAI API error: ${sdpResponse.status}`);
    }

    const answer = new RTCSessionDescription({
      type: 'answer',
      sdp: await sdpResponse.text()
    });

    await openaiPC.setRemoteDescription(answer);
    console.log(`${langContext} Remote description set successfully`);

    // Enhanced process to store the SDP offer in Redis for attendees to use
    try {
      console.log(`${langContext} Storing SDP offer in Redis for attendees...`);

      // Debug: Verify SDP content before storing
      if (!modifiedSdp || typeof modifiedSdp !== 'string') {
        console.error(`${langContext} Invalid SDP content to store:`, modifiedSdp);
        throw new Error('Invalid SDP content: SDP is missing or not a string');
      } else {
        console.log(`${langContext} SDP content preview:`, modifiedSdp.substring(0, 100));
        console.log(`${langContext} SDP contains v= marker:`, modifiedSdp.includes('v='));

        // Validate SDP content more thoroughly
        if (!modifiedSdp.includes('v=')) {
          console.error(`${langContext} SDP content is missing v= marker, cannot proceed`);
          throw new Error('Invalid SDP content: Missing v= marker');
        }
      }

      // Create the offer object with proper SDP format
      const offerObject = {
        type: 'offer',
        sdp: modifiedSdp
      };

      // Add a small delay to ensure Redis has time to process any previous operations
      await new Promise(resolve => setTimeout(resolve, 500));

      // Use the transaction utility to safely store the real offer and replace any placeholder
      // This handles both clearing any placeholder and storing the real offer in one atomic operation
      let storeSuccess = false;
      const maxStoreAttempts = 3;

      for (let attempt = 1; attempt <= maxStoreAttempts; attempt++) {
        try {
          console.log(`${langContext} Storing real SDP offer using transaction (attempt ${attempt}/${maxStoreAttempts})...`);

          // First try using the direct API endpoint which uses our transaction utility
          const response = await fetch('/api/tour/offer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              language,
              tourId,
              offer: offerObject
            }),
            credentials: 'include'
          });

          if (response.ok) {
            console.log(`${langContext} ✅ SDP offer successfully stored in Redis for attendees via API`);
            storeSuccess = true;
            break;
          } else {
            // Log detailed error information
            const errorText = await response.text();
            console.error(`${langContext} ❌ API storage failed with status ${response.status}: ${response.statusText}`);
            console.error(`${langContext} ❌ Error response: ${errorText}`);

            // Check for specific authentication errors
            if (response.status === 401) {
              console.error(`${langContext} 🚨 AUTHENTICATION ERROR: Guide is not properly authenticated!`);
              console.error(`${langContext} 🚨 Check that guide is logged in with valid JWT token`);
            }

            if (attempt < maxStoreAttempts) {
              const backoffTime = 1000 * Math.pow(2, attempt - 1); // Exponential backoff
              console.log(`${langContext} Retrying in ${backoffTime}ms...`);
              await new Promise(resolve => setTimeout(resolve, backoffTime));
            }
          }
        } catch (error) {
          console.error(`${langContext} Error storing SDP offer (attempt ${attempt}):`, error);
          if (attempt < maxStoreAttempts) {
            const backoffTime = 1000 * Math.pow(2, attempt - 1); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, backoffTime));
          }
        }
      }

      if (!storeSuccess) {
        console.error(`${langContext} Failed to store SDP offer after ${maxStoreAttempts} attempts`);
        throw new Error(`Failed to store SDP offer after ${maxStoreAttempts} attempts`);
      }

      // Verify the offer was stored correctly
      try {
        console.log(`${langContext} Verifying stored offer...`);
        const verifyResponse = await fetch(`/api/tour/verify-offer?tourId=${tourId}&language=${language}`, {
          credentials: 'include'
        });

        if (verifyResponse.ok) {
          console.log(`${langContext} Offer verification successful`);
        } else {
          console.warn(`${langContext} Offer verification failed, but continuing anyway`);
        }
      } catch (e) {
        console.warn(`${langContext} Error during offer verification:`, e);
      }
    } catch (error) {
      console.error(`${langContext} Error storing SDP offer in Redis:`, error);
      throw error; // Rethrow to indicate failure
    }

    // Setup WebSocket handlers for real-time signaling or fall back to HTTP polling
    if (signalingClient) {
      console.log(`${langContext} Setting up WebSocket handlers for real-time signaling...`);
      
      // Handle incoming answers via WebSocket
      signalingClient.onAnswer((answer: RTCSessionDescriptionInit, fromAttendeeId?: string) => {
        if (fromAttendeeId) {
          console.log(`${langContext} Received answer via WebSocket from attendee ${fromAttendeeId}`);
          const answerData = {
            attendeeId: fromAttendeeId,
            answer: answer,
            timestamp: Date.now()
          };
          processAttendeeAnswer(language, tourId, answerData);
        }
      });

      // Handle incoming ICE candidates via WebSocket  
      signalingClient.onIceCandidate((candidate: any, fromAttendeeId?: string) => {
        if (fromAttendeeId) {
          console.log(`${langContext} Received ICE candidate via WebSocket from attendee ${fromAttendeeId}`);
          const attendeeConnections = attendeeConnectionsByLanguage.get(language);
          const attendeeConnection = attendeeConnections?.get(fromAttendeeId);
          
          if (attendeeConnection) {
            attendeeConnection.pc.addIceCandidate(new RTCIceCandidate(candidate))
              .then(() => {
                console.log(`${langContext} ✅ Added ICE candidate from attendee ${fromAttendeeId} via WebSocket`);
              })
              .catch((error) => {
                console.error(`${langContext} Error adding ICE candidate from attendee ${fromAttendeeId}:`, error);
              });
          }
        }
      });

      console.log(`${langContext} ✅ WebSocket signaling handlers configured`);
    } else {
      // CRITICAL FIX: No HTTP polling fallback - WebSocket signaling is mandatory
      console.error(`${langContext} ❌ CRITICAL: WebSocket signaling failed to initialize`);
      console.error(`${langContext} ❌ HTTP polling fallback DISABLED - this prevents ICE candidate delivery delays`);
      console.error(`${langContext} ❌ Connection will be aborted to force WebSocket retry`);
      
      // Cleanup and throw error to trigger reconnection with WebSocket
      if (openaiPC.connectionState !== 'closed') {
        openaiPC.close();
      }
      
      throw new Error(`WebSocket signaling required for ${language} - HTTP polling disabled to ensure ICE candidate delivery`);
    }

    // No periodic receiver checking needed - ontrack handler will handle audio reception

    // Return the connection object that was already stored
    return connectionObj;

  } catch (error) {
    console.error(`${langContext} Error during OpenAI WebRTC setup:`, error);
    if (openaiPC.connectionState !== 'closed') {
      openaiPC.close();
    }
    return null;
  }
}

async function pollForAttendeeAnswers(
  language: string,
  tourId: string,
  setAttendees: (attendees: string[]) => void
): Promise<void> {
  const langContext = `[${language}]`;
  console.log(`${langContext} Starting to poll for attendee answers...`);
  console.log(`${langContext} Using tourId: ${tourId}`);
  console.log(`${langContext} Using language: ${language}`);

  // Track the last processed answer index
  let lastProcessedIndex = -1;

  // Set up polling interval
  const pollInterval = setInterval(async () => {
    try {
      // Fetch new answers from Redis via API
      const response = await fetch(`/api/tour/answer?tourId=${tourId}&language=${language}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        console.error(`${langContext} Error fetching answers: ${response.status}`);
        return;
      }

      const data = await response.json();
      const answers = data.answers || [];

      // Process only new answers
      if (answers.length > lastProcessedIndex + 1) {
        const newAnswers = answers.slice(lastProcessedIndex + 1);
        console.log(`${langContext} Found ${newAnswers.length} new attendee answers`);

        // Log the format of the first answer for debugging
        if (newAnswers.length > 0) {
          const firstAnswer = newAnswers[0];
          console.log(`${langContext} First answer format: ${typeof firstAnswer}`);
          if (typeof firstAnswer === 'string') {
            console.log(`${langContext} First answer preview: ${firstAnswer.substring(0, 50)}...`);
          } else {
            console.log(`${langContext} First answer is not a string:`, firstAnswer);
          }
        }

        // Process each new answer
        for (const answer of newAnswers) {
          try {
            // Skip if the answer is not valid
            if (!answer) {
              console.log(`${langContext} Skipping empty answer`);
              continue;
            }

            console.log(`${langContext} Processing answer:`, typeof answer === 'string' ? answer.substring(0, 50) + '...' : 'non-string answer');

            // Parse the answer if needed
            let answerData;
            try {
              answerData = typeof answer === 'string' ? JSON.parse(answer) : answer;
            } catch (parseError) {
              console.error(`${langContext} Error parsing answer JSON:`, parseError);
              continue; // Skip this answer if it can't be parsed
            }

            // Process the answer
            await processAttendeeAnswer(language, tourId, answerData);
          } catch (error) {
            console.error(`${langContext} Error processing answer:`, error);
          }
        }

        // Update the last processed index
        lastProcessedIndex = answers.length - 1;

        // Update the attendee list in the UI
        const attendeeIds = Array.from(attendeeConnectionsByLanguage.get(language)?.keys() || []);
        setAttendees(attendeeIds);
      }
    } catch (error) {
      console.error(`${langContext} Error polling for attendee answers:`, error);
    }
  }, 2000); // Poll every 2 seconds

  // Store the interval for cleanup
  const connection = openAIConnectionsByLanguage.get(language);
  if (connection) {
    connection.answerPollInterval = pollInterval;
  }
}

async function processAttendeeAnswer(
  language: string,
  tourId: string,
  answerData: any,
  retryCount: number = 0
): Promise<void> {
  const langContext = `[${language}]`;
  console.log(`${langContext} Processing attendee answer:`, answerData);

  // DEBUGGING: Check audio stream status at the very beginning
  const connectionCheck = openAIConnectionsByLanguage.get(language);
  console.log(`${langContext} 🔍 INITIAL CHECK - Connection exists: ${!!connectionCheck}`);
  if (connectionCheck) {
    console.log(`${langContext} 🔍 INITIAL CHECK - audioStream exists: ${!!connectionCheck.audioStream}`);
    if (connectionCheck.audioStream) {
      console.log(`${langContext} 🔍 INITIAL CHECK - audioStream details: id=${connectionCheck.audioStream.id}, active=${connectionCheck.audioStream.active}, tracks=${connectionCheck.audioStream.getTracks().length}`);
    }
  }

  try {
    // Extract attendee ID and answer SDP
    const attendeeId = answerData.attendeeId || `anonymous-${Date.now()}`;

    // Parse the answer if it's a string (from Redis)
    let parsedAnswer;
    try {
      // If the answer is stored as a string, parse it
      const answer = answerData.answer;
      let parsedData = typeof answer === 'string' ? JSON.parse(answer) : answer;

      // Extract the actual WebRTC session description
      // It could be directly in parsedData or nested under an 'answer' property
      if (parsedData && parsedData.answer && (parsedData.answer.type === 'answer' || parsedData.answer.type === 'offer')) {
        // The answer is nested under the 'answer' property
        parsedAnswer = parsedData.answer;
        console.log(`${langContext} Extracted nested answer object for attendee ${attendeeId}`);
      } else if (parsedData && (parsedData.type === 'answer' || parsedData.type === 'offer')) {
        // The answer is directly in parsedData
        parsedAnswer = parsedData;
        console.log(`${langContext} Using direct answer object for attendee ${attendeeId}`);
      } else {
        console.error(`${langContext} Could not find valid answer in parsed data for attendee ${attendeeId}:`, parsedData);
        return; // Skip this answer if we can't find a valid structure
      }

      console.log(`${langContext} Successfully parsed answer for attendee ${attendeeId}: type=${parsedAnswer.type}`);
    } catch (error) {
      console.error(`${langContext} Error parsing answer JSON:`, error);
      return; // Skip this answer if it can't be parsed
    }

    // Skip if this attendee is already connected
    const attendeeConnections = attendeeConnectionsByLanguage.get(language) || new Map();
    if (attendeeConnections.has(attendeeId)) {
      console.log(`${langContext} Attendee ${attendeeId} already connected, skipping`);
      return;
    }

    // Create a new peer connection for this attendee
    console.log(`${langContext} 🔍 BEFORE createAttendeeConnection - Checking audio stream...`);
    const beforeConnection = openAIConnectionsByLanguage.get(language);
    if (beforeConnection) {
      console.log(`${langContext} 🔍 BEFORE - audioStream exists: ${!!beforeConnection.audioStream}`);
    }

    const attendeePC = await createAttendeeConnection(language, attendeeId, tourId);

    console.log(`${langContext} 🔍 AFTER createAttendeeConnection - Checking audio stream...`);
    const afterConnection = openAIConnectionsByLanguage.get(language);
    if (afterConnection) {
      console.log(`${langContext} 🔍 AFTER - audioStream exists: ${!!afterConnection.audioStream}`);
    }

    // Add the OpenAI audio track to the attendee connection
    try {
      console.log(`${langContext} Adding OpenAI audio track to attendee ${attendeeId} connection`);

      // Get the OpenAI audio stream from the main connection
      const openAIConnection = openAIConnectionsByLanguage.get(language);
      if (!openAIConnection || !openAIConnection.pc) {
        console.error(`${langContext} No OpenAI connection found for ${language}`);
        return;
      }

      // Debug the connection state
      console.log(`${langContext} 🔍 Debugging OpenAI connection state:`);
      console.log(`${langContext} 🔍 Connection exists: ${!!openAIConnection}`);
      console.log(`${langContext} 🔍 Connection.pc exists: ${!!openAIConnection.pc}`);
      console.log(`${langContext} 🔍 Connection object reference: ${openAIConnection.constructor.name}@${openAIConnection.pc.connectionState}`);
      console.log(`${langContext} 🔍 Connection.audioStream exists: ${!!openAIConnection.audioStream}`);

      if (openAIConnection.audioStream) {
        console.log(`${langContext} 🔍 AudioStream details: id=${openAIConnection.audioStream.id}, active=${openAIConnection.audioStream.active}, tracks=${openAIConnection.audioStream.getTracks().length}`);
      }

      // Check if we have the stored audio stream
      if (!openAIConnection.audioStream) {
        console.error(`${langContext} ❌ No audio stream found in OpenAI connection - audioStream is missing`);
        console.error(`${langContext} ❌ This means the ontrack handler didn't store the stream properly`);
        console.error(`${langContext} ❌ Or the audioStream was cleared/lost after storage`);
        console.error(`${langContext} ❌ Or the attendee connected before the audio stream was received`);

        // Try to recover the audio stream from peer connection receivers
        console.log(`${langContext} 🔄 Attempting to recover audio stream from peer connection receivers...`);
        const receivers = openAIConnection.pc.getReceivers();
        console.log(`${langContext} 🔍 Found ${receivers.length} receivers in peer connection`);

        let recoveredStream: MediaStream | null = null;
        for (const receiver of receivers) {
          if (receiver.track && receiver.track.kind === 'audio' && receiver.track.readyState === 'live') {
            console.log(`${langContext} 🎵 Found live audio track in receiver: id=${receiver.track.id}`);
            recoveredStream = new MediaStream([receiver.track]);
            openAIConnection.audioStream = recoveredStream;
            console.log(`${langContext} ✅ Audio stream recovered from receiver: id=${recoveredStream.id}`);
            break;
          }
        }

        if (!recoveredStream) {
          // Let's wait a bit and retry in case the audio stream arrives soon (max 3 retries)
          if (retryCount < 3) {
            console.log(`${langContext} 🔄 No audio stream recovered, waiting 2 seconds then retrying... (attempt ${retryCount + 1}/3)`);
            setTimeout(() => {
              console.log(`${langContext} 🔄 Retrying attendee connection after waiting for audio stream... (attempt ${retryCount + 1}/3)`);
              processAttendeeAnswer(language, tourId, answerData, retryCount + 1).catch(error => {
                console.error(`${langContext} Error in attendee retry:`, error);
              });
            }, 2000);
          } else {
            console.error(`${langContext} ❌ Failed to connect attendee after 3 retries - audio stream never became available`);
          }
          return;
        }
      }

      // Get audio tracks from the stored stream
      const audioTracks = openAIConnection.audioStream!.getTracks().filter(track => track.kind === 'audio');

      if (audioTracks.length === 0) {
        console.error(`${langContext} No audio tracks found in stored audio stream`);
        return;
      }

      // Add all audio tracks to the attendee connection
      audioTracks.forEach((track, index) => {
        console.log(`${langContext} Adding audio track ${index}: id=${track.id}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);

        // CRITICAL FIX: Check if track is muted and log warning
        if (track.muted) {
          console.warn(`${langContext} ⚠️ WARNING: Track ${index} is MUTED before adding to attendee! This will cause no audio.`);
          console.warn(`${langContext} Track details: id=${track.id}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
        }

        try {
          attendeePC.addTrack(track, openAIConnection.audioStream!);
          console.log(`${langContext} ✅ Successfully added audio track ${index} to attendee ${attendeeId}`);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'InvalidAccessError') {
            console.log(`${langContext} ⚠️ Track ${index} already added to attendee ${attendeeId} (this is normal)`);
          } else {
            console.error(`${langContext} ❌ Error adding track ${index} to attendee ${attendeeId}:`, error);
          }
        }
      });

      console.log(`${langContext} Processed ${audioTracks.length} OpenAI audio track(s) for attendee ${attendeeId} connection`);

      // Create offer for this attendee connection
      const offer = await attendeePC.createOffer({
        offerToReceiveAudio: false, // Guide sends audio, doesn't receive
        offerToReceiveVideo: false
      });

      await attendeePC.setLocalDescription(offer);
      console.log(`${langContext} Created and set local offer for attendee ${attendeeId}`);
      console.log(`${langContext} [GUIDE-ICE] ICE gathering state after setLocalDescription: ${attendeePC.iceGatheringState}`);
    } catch (error) {
      console.error(`${langContext} Error setting up attendee ${attendeeId} connection:`, error);
      return;
    }

    // Set the remote description (the attendee's answer)
    try {
      // Validate the parsed answer has the required properties
      if (!parsedAnswer || !parsedAnswer.type || !parsedAnswer.sdp) {
        console.error(`${langContext} Invalid answer format for attendee ${attendeeId}:`, parsedAnswer);
        return;
      }

      // Log the answer details for debugging
      console.log(`${langContext} Setting remote description for attendee ${attendeeId} with answer type: ${parsedAnswer.type}`);
      console.log(`${langContext} SDP preview: ${parsedAnswer.sdp.substring(0, 50)}...`);

      await attendeePC.setRemoteDescription(new RTCSessionDescription(parsedAnswer));
      console.log(`${langContext} Set remote description for attendee ${attendeeId} successfully`);
      console.log(`${langContext} [GUIDE-ICE] ICE connection state after setRemoteDescription: ${attendeePC.iceConnectionState}`);
      console.log(`${langContext} [GUIDE-ICE] ICE gathering state after setRemoteDescription: ${attendeePC.iceGatheringState}`);
    } catch (error) {
      console.error(`${langContext} Error setting remote description for attendee ${attendeeId}:`, error);
      return; // Skip this attendee if we can't set the remote description
    }

    // Forward any existing audio tracks from OpenAI to this attendee
    const openAIConnection = openAIConnectionsByLanguage.get(language);
    if (openAIConnection && openAIConnection.audioStream) {
      const audioStream = openAIConnection.audioStream;
      const tracks = audioStream.getTracks();

      console.log(`${langContext} Forwarding audio to attendee ${attendeeId}`);
      console.log(`${langContext} Audio stream details: id=${audioStream.id}, active=${audioStream.active}, tracks=${tracks.length}`);

      if (tracks.length === 0) {
        console.warn(`${langContext} No tracks found in audio stream for attendee ${attendeeId}`);
      } else {
        // Track the senders we add for verification
        const addedSenders: RTCRtpSender[] = [];

        // Process tracks sequentially to avoid race conditions
        for (let index = 0; index < tracks.length; index++) {
          const track = tracks[index];
          console.log(`${langContext} Track ${index} to forward: id=${track.id}, kind=${track.kind}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);

          // CRITICAL CHECK: Warn if track is muted
          if (track.muted) {
            console.error(`${langContext} 🚨 CRITICAL: Track ${index} is MUTED during forwarding! This will cause no audio for attendees.`);
            console.error(`${langContext} Track details: id=${track.id}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);

            // Try to work around muted tracks by cloning them
            console.log(`${langContext} 🔧 ATTEMPTING FIX: Trying to clone muted track to get unmuted version`);
            try {
              const clonedTrack = track.clone();
              console.log(`${langContext} Cloned track: id=${clonedTrack.id}, muted=${clonedTrack.muted}, enabled=${clonedTrack.enabled}`);

              if (!clonedTrack.muted) {
                console.log(`${langContext} ✅ SUCCESS: Cloned track is not muted, will use cloned version`);
                // Replace the track in the stream with the cloned version
                audioStream.removeTrack(track);
                audioStream.addTrack(clonedTrack);
                console.log(`${langContext} Replaced muted track with cloned unmuted track in stream`);
              } else {
                console.log(`${langContext} ⚠️ Cloned track is still muted, will proceed with original`);
              }
            } catch (cloneError) {
              console.error(`${langContext} Failed to clone track:`, cloneError);
            }
          }

          // Ensure track is enabled before forwarding
          if (!track.enabled) {
            console.log(`${langContext} Enabling disabled track before forwarding`);
            track.enabled = true;
          }

          try {
            // Check if this track is already added
            const existingSenders = attendeePC.getSenders();
            const existingSender = existingSenders.find(sender => sender.track && sender.track.id === track.id);

            if (existingSender) {
              console.log(`${langContext} Track ${track.id} already exists for attendee ${attendeeId}`);

              // CRITICAL FIX: OpenAI reuses track IDs but sends new audio content
              // Instead of skipping, we need to ensure the sender is using the latest track reference
              console.log(`${langContext} 🔄 Updating existing sender with latest track reference for new audio content`);

              try {
                // Replace the track in the existing sender to ensure new audio content flows through
                await existingSender.replaceTrack(track);
                console.log(`${langContext} ✅ Successfully updated sender with latest track for attendee ${attendeeId}`);

                // Ensure the track is enabled and ready
                if (!track.enabled) {
                  track.enabled = true;
                  console.log(`${langContext} Enabled track ${track.id} after sender update`);
                }

                addedSenders.push(existingSender);
              } catch (replaceError) {
                console.error(`${langContext} Failed to replace track in sender:`, replaceError);
                console.log(`${langContext} 🔄 Attempting to remove and re-add track as fallback`);

                // Fallback: Remove the old sender and add a new one
                try {
                  attendeePC.removeTrack(existingSender);
                  const newSender = attendeePC.addTrack(track, audioStream);
                  addedSenders.push(newSender);
                  console.log(`${langContext} ✅ Successfully removed old sender and added new one for attendee ${attendeeId}`);
                } catch (fallbackError) {
                  console.error(`${langContext} Fallback track replacement also failed:`, fallbackError);
                }
              }
            } else {
              // Track is not yet added, add it normally
              const sender = attendeePC.addTrack(track, audioStream);
              addedSenders.push(sender);
              console.log(`${langContext} Track ${track.id} added to attendee ${attendeeId}, sender created: ${!!sender}`);

              // Log the sender's parameters for debugging
              if (sender) {
                const params = sender.getParameters();
                console.log(`${langContext} Sender parameters: encodings=${JSON.stringify(params.encodings || 'none')}, transceiver state=${sender.transport?.state || 'unknown'}`);
              }
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === 'InvalidAccessError') {
              console.log(`${langContext} Track ${track.id} already exists for attendee ${attendeeId} (this is normal)`);
            } else {
              console.error(`${langContext} Error adding track ${track.id} to attendee ${attendeeId}:`, error);
            }
          }
        }

        // Verify audio forwarding
        const audioSenders = attendeePC.getSenders().filter(sender =>
          sender.track && sender.track.kind === 'audio'
        );

        if (audioSenders.length > 0) {
          console.log(`${langContext} Successfully verified ${audioSenders.length} audio tracks added to attendee ${attendeeId}`);
          audioSenders.forEach(sender => {
            if (sender.track) {
              console.log(`${langContext} Verified track ${sender.track.id} with state: enabled=${sender.track.enabled}, muted=${sender.track.muted}, readyState=${sender.track.readyState}`);

              // Ensure track is enabled
              if (!sender.track.enabled) {
                console.log(`${langContext} Enabling disabled track ${sender.track.id} after verification`);
                sender.track.enabled = true;
              }
            }
          });
        } else {
          console.error(`${langContext} Failed to verify audio tracks for attendee ${attendeeId} - no audio senders found after adding tracks`);
        }
      }
    } else {
      console.warn(`${langContext} 🚨 CRITICAL: No audio stream available to forward to attendee ${attendeeId}`);
      if (openAIConnection) {
        console.log(`${langContext} OpenAI connection exists but audioStream is ${openAIConnection.audioStream ? 'present' : 'missing'}`);
        
        // CRITICAL FIX: Setup audio forwarding retry for when OpenAI audio becomes available
        console.log(`${langContext} 🔄 Setting up audio retry mechanism for attendee ${attendeeId}`);
        
        const audioRetryKey = `audio_retry_${attendeeId}`;
        (openAIConnection as any)[audioRetryKey] = { 
          attendeeId, 
          attendeePC, 
          retryCount: 0, 
          maxRetries: 10 
        };
        
        // Poll for audio stream availability (max 20 seconds)
        const audioRetryInterval = setInterval(() => {
          const retryInfo = (openAIConnection as any)[audioRetryKey];
          if (!retryInfo) {
            clearInterval(audioRetryInterval);
            return;
          }
          
          retryInfo.retryCount++;
          console.log(`${langContext} 🔄 Audio retry attempt ${retryInfo.retryCount}/${retryInfo.maxRetries} for attendee ${attendeeId}`);
          
          if (openAIConnection.audioStream && openAIConnection.audioStream.getTracks().length > 0) {
            console.log(`${langContext} ✅ Audio stream now available! Forwarding to attendee ${attendeeId}`);
            
            // Forward the now-available audio
            const audioStream = openAIConnection.audioStream;
            const tracks = audioStream.getTracks();
            
            tracks.forEach(track => {
              try {
                attendeePC.addTrack(track, audioStream);
                console.log(`${langContext} ✅ RETRY SUCCESS: Audio track ${track.id} added to attendee ${attendeeId}`);
              } catch (error) {
                console.warn(`${langContext} Error adding retried track:`, error);
              }
            });
            
            // CRITICAL: Create new offer with audio tracks for renegotiation
            console.log(`${langContext} 🔄 Creating new offer with audio tracks for attendee ${attendeeId}`);
            attendeePC.createOffer().then(newOffer => {
              return attendeePC.setLocalDescription(newOffer).then(() => {
                // Store the new offer so attendee can get it
                return fetch('/api/tour/offer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    language,
                    tourId,
                    offer: newOffer,
                    attendeeId, // Specific offer for this attendee
                    hasAudio: true // Flag that this offer includes audio
                  })
                });
              });
            }).then(() => {
              console.log(`${langContext} ✅ New offer with audio tracks stored for attendee ${attendeeId}`);
            }).catch(renegotiationError => {
              console.error(`${langContext} Failed to renegotiate with audio for attendee ${attendeeId}:`, renegotiationError);
            });
            
            // Cleanup and stop retrying
            delete (openAIConnection as any)[audioRetryKey];
            clearInterval(audioRetryInterval);
            
          } else if (retryInfo.retryCount >= retryInfo.maxRetries) {
            console.error(`${langContext} ❌ Audio retry failed after ${retryInfo.maxRetries} attempts for attendee ${attendeeId}`);
            delete (openAIConnection as any)[audioRetryKey];
            clearInterval(audioRetryInterval);
          }
        }, 2000); // Check every 2 seconds
        
      } else {
        console.log(`${langContext} No OpenAI connection found for language ${language}`);
      }
    }

    // Start polling for this attendee's ICE candidates
    pollForAttendeeIceCandidates(language, attendeeId, tourId, attendeePC);

    // Update guide's audio state - mute when attendees are connected
    updateGuideAudioState(language);
    console.log(`${langContext} Updated guide audio state after attendee ${attendeeId} connected`);
  } catch (error) {
    console.error(`${langContext} Error processing attendee answer:`, error);
  }
}

async function createAttendeeConnection(
  language: string,
  attendeeId: string,
  tourId: string
): Promise<RTCPeerConnection> {
  const langContext = `[${language}]`;
  console.log(`${langContext} Creating connection for attendee ${attendeeId}`);

  // Create a new peer connection with Xirsys
  let attendeePC: RTCPeerConnection;

  try {
    console.log(`${langContext} [GUIDE-ATTENDEE-ICE] Using static Xirsys TURN configuration for attendee ${attendeeId} connection...`);

    // EXPERT FIX: Use static TURN configuration - no coordination needed since both use same servers
    const xirsysServers = getStaticXirsysICEServers();
    console.log(`${langContext} [GUIDE-ATTENDEE-ICE] ✅ Using static jb-turn1.xirsys.com configuration (${xirsysServers.length} servers) for attendee ${attendeeId}`);
    
    // Use enhanced candidate generation for better connectivity
    attendeePC = new RTCPeerConnection(createStaticXirsysRTCConfiguration());
  } catch (error) {
    console.warn(`${langContext} [GUIDE-ATTENDEE-ICE] ⚠️ Xirsys unavailable for attendee ${attendeeId}, using fallback servers:`, error);

    // Fallback to public servers with enhanced configuration
    attendeePC = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
        { urls: "stun:stun.cloudflare.com:3478" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ],
      // Expert WebRTC configuration optimized for production
      iceCandidatePoolSize: 15,   // Enhanced candidate generation
      bundlePolicy: 'max-bundle', // Bundle all media on single transport
      rtcpMuxPolicy: 'require',   // Multiplex RTP and RTCP for efficiency
      iceTransportPolicy: 'all'   // Allow all candidate types
    });
  }

  console.log(`${langContext} [GUIDE-ATTENDEE-ICE] Created attendee peer connection with ${attendeePC.getConfiguration().iceServers?.length} ICE servers (Xirsys TURN/STUN)`);

  // Set up enhanced event handlers with detailed logging
  attendeePC.oniceconnectionstatechange = () => {
    console.log(`${langContext} [GUIDE-ATTENDEE-ICE] Attendee ${attendeeId} ICE connection state changed to: ${attendeePC.iceConnectionState}`);

    if (attendeePC.iceConnectionState === "connected") {
      console.log(`${langContext} [GUIDE-ATTENDEE-ICE] ✅ ICE connection to attendee ${attendeeId} established successfully!`);
    } else if (attendeePC.iceConnectionState === "checking") {
      console.log(`${langContext} [GUIDE-ATTENDEE-ICE] ICE connectivity checks in progress for attendee ${attendeeId}...`);
    } else if (attendeePC.iceConnectionState === "failed") {
      console.log(`${langContext} [GUIDE-ATTENDEE-ICE] ❌ ICE connection to attendee ${attendeeId} failed`);
    }

    // Clean up if connection fails or closes
    if (
      attendeePC.iceConnectionState === 'disconnected' ||
      attendeePC.iceConnectionState === 'failed' ||
      attendeePC.iceConnectionState === 'closed'
    ) {
      console.log(`${langContext} [GUIDE-ATTENDEE-ICE] Connection to attendee ${attendeeId} failed/closed, cleaning up`);
      cleanupAttendeeConnection(language, attendeeId);
    }
  };

  attendeePC.onconnectionstatechange = () => {
    console.log(`${langContext} [GUIDE-ATTENDEE-CONNECTION] Attendee ${attendeeId} connection state changed to: ${attendeePC.connectionState}`);

    if (attendeePC.connectionState === "connected") {
      console.log(`${langContext} [GUIDE-ATTENDEE-CONNECTION] ✅ WebRTC connection to attendee ${attendeeId} fully established!`);
    } else if (attendeePC.connectionState === "connecting") {
      console.log(`${langContext} [GUIDE-ATTENDEE-CONNECTION] WebRTC connection to attendee ${attendeeId} in progress...`);
    } else if (attendeePC.connectionState === "failed") {
      console.log(`${langContext} [GUIDE-ATTENDEE-CONNECTION] ❌ WebRTC connection to attendee ${attendeeId} failed`);
    }
  };

  attendeePC.onicegatheringstatechange = () => {
    console.log(`${langContext} [GUIDE-ATTENDEE-ICE] Attendee ${attendeeId} ICE gathering state changed to: ${attendeePC.iceGatheringState}`);
  };

  // Create a data channel for sending translations
  const dataChannel = attendeePC.createDataChannel('translations');
  dataChannel.onopen = () => {
    console.log(`${langContext} Data channel open for attendee ${attendeeId}`);
  };

  // Store the connection
  let attendeeConnections = attendeeConnectionsByLanguage.get(language);
  if (!attendeeConnections) {
    attendeeConnections = new Map();
    attendeeConnectionsByLanguage.set(language, attendeeConnections);
  }

  // Create ICE connection monitor for this attendee
  const iceMonitor = createICEMonitor(attendeePC, language, 'guide', attendeeId, 30000);
  
  // Start monitoring with enhanced timeout handling
  iceMonitor.startMonitoring((event: ICETimeoutEvent) => {
    console.error(`${langContext} ICE timeout for attendee ${attendeeId}:`, event.analysis.failureReason);
    handleICETimeout(event);
    
    // Clean up failed connection
    cleanupAttendeeConnection(language, attendeeId);
  });

  attendeeConnections.set(attendeeId, {
    pc: attendeePC,
    dc: dataChannel,
    iceMonitor: iceMonitor
  });

  // Add comprehensive ICE state monitoring
  console.log(`${langContext} [GUIDE-ICE] ✅ ICE candidate handler registered for attendee ${attendeeId}`);
  
  // Monitor ICE gathering state changes
  attendeePC.onicegatheringstatechange = () => {
    console.log(`${langContext} [GUIDE-ICE] ICE gathering state changed to: ${attendeePC.iceGatheringState} for attendee ${attendeeId}`);
  };
  
  // Monitor ICE connection state changes
  attendeePC.oniceconnectionstatechange = () => {
    console.log(`${langContext} [GUIDE-ICE] ICE connection state changed to: ${attendeePC.iceConnectionState} for attendee ${attendeeId}`);
    if (attendeePC.iceConnectionState === 'connected') {
      console.log(`${langContext} [GUIDE-ICE] 🎉 ICE connection ESTABLISHED with attendee ${attendeeId}!`);
    } else if (attendeePC.iceConnectionState === 'failed') {
      console.error(`${langContext} [GUIDE-ICE] ❌ ICE connection FAILED with attendee ${attendeeId}`);
    }
  };

  // Handle ICE candidates with enhanced logging
  let candidateCount = 0;
  attendeePC.onicecandidate = (event) => {
    console.log(`${langContext} [GUIDE-ICE] onicecandidate event triggered for attendee ${attendeeId}`, event);
    if (event.candidate) {
      candidateCount++;
      console.log(`${langContext} [GUIDE-ICE] Generated ICE candidate #${candidateCount} for attendee ${attendeeId}: ${event.candidate.candidate.substring(0, 50)}...`);
      console.log(`${langContext} [GUIDE-ICE] Candidate type: ${event.candidate.type}, protocol: ${event.candidate.protocol}, priority: ${event.candidate.priority}`);
      sendIceCandidateToAttendee(event.candidate, language, attendeeId, tourId);
    } else {
      console.log(`${langContext} [GUIDE-ICE] ICE gathering completed for attendee ${attendeeId} (null candidate received) - Total candidates generated: ${candidateCount}`);

      // Analyze ICE candidates after gathering completes
      setTimeout(() => {
        console.log(`${langContext} [GUIDE-ICE] 🔍 Analyzing guide's ICE candidates for attendee ${attendeeId}...`);
        attendeePC.getStats().then(stats => {
          let localCandidates: any[] = [];
          let remoteCandidates: any[] = [];
          let candidatePairs: any[] = [];

          stats.forEach(report => {
            if (report.type === 'local-candidate') {
              localCandidates.push({
                id: report.id,
                type: report.candidateType,
                protocol: report.protocol,
                address: report.address,
                port: report.port
              });
            } else if (report.type === 'remote-candidate') {
              remoteCandidates.push({
                id: report.id,
                type: report.candidateType,
                protocol: report.protocol,
                address: report.address,
                port: report.port
              });
            } else if (report.type === 'candidate-pair') {
              candidatePairs.push({
                state: report.state,
                priority: report.priority,
                nominated: report.nominated
              });
            }
          });

          console.log(`${langContext} [GUIDE-ICE] 📊 Guide ICE Analysis for attendee ${attendeeId}:`);
          console.log(`${langContext} [GUIDE-ICE] Local candidates (sent to attendee): ${localCandidates.length}`, localCandidates);
          console.log(`${langContext} [GUIDE-ICE] Remote candidates (from attendee): ${remoteCandidates.length}`, remoteCandidates);
          console.log(`${langContext} [GUIDE-ICE] Candidate pairs: ${candidatePairs.length}`, candidatePairs);

          // RESEARCH-BASED ICE RESTART: Optimized with exponential backoff
          const restartTrackingKey = `ice_restart_${attendeeId}`;
          if (!(attendeePC as any)[restartTrackingKey]) {
            (attendeePC as any)[restartTrackingKey] = { 
              attempts: 0, 
              lastAttempt: 0,
              successfulRestarts: 0
            };
          }
          
          const restartInfo = (attendeePC as any)[restartTrackingKey];
          const now = Date.now();
          const timeSinceLastRestart = now - restartInfo.lastAttempt;
          
          // FIXED: Faster timing for real-time audio (research + production balance)
          const baseDelay = 2000; // Reduced from 5000ms for faster recovery
          const exponentialDelay = baseDelay * Math.pow(1.5, restartInfo.attempts); // Gentler 1.5x vs 2x
          const maxDelay = 15000; // Reduced from 30000ms to 15s max
          const adaptiveDelay = Math.min(exponentialDelay, maxDelay);
          
          // Enhanced restart conditions based on research
          const shouldRestart = 
            (localCandidates.length < 3 || attendeePC.iceConnectionState === 'failed') &&
            restartInfo.attempts < 5 && // Increased from 2 to 5 attempts
            timeSinceLastRestart > adaptiveDelay; // Adaptive delay
              
          if (shouldRestart) {
            restartInfo.attempts++;
            restartInfo.lastAttempt = now;
            
            console.warn(`${langContext} [GUIDE-ICE] ⚠️ ICE connection needs restart: ${localCandidates.length} candidates, state: ${attendeePC.iceConnectionState} (attempt ${restartInfo.attempts}/5, delay: ${adaptiveDelay}ms)`);
            console.warn(`${langContext} [GUIDE-ICE] 🔄 Initiating research-based ICE restart with exponential backoff...`);
            
            // FIXED: Safer candidate management - backup via API call
            fetch('/api/tour/ice-candidate/backup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tourId,
                attendeeId,
                language,
                action: 'backup_and_clear',
                timestamp: now
              })
            }).then(response => {
              if (response.ok) {
                return response.json();
              }
              throw new Error(`Backup API failed: ${response.status}`);
            }).then(result => {
              console.log(`${langContext} [GUIDE-ICE] 💾 ${result.message}`);
            }).catch(e => {
              console.warn(`${langContext} [GUIDE-ICE] Failed to backup candidates via API:`, e);
              // Continue without clearing - safer than losing candidates
            });

            // Force ICE restart to generate more candidates
            attendeePC.createOffer({ iceRestart: true }).then(offer => {
              console.log(`${langContext} [GUIDE-ICE] 🔄 ICE restart offer created for attendee ${attendeeId} (attempt ${restartInfo.attempts})`);
              return attendeePC.setLocalDescription(offer);
            }).then(() => {
              console.log(`${langContext} [GUIDE-ICE] ✅ Guide ICE restart initiated for attendee ${attendeeId} - should generate more candidates`);
            }).catch(error => {
              console.error(`${langContext} [GUIDE-ICE] ❌ Guide ICE restart failed for attendee ${attendeeId}:`, error);
            });
          } else if (localCandidates.length < 4) {
            console.log(`${langContext} [GUIDE-ICE] ℹ️ Guide has ${localCandidates.length} candidates (restart skipped: attempts=${restartInfo.attempts}, timeSince=${timeSinceLastRestart}ms, state=${attendeePC.iceConnectionState})`);
          }

          if (remoteCandidates.length === 0) {
            console.error(`${langContext} [GUIDE-ICE] ❌ No remote candidates from attendee ${attendeeId}!`);
          }
        });
      }, 2000);
    }
  };

  return attendeePC;
}

async function pollForAttendeeIceCandidates(
  language: string,
  attendeeId: string,
  tourId: string, // Remove underscore - we need this parameter
  attendeePC: RTCPeerConnection
): Promise<void> {
  const langContext = `[${language}]`;
  console.log(`${langContext} 🔍 GUIDE ICE POLLING: Starting to poll for ICE candidates from attendee ${attendeeId}`);
  console.log(`${langContext} 🔍 GUIDE ICE POLLING: Looking for candidates from attendeeId: ${attendeeId}`);
  console.log(`${langContext} 🔍 GUIDE ICE POLLING: Using tourId: ${tourId}, language: ${language}`);

  let lastProcessedIndex = -1;

  const pollInterval = setInterval(async () => {
    try {
      // Check if connection is still active or successfully connected
      if (
        attendeePC.iceConnectionState === 'connected' ||
        attendeePC.iceConnectionState === 'completed' ||
        attendeePC.connectionState === 'closed' ||
        attendeePC.connectionState === 'failed' ||
        attendeePC.connectionState === 'disconnected'
      ) {
        if (attendeePC.iceConnectionState === 'connected' || attendeePC.iceConnectionState === 'completed') {
          console.log(`${langContext} 🔍 GUIDE ICE POLLING: ✅ Connection established, stopping ICE polling for attendee ${attendeeId}`);
        }
        clearInterval(pollInterval);
        return;
      }

      // Fetch ICE candidates from the attendee
      const apiUrl = `/api/tour/attendee-ice?tourId=${encodeURIComponent(tourId)}&language=${encodeURIComponent(language)}&attendeeId=${encodeURIComponent(attendeeId)}`;
      console.log(`${langContext} 🔍 GUIDE ICE POLLING: Fetching from: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        credentials: 'include'
      });

      if (!response.ok) {
        if (response.status !== 404) { // 404 is normal when no candidates yet
          console.error(`${langContext} 🔍 GUIDE ICE POLLING: Error fetching ICE candidates: ${response.status}`);
        }
        return;
      }

      const data = await response.json();
      const candidates = data.candidates || [];

      console.log(`${langContext} 🔍 GUIDE ICE POLLING: Response from attendee ${attendeeId}: ${candidates.length} total candidates, lastProcessed: ${lastProcessedIndex}`);

      // Process only new candidates
      if (candidates.length > lastProcessedIndex + 1) {
        const newCandidates = candidates.slice(lastProcessedIndex + 1);
        console.log(`${langContext} 🔍 GUIDE ICE POLLING: ✅ Found ${newCandidates.length} NEW ICE candidates from attendee ${attendeeId}`);

        // Add each candidate to the peer connection
        for (const candidate of newCandidates) {
          try {
            // CRITICAL FIX: Validate ICE candidate before adding
            if (!candidate || !candidate.candidate) {
              console.warn(`${langContext} 🔍 GUIDE ICE POLLING: ❌ Skipping invalid ICE candidate from attendee ${attendeeId}: missing candidate string`);
              continue;
            }
            
            // Additional validation for critical fields
            if (candidate.sdpMLineIndex === undefined && candidate.sdpMid === undefined) {
              console.warn(`${langContext} 🔍 GUIDE ICE POLLING: ❌ Skipping invalid ICE candidate from attendee ${attendeeId}: missing sdpMLineIndex and sdpMid`);
              continue;
            }
            
            await attendeePC.addIceCandidate(new RTCIceCandidate(candidate));
            console.log(`${langContext} 🔍 GUIDE ICE POLLING: ✅ Added ICE candidate from attendee ${attendeeId}`);
            console.log(`${langContext} 🔍 GUIDE ICE POLLING: Candidate details - Type: ${candidate.type || 'unknown'}, Protocol: ${candidate.protocol || 'unknown'}, Priority: ${candidate.priority || 'unknown'}`);
          } catch (error) {
            console.error(`${langContext} 🔍 GUIDE ICE POLLING: ❌ Failed to add ICE candidate from attendee ${attendeeId}:`, error);
            console.error(`${langContext} 🔍 GUIDE ICE POLLING: ❌ Problem candidate:`, candidate);
          }
        }

        // Update the last processed index
        lastProcessedIndex = candidates.length - 1;
      } else {
        // Only log this occasionally to avoid spam
        if (Math.random() < 0.1) { // 10% chance to log
          console.log(`${langContext} 🔍 GUIDE ICE POLLING: No new candidates from attendee ${attendeeId} (${candidates.length} total, ${lastProcessedIndex + 1} processed)`);
        }
      }
    } catch (error) {
      console.error(`${langContext} Error polling for ICE candidates:`, error);
    }
  }, 1000); // Poll every second
}

async function sendIceCandidateToAttendee(
  candidate: RTCIceCandidate,
  language: string,
  attendeeId: string,
  tourId: string
): Promise<void> {
  const langContext = `[${language}]`;

  try {
    console.log(`${langContext} [GUIDE-ICE-SEND] Sending ICE candidate to attendee ${attendeeId}: ${candidate.candidate.substring(0, 80)}...`);
    console.log(`${langContext} [GUIDE-ICE-SEND] Candidate details - Type: ${candidate.type}, Protocol: ${candidate.protocol}, Priority: ${candidate.priority}`);

    let webSocketSuccess = false;

    // Try WebSocket first with retry mechanism
    const connection = openAIConnectionsByLanguage.get(language);
    if (connection?.signalingClient) {
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        const success = await connection.signalingClient.sendIceCandidate(candidate, attendeeId);
        if (success) {
          console.log(`${langContext} [GUIDE-ICE-SEND] ✅ ICE candidate sent via WebSocket to attendee ${attendeeId} (attempt ${retries + 1})`);
          webSocketSuccess = true;
          break;
        } else {
          retries++;
          console.warn(`${langContext} [GUIDE-ICE-SEND] WebSocket send failed (attempt ${retries}/${maxRetries})`);
          if (retries < maxRetries) {
            // Brief delay before retry
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }
      if (!webSocketSuccess) {
        console.warn(`${langContext} [GUIDE-ICE-SEND] All WebSocket attempts failed`);
      }
    }

    // CRITICAL FIX: Always store in Redis for HTTP polling fallback
    // Even if WebSocket succeeds, attendees may still poll via HTTP
    console.log(`${langContext} [GUIDE-ICE-SEND] Storing ICE candidate in Redis for HTTP polling fallback...`);
    
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
    
    const response = await fetch('/api/tour/ice-candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language,
        attendeeId,
        tourId,
        candidate: candidateData,
        sender: 'guide'
      }),
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`${langContext} [GUIDE-ICE-SEND] ✅ ICE candidate stored in Redis: ${data.candidateNumber} total candidates (key: ${data.redisKey})`);
      
      if (webSocketSuccess) {
        console.log(`${langContext} [GUIDE-ICE-SEND] 🎯 Dual delivery complete: WebSocket ✅ + Redis ✅`);
      } else {
        console.log(`${langContext} [GUIDE-ICE-SEND] 📦 HTTP/Redis-only delivery complete`);
      }
    } else {
      console.error(`${langContext} [GUIDE-ICE-SEND] ❌ Failed to store ICE candidate in Redis: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`${langContext} [GUIDE-ICE-SEND] Error details:`, errorText);
    }
  } catch (error) {
    console.error(`${langContext} [GUIDE-ICE-SEND] ❌ Error sending ICE candidate to attendee ${attendeeId}:`, error);
  }
}

function forwardTranslationToAttendees(
  language: string,
  translation: string
): void {
  const langContext = `[${language}]`;
  const attendeeConnections = attendeeConnectionsByLanguage.get(language);

  if (!attendeeConnections || attendeeConnections.size === 0) {
    return; // No attendees to forward to
  }

  console.log(`${langContext} Forwarding translation to ${attendeeConnections.size} attendees`);

  // Send to each attendee
  for (const [attendeeId, connection] of attendeeConnections.entries()) {
    if (connection.dc.readyState === 'open') {
      try {
        connection.dc.send(JSON.stringify({
          type: 'translation',
          text: translation
        }));
      } catch (error) {
        console.error(`${langContext} Error forwarding translation to attendee ${attendeeId}:`, error);
      }
    }
  }
}

function cleanupAttendeeConnection(
  language: string,
  attendeeId: string
): void {
  const langContext = `[${language}]`;
  console.log(`${langContext} Cleaning up connection for attendee ${attendeeId}`);

  const attendeeConnections = attendeeConnectionsByLanguage.get(language);
  if (!attendeeConnections) {
    return;
  }

  const connection = attendeeConnections.get(attendeeId);
  if (!connection) {
    return;
  }

  // Stop ICE monitoring
  if (connection.iceMonitor) {
    connection.iceMonitor.stopMonitoring();
  }

  // Close data channel if open
  if (connection.dc.readyState === 'open') {
    connection.dc.close();
  }

  // Close peer connection if not already closed
  if (connection.pc.connectionState !== 'closed') {
    connection.pc.close();
  }

  // Remove from tracked connections
  attendeeConnections.delete(attendeeId);

  // Update guide's audio state - unmute if no more attendees
  updateGuideAudioState(language);
  console.log(`${langContext} Updated guide audio state after attendee ${attendeeId} disconnected`);
}



async function verifyOpenAIAudio(
  stream: MediaStream,
  language: string
): Promise<{ isValid: boolean; details: OpenAITrackDetails[] }> {
  const langContext = `[${language}]`;

  console.log(`${langContext} Starting detailed audio verification for stream:`, {
    streamId: stream.id,
    trackCount: stream.getAudioTracks().length,
    active: stream.active
  });

  // Wait for stream stabilization as recommended by OpenAI
  await new Promise(resolve => setTimeout(resolve, 350));
  console.log(`${langContext} Stream stabilization period completed`);

  const tracks = stream.getAudioTracks();
  console.log(`${langContext} Found ${tracks.length} audio tracks in stream`);

  // Enhanced track details with more diagnostic information
  const details: OpenAITrackDetails[] = tracks.map(track => ({
    id: track.id,
    readyState: track.readyState,
    enabled: track.enabled,
    muted: track.muted
  }));

  // Log detailed information about each track
  tracks.forEach((track, index) => {
    console.log(`${langContext} Audio track ${index + 1} details:`, {
      id: track.id,
      readyState: track.readyState,
      enabled: track.enabled,
      muted: track.muted,
      kind: track.kind,
      label: track.label,
      contentHint: track.contentHint || 'none',
      constraints: track.getConstraints() || 'none'
    });
  });

  const hasValidTrack = details.some(
    track => track.readyState === 'live' && track.enabled && !track.muted
  );

  if (!hasValidTrack) {
    console.error(`${langContext} ⚠️ NO VALID AUDIO TRACKS DETECTED ⚠️`);
    console.error(`${langContext} All tracks are either not live, disabled, or muted`);
    console.error(`${langContext} This will result in no audio being heard by attendees`);
  } else {
    console.log(`${langContext} ✅ Valid audio track(s) detected and ready for use`);
  }

  console.log(`${langContext} Audio verification results:`, {
    hasValidTrack,
    details,
    streamActive: stream.active
  });

  return { isValid: hasValidTrack, details };
}
