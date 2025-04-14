//Translation Monitor import to check audio:
import { initializeMonitor, enhanceOnTrackHandler, cleanupMonitor } from './translationMonitorIntegration';
//


import { executeReplaceOfferTransaction } from "@/lib/languageUtils";

// Audio monitoring and connection handling classes
class AudioMonitor {
  private audioContext: AudioContext;
  private analyser: AnalyserNode;
  private dataArray: Uint8Array;
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor(stream: MediaStream) {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  startMonitoring(onSilence: () => void, onActive: () => void) {
    let silenceCounter = 0;
    this.monitorInterval = setInterval(() => {
      this.analyser.getByteFrequencyData(this.dataArray);
      const sum = this.dataArray.reduce((acc, val) => acc + val, 0);
      const audioLevel = sum / this.dataArray.length / 255;

      if (audioLevel < 0.01) {
        silenceCounter++;
        if (silenceCounter > 50) {
          onSilence();
        }
      } else {
        silenceCounter = 0;
        onActive();
      }
    }, 100);
  }

  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
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

async function loadInstruction(language: string): Promise<AudioBuffer> {
  try {
    const response = await fetch(`/audio/english_to_${language.toLowerCase()}_Translation_Instruction.mp3`);
    if (!response.ok) {
      throw new Error(`Failed to load instruction audio for ${language}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = getAudioContext();
    return await audioContext.decodeAudioData(arrayBuffer);
  } catch (error) {
    console.error(`Error loading instruction for ${language}:`, error);
    throw error;
  }
}

function verifyAudioTracks(pc: RTCPeerConnection, langContext: string): boolean {
  const audioTrack = pc.getSenders().find(sender => sender.track?.kind === 'audio')?.track;
  const hasAudioTrack = !!audioTrack;

  if (!hasAudioTrack) {
    console.warn(`${langContext} No audio track found in peer connection`);
  } else {
    console.log(`${langContext} Audio track verified: id=${audioTrack.id}, enabled=${audioTrack.enabled}, muted=${audioTrack.muted}`);
  }

  return hasAudioTrack;
}

async function sendAudioSegment(audioBuffer: AudioBuffer, pc: RTCPeerConnection, langContext: string): Promise<void> {
  try {
    const audioData = audioBuffer.getChannelData(0);
    const audioTrack = pc.getSenders().find(sender => sender.track?.kind === 'audio')?.track;

    if (!audioTrack) {
      throw new Error('No audio track found in peer connection');
    }

    // Create a MediaStream from the audio data
    const stream = new MediaStream([audioTrack]);

    // Get the AudioContext safely
    const audioContext = getAudioContext();

    // Use the shared AudioContext for all audio operations
    const sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;

    // Connect and start playback using the same AudioContext
    const streamDest = audioContext.createMediaStreamDestination();
    sourceNode.connect(streamDest);
    sourceNode.start();

    console.log(`${langContext} Playing instruction audio, duration: ${audioBuffer.duration}s`);

    // Wait for the instruction audio to finish
    await new Promise(resolve => setTimeout(resolve, audioBuffer.duration * 1000));

    console.log(`${langContext} Instruction audio playback completed`);
  } catch (error) {
    console.error(`${langContext} Error in sendAudioSegment:`, error);
    throw error;
  }
}

interface OpenAIConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioMonitor?: AudioMonitor;
  statsCollector?: StatsCollector;
  audioElement?: HTMLAudioElement;
  audioStream?: MediaStream;
  answerPollInterval?: NodeJS.Timeout;
}

interface OpenAITrackDetails {
  id: string;
  readyState: string;
  enabled: boolean;
  muted: boolean;
}

export async function initGuideWebRTC(
  setTranslation: (translation: string) => void,
  language: string,
  setAttendees: (attendees: string[]) => void,
  tourId: string
): Promise<void> {
  console.log(`[${language}] Initializing Guide WebRTC...`);


  // Add this line to initialize the Translation Monitor
  initializeMonitor();



  // Cleanup existing connection for this language if it exists
  if (openAIConnectionsByLanguage.has(language)) {
    console.log(`[${language}] Cleaning up existing connection before reinitializing`);
    cleanupGuideWebRTC(language);
  }

  const connection = await setupOpenAIConnection(language, setTranslation, setAttendees, tourId);
  if (connection) {
    openAIConnectionsByLanguage.set(language, connection);
    console.log(`[${language}] Guide WebRTC initialized successfully`);
  } else {
    console.error(`[${language}] Failed to initialize Guide WebRTC`);
    throw new Error(`Failed to initialize WebRTC for ${language}`);
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
  console.log(`Cleaning up Guide WebRTC connection${specificLanguage ? ` for ${specificLanguage}` : 's'}...`);

  // Add this line to clean up the monitor
  cleanupMonitor();

  const cleanupConnection = (language: string, connection: OpenAIConnection) => {
    console.log(`[${language}] Cleaning up connection...`);

    // Stop audio monitoring
    if (connection.audioMonitor) {
      connection.audioMonitor.stop();
    }

    // Clean up audio element
    if (connection.audioElement) {
      connection.audioElement.srcObject = null;
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

    // Remove from tracked connections
    openAIConnectionsByLanguage.delete(language);
  };

  if (specificLanguage) {
    const connection = openAIConnectionsByLanguage.get(specificLanguage);
    if (connection) {
      cleanupConnection(specificLanguage, connection);
      console.log(`[${specificLanguage}] Connection cleaned up`);
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
  tourId: string
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

  // Create and configure the OpenAI peer connection
  const openaiPC = new RTCPeerConnection({
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302'
      }
    ]
  });

  // Pre-load instruction audio for this language if needed
  let instructionBuffer: AudioBuffer | null = null;
  if (!sentInstructions.has(language)) {
    try {
      console.log(`${langContext} Loading instruction audio...`);
      instructionBuffer = await loadInstruction(language);
      console.log(`${langContext} Instruction audio loaded, duration: ${instructionBuffer.duration}s`);
    } catch (error) {
      console.error(`${langContext} Error loading instruction audio:`, error);
      // Continue with connection setup even if instruction loading fails
    }
  }

  // Create data channel for OpenAI events
  const openaiDC = openaiPC.createDataChannel('oai-events');
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
          break;
        case 'input_audio_buffer.speech_stopped':
          console.log(`${langContext} Speech stopped, OpenAI may generate a response`);
          break;
        case 'response.error':
          console.error(`${langContext} Translation error for ${language}:`, data.error);
          break;
        case 'error':
          console.error(`${langContext} Error from OpenAI:`, data);
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
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1, // Mono audio for better translation
        sampleRate: 16000, // Optimal for speech recognition
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Set up audio monitoring
    audioMonitor = new AudioMonitor(stream);
    audioMonitor.startMonitoring(
      () => {/* Silence detected - log removed */},
      () => {/* Audio activity detected - log removed */}
    );

    // Add audio track to peer connection
    stream.getTracks().forEach(track => openaiPC.addTrack(track, stream));

    // Now that we have added audio tracks, try to send instruction audio if available
    if (instructionBuffer && !sentInstructions.has(language)) {
      // Set up retry mechanism
      const maxRetries = 3;
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          // Wait a short time to ensure tracks are properly registered
          // Increase wait time with each retry
          const waitTime = 100 * Math.pow(2, retryCount);
          await new Promise(resolve => setTimeout(resolve, waitTime));

          // Verify tracks exist before proceeding
          if (verifyAudioTracks(openaiPC, langContext)) {
            // Send instruction audio
            console.log(`${langContext} Sending instruction audio (attempt ${retryCount + 1}/${maxRetries})...`);
            await sendAudioSegment(instructionBuffer, openaiPC, langContext);
            console.log(`${langContext} Instruction audio sent successfully`);
            sentInstructions.add(language);
            success = true;
          } else {
            console.warn(`${langContext} No audio tracks available (attempt ${retryCount + 1}/${maxRetries}), retrying...`);
            retryCount++;
          }
        } catch (error) {
          console.error(`${langContext} Error sending instruction audio (attempt ${retryCount + 1}/${maxRetries}):`, error);
          retryCount++;
          if (retryCount >= maxRetries) {
            console.warn(`${langContext} Failed to send instruction audio after ${maxRetries} attempts, continuing with setup`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`${langContext} Error accessing microphone:`, error);
    return null;
  }

  // Create audio element for remote stream
  const audioElement = document.createElement('audio');
  audioElement.autoplay = true;

  // Set up connection state monitoring
  openaiPC.oniceconnectionstatechange = () => {
    console.log(`${langContext} ICE connection state:`, openaiPC.iceConnectionState);
  };

  openaiPC.onconnectionstatechange = () => {
    console.log(`${langContext} Connection state:`, openaiPC.connectionState);
  };

  // Handle incoming audio tracks
  // Define the original handler as a separate function
  const originalOnTrackHandler = async (e: RTCTrackEvent) => {
    console.log(`${langContext} ontrack event received:`, {
      trackKind: e.track.kind,
      trackId: e.track.id,
      streamCount: e.streams.length,
      timestamp: new Date().toISOString()
    });

    if (e.track.kind === 'audio') {
      console.log(`${langContext} 🎵 AUDIO TRACK RECEIVED from OpenAI 🎵`);
      console.log(`${langContext} Track details:`, {
        id: e.track.id,
        enabled: e.track.enabled,
        muted: e.track.muted,
        readyState: e.track.readyState,
        label: e.track.label || 'no label'
      });

      const stream = e.streams[0];
      console.log(`${langContext} Stream details:`, {
        id: stream.id,
        active: stream.active,
        trackCount: stream.getTracks().length
      });

      // Store the stream for forwarding to attendees
      const connection = openAIConnectionsByLanguage.get(language);
      if (connection) {
        connection.audioStream = stream;
        console.log(`${langContext} Audio stream stored in connection for language: ${language}`);
      }

      // Set stream to audio element
      console.log(`${langContext} Setting audio element srcObject to stream`);
      audioElement.srcObject = stream;

      // Configure audio element for better usability
      audioElement.id = `guide-audio-${language}`;
      audioElement.className = 'guide-audio-element';
      audioElement.controls = true; // Add controls for manual playback
      audioElement.volume = 1.0; // Ensure maximum volume
      audioElement.muted = false; // Ensure not muted
      audioElement.style.display = 'block'; // Make it visible

      // Create a container for the audio element with proper styling
      const audioContainer = document.createElement('div');
      audioContainer.id = `guide-audio-container-${language}`;
      audioContainer.className = 'guide-audio-container';
      audioContainer.style.position = 'fixed';
      audioContainer.style.bottom = '10px';
      audioContainer.style.right = '10px';
      audioContainer.style.zIndex = '9999';
      audioContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      audioContainer.style.padding = '10px';
      audioContainer.style.borderRadius = '5px';
      audioContainer.style.color = 'white';

      // Add a label to show which language this is
      const audioLabel = document.createElement('div');
      audioLabel.textContent = `Guide Audio: ${language}`;
      audioLabel.style.marginBottom = '5px';
      audioLabel.style.fontWeight = 'bold';

      // Add elements to the container
      audioContainer.appendChild(audioLabel);
      audioContainer.appendChild(audioElement);

      // Add the container to the document body
      if (!document.getElementById(audioContainer.id)) {
        console.log(`${langContext} Adding audio element to DOM`);
        document.body.appendChild(audioContainer);
      } else {
        console.log(`${langContext} Audio container already exists, updating`);
        const existingContainer = document.getElementById(audioContainer.id);
        existingContainer?.replaceWith(audioContainer);
      }

      // Add event listeners to audio element to track playback status
      audioElement.onplay = () => console.log(`${langContext} Audio element started playing`);
      audioElement.onpause = () => console.log(`${langContext} Audio element paused`);
      audioElement.onended = () => console.log(`${langContext} Audio element playback ended`);
      audioElement.onerror = (e) => console.error(`${langContext} Audio element error:`, e);

      // Try to play the audio element
      try {
        console.log(`${langContext} Attempting to play audio...`);
        const playPromise = audioElement.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => console.log(`${langContext} Audio playback started successfully`))
            .catch(error => {
              console.error(`${langContext} Audio playback failed:`, error);

              // Create a play button for user interaction if autoplay fails
              const playButton = document.createElement('button');
              playButton.textContent = `Enable ${language} Audio`;
              playButton.style.padding = '8px 16px';
              playButton.style.backgroundColor = '#4CAF50';
              playButton.style.color = 'white';
              playButton.style.border = 'none';
              playButton.style.borderRadius = '4px';
              playButton.style.cursor = 'pointer';
              playButton.style.marginTop = '5px';

              playButton.onclick = () => {
                audioElement.play()
                  .then(() => {
                    console.log(`${langContext} Audio playback started after button click`);
                    playButton.remove();
                  })
                  .catch(err => console.error(`${langContext} Failed to play audio after button click:`, err));
              };

              audioContainer.appendChild(playButton);
            });
        }
      } catch (error) {
        console.error(`${langContext} Error starting audio playback:`, error);
      }

      // Start stats collection with enhanced logging
      console.log(`${langContext} Starting WebRTC stats collection`);
      statsInterval = setInterval(async () => {
        try {
          const currentStats = await statsCollector.collectStats(openaiPC);
          console.log(`${langContext} Connection stats:`, currentStats);

          // Check if we're receiving audio packets
          const stats = await openaiPC.getStats();
          let bytesReceived = 0;
          let packetsReceived = 0;
          let packetsLost = 0;

          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              bytesReceived = report.bytesReceived || 0;
              packetsReceived = report.packetsReceived || 0;
              packetsLost = report.packetsLost || 0;

              console.log(`${langContext} Audio stats:`, {
                bytesReceived,
                packetsReceived,
                packetsLost,
                timestamp: report.timestamp
              });
            }
          });

          if (packetsReceived > 0) {
            console.log(`${langContext} ✅ Receiving audio data: ${bytesReceived} bytes, ${packetsReceived} packets`);
          } else {
            console.warn(`${langContext} ⚠️ No audio packets received yet`);
          }
        } catch (error) {
          console.error(`${langContext} Error collecting stats:`, error);
        }
      }, 5000);

      console.log(`${langContext} Running audio verification...`);
      const verification = await verifyOpenAIAudio(stream, language);

      if (!verification.isValid) {
        console.error(`${langContext} ❌ Audio verification failed:`, verification.details);
        if (verification.details.some(track => track.readyState === 'ended')) {
          console.error(`${langContext} Track ended prematurely, connection may need to be re-established`);

          // Clean up monitoring
          if (audioMonitor) {
            audioMonitor.stop();
            audioMonitor = null;
          }
          if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
          }
        }
        return;
      }

      console.log(`${langContext} ✅ Audio verification passed, stream is ready for use`);

      // Forward audio to existing attendees
      const attendeeConnections = attendeeConnectionsByLanguage.get(language);
      if (attendeeConnections && attendeeConnections.size > 0) {
        console.log(`${langContext} Forwarding audio to ${attendeeConnections.size} existing attendees`);

        for (const [attendeeId, connection] of attendeeConnections.entries()) {
          try {
            stream.getTracks().forEach(track => {
              console.log(`${langContext} Adding track ${track.id} to attendee ${attendeeId}`);
              connection.pc.addTrack(track, stream);
            });
            console.log(`${langContext} Successfully forwarded audio to attendee ${attendeeId}`);
          } catch (error) {
            console.error(`${langContext} Error forwarding audio to attendee ${attendeeId}:`, error);
          }
        }
      } else {
        console.log(`${langContext} No attendees connected yet, audio will be forwarded when they join`);
      }
    } else {
      console.log(`${langContext} Received non-audio track: ${e.track.kind}`);
    }
  };

  // Replace with enhanced handler
  openaiPC.ontrack = enhanceOnTrackHandler(originalOnTrackHandler, language);

  // Create and set local description
  try {
    const offer = await openaiPC.createOffer();

    // Ensure the SDP has a=sendrecv for audio
    const modifiedSdp = offer.sdp?.replace(
      /(m=audio.*\r\n(?:.*\r\n)*)/,
      '$1a=sendrecv\r\n'
    );

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
            console.log(`${langContext} SDP offer successfully stored in Redis for attendees via API`);
            storeSuccess = true;
            break;
          } else {
            // If the API fails, try to get a Redis client and execute the transaction directly
            console.warn(`${langContext} API storage failed, attempting direct Redis transaction...`);

            // This would require importing a Redis client, which we don't have direct access to here
            // Instead, we'll retry the API with exponential backoff
            console.error(`${langContext} Failed to store SDP offer via API (attempt ${attempt})`);
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

    // Start polling for attendee answers
    try {
      console.log(`${langContext} About to start polling for attendee answers...`);
      pollForAttendeeAnswers(language, tourId, setAttendees);
      console.log(`${langContext} Polling for attendee answers started`);
    } catch (error) {
      console.error(`${langContext} Error starting polling for attendee answers:`, error);
    }

    return {
      pc: openaiPC,
      dc: openaiDC,
      audioMonitor,
      statsCollector,
      audioElement,
    };

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
  answerData: any
): Promise<void> {
  const langContext = `[${language}]`;
  console.log(`${langContext} Processing attendee answer:`, answerData);

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
    const attendeePC = createAttendeeConnection(language, attendeeId, tourId);

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
    } catch (error) {
      console.error(`${langContext} Error setting remote description for attendee ${attendeeId}:`, error);
      return; // Skip this attendee if we can't set the remote description
    }

    // Forward any existing audio tracks from OpenAI to this attendee
    const openAIConnection = openAIConnectionsByLanguage.get(language);
    if (openAIConnection && openAIConnection.audioStream) {
      openAIConnection.audioStream.getTracks().forEach(track => {
        attendeePC.addTrack(track, openAIConnection.audioStream!);
      });
      console.log(`${langContext} Forwarded audio tracks to attendee ${attendeeId}`);
    }

    // Start polling for this attendee's ICE candidates
    pollForAttendeeIceCandidates(language, attendeeId, tourId, attendeePC);
  } catch (error) {
    console.error(`${langContext} Error processing attendee answer:`, error);
  }
}

function createAttendeeConnection(
  language: string,
  attendeeId: string,
  tourId: string
): RTCPeerConnection {
  const langContext = `[${language}]`;
  console.log(`${langContext} Creating connection for attendee ${attendeeId}`);

  // Create a new peer connection
  const attendeePC = new RTCPeerConnection({
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302'
      }
    ]
  });

  // Set up event handlers
  attendeePC.oniceconnectionstatechange = () => {
    console.log(`${langContext} Attendee ${attendeeId} ICE connection state:`, attendeePC.iceConnectionState);

    // Clean up if connection fails or closes
    if (
      attendeePC.iceConnectionState === 'disconnected' ||
      attendeePC.iceConnectionState === 'failed' ||
      attendeePC.iceConnectionState === 'closed'
    ) {
      cleanupAttendeeConnection(language, attendeeId);
    }
  };

  attendeePC.onconnectionstatechange = () => {
    console.log(`${langContext} Attendee ${attendeeId} connection state:`, attendeePC.connectionState);
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

  attendeeConnections.set(attendeeId, {
    pc: attendeePC,
    dc: dataChannel
  });

  // Handle ICE candidates
  attendeePC.onicecandidate = (event) => {
    if (event.candidate) {
      sendIceCandidateToAttendee(event.candidate, language, attendeeId, tourId);
    }
  };

  return attendeePC;
}

async function pollForAttendeeIceCandidates(
  language: string,
  attendeeId: string,
  tourId: string,
  attendeePC: RTCPeerConnection
): Promise<void> {
  const langContext = `[${language}]`;
  console.log(`${langContext} Starting to poll for ICE candidates from attendee ${attendeeId}`);

  let lastProcessedIndex = -1;

  const pollInterval = setInterval(async () => {
    try {
      // Check if connection is still active
      if (
        attendeePC.connectionState === 'closed' ||
        attendeePC.connectionState === 'failed' ||
        attendeePC.connectionState === 'disconnected'
      ) {
        clearInterval(pollInterval);
        return;
      }

      // Fetch ICE candidates from the attendee
      const response = await fetch(`/api/tour/attendee-ice?language=${language}&attendeeId=${attendeeId}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        console.error(`${langContext} Error fetching ICE candidates: ${response.status}`);
        return;
      }

      const data = await response.json();
      const candidates = data.candidates || [];

      // Process only new candidates
      if (candidates.length > lastProcessedIndex + 1) {
        const newCandidates = candidates.slice(lastProcessedIndex + 1);
        console.log(`${langContext} Found ${newCandidates.length} new ICE candidates from attendee ${attendeeId}`);

        // Add each candidate to the peer connection
        for (const candidate of newCandidates) {
          await attendeePC.addIceCandidate(new RTCIceCandidate(candidate));
        }

        // Update the last processed index
        lastProcessedIndex = candidates.length - 1;
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
    await fetch('/api/tour/ice-candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language,
        attendeeId,
        tourId,
        candidate
      }),
      credentials: 'include'
    });
  } catch (error) {
    console.error(`${langContext} Error sending ICE candidate to attendee ${attendeeId}:`, error);
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
