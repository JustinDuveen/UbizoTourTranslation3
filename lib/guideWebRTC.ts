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
    audioInputLevel?: number;
    audioOutputLevel?: number;
  }> = [];
  
  async collectStats(pc: RTCPeerConnection) {
    const stats = await pc.getStats();
    const currentStats = {
      timestamp: Date.now(),
      rtt: 0,
      packetsLost: 0
    };
    
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        currentStats.rtt = report.currentRoundTripTime;
        currentStats.packetsLost = report.packetsLost || 0;
      }
    });
    
    this.stats.push(currentStats);
    this.stats = this.stats.filter(s => s.timestamp > Date.now() - 5 * 60 * 1000);
    
    return currentStats;
  }
}

// Track active connections and sent instructions by language
const openAIConnectionsByLanguage = new Map<string, OpenAIConnection>();
const sentInstructions = new Set<string>();

async function loadInstruction(language: string): Promise<AudioBuffer> {
  const audioContext = new AudioContext();
  try {
    const response = await fetch(`/audio/english_to_${language.toLowerCase()}_Translation_Instruction.mp3`);
    if (!response.ok) {
      throw new Error(`Failed to load instruction audio for ${language}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
  } catch (error) {
    console.error(`Error loading instruction for ${language}:`, error);
    throw error;
  }
}

async function sendAudioSegment(audioBuffer: AudioBuffer, pc: RTCPeerConnection): Promise<void> {
  const audioData = audioBuffer.getChannelData(0);
  const audioTrack = pc.getSenders().find(sender => sender.track?.kind === 'audio')?.track;
  
  if (!audioTrack) {
    throw new Error('No audio track found in peer connection');
  }

  // Create a MediaStream from the audio data
  const stream = new MediaStream([audioTrack]);
  const sourceNode = new AudioContext().createBufferSource();
  sourceNode.buffer = audioBuffer;
  
  // Connect and start playback
  const streamDest = new AudioContext().createMediaStreamDestination();
  sourceNode.connect(streamDest);
  sourceNode.start();
  
  // Wait for the instruction audio to finish
  await new Promise(resolve => setTimeout(resolve, audioBuffer.duration * 1000));
}

interface OpenAIConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioMonitor?: AudioMonitor;
  statsCollector?: StatsCollector;
  audioElement?: HTMLAudioElement;
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

export function cleanupGuideWebRTC(specificLanguage?: string): void {
  console.log(`Cleaning up Guide WebRTC connection${specificLanguage ? ` for ${specificLanguage}` : 's'}...`);
  
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

  // Try to load and send instruction for this language
  if (!sentInstructions.has(language)) {
    try {
      console.log(`${langContext} Loading instruction audio...`);
      const instructionBuffer = await loadInstruction(language);
      console.log(`${langContext} Instruction audio loaded, duration: ${instructionBuffer.duration}s`);
      
      // Send instruction audio first
      console.log(`${langContext} Sending instruction audio...`);
      await sendAudioSegment(instructionBuffer, openaiPC);
      console.log(`${langContext} Instruction audio sent successfully`);
      sentInstructions.add(language);
    } catch (error) {
      console.error(`${langContext} Error sending instruction audio:`, error);
      // Continue with connection setup even if instruction fails
    }
  }

  // Create data channel for OpenAI events
  const openaiDC = openaiPC.createDataChannel('oai-events');
  openaiDC.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'response.text.delta':
          if (data.delta) {
            // Pass language-specific translation
            setTranslation(data.delta);
            console.log(`${langContext} Translation received for ${language}:`, data.delta);
          }
          break;
        case 'response.audio.start':
          console.log(`${langContext} Audio translation started for ${language}`);
          break;
        case 'response.audio.end':
          console.log(`${langContext} Audio translation completed for ${language}`);
          break;
        case 'response.error':
          console.error(`${langContext} Translation error for ${language}:`, data.error);
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
      () => console.warn(`${langContext} Audio silence detected`),
      () => console.log(`${langContext} Audio activity detected`)
    );
    
    // Add audio track to peer connection
    stream.getTracks().forEach(track => openaiPC.addTrack(track, stream));
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
  openaiPC.ontrack = async (e: RTCTrackEvent) => {
    if (e.track.kind === 'audio') {
      const stream = e.streams[0];
      
      // Set stream to audio element
      audioElement.srcObject = stream;
      
      // Start stats collection
      statsInterval = setInterval(async () => {
        const currentStats = await statsCollector.collectStats(openaiPC);
        console.log(`${langContext} Connection stats:`, currentStats);
      }, 5000);

      const verification = await verifyOpenAIAudio(stream, language);
      
      if (!verification.isValid) {
        console.error(`${langContext} Audio verification failed:`, verification.details);
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

      console.log(`${langContext} Audio verification passed, stream is ready for use`);
    }
  };

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
    const model = 'gpt-4o-realtime-preview-2024-12-17';
    const voice = 'verse';
    const apiUrl = `${baseUrl}?model=${model}&voice=${voice}`;

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

async function verifyOpenAIAudio(
  stream: MediaStream,
  language: string
): Promise<{ isValid: boolean; details: OpenAITrackDetails[] }> {
  const langContext = `[${language}]`;
  
  // Wait for stream stabilization as recommended by OpenAI
  await new Promise(resolve => setTimeout(resolve, 350));

  const tracks = stream.getAudioTracks();
  const details: OpenAITrackDetails[] = tracks.map(track => ({
    id: track.id,
    readyState: track.readyState,
    enabled: track.enabled,
    muted: track.muted
  }));

  const hasValidTrack = details.some(
    track => track.readyState === 'live' && track.enabled && !track.muted
  );

  console.log(`${langContext} Audio verification results:`, {
    hasValidTrack,
    details
  });

  return { isValid: hasValidTrack, details };
}
