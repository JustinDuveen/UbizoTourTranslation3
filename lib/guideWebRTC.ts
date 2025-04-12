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

interface AttendeeConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
}

// Track active connections and sent instructions by language
const openAIConnectionsByLanguage = new Map<string, OpenAIConnection>();
// Track attendee connections by language
const attendeeConnectionsByLanguage = new Map<string, Map<string, AttendeeConnection>>();
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

      // Store the stream for forwarding to attendees
      const connection = openAIConnectionsByLanguage.get(language);
      if (connection) {
        connection.audioStream = stream;
      }

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

      // Forward audio to existing attendees
      const attendeeConnections = attendeeConnectionsByLanguage.get(language);
      if (attendeeConnections && attendeeConnections.size > 0) {
        console.log(`${langContext} Forwarding audio to ${attendeeConnections.size} existing attendees`);

        for (const [attendeeId, connection] of attendeeConnections.entries()) {
          try {
            stream.getTracks().forEach(track => {
              connection.pc.addTrack(track, stream);
            });
          } catch (error) {
            console.error(`${langContext} Error forwarding audio to attendee ${attendeeId}:`, error);
          }
        }
      }
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
    pollForAttendeeAnswers(language, tourId, setAttendees);

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

        // Process each new answer
        for (const answer of newAnswers) {
          await processAttendeeAnswer(language, tourId, answer);
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
    const answer = answerData.answer;

    // Skip if this attendee is already connected
    const attendeeConnections = attendeeConnectionsByLanguage.get(language) || new Map();
    if (attendeeConnections.has(attendeeId)) {
      console.log(`${langContext} Attendee ${attendeeId} already connected, skipping`);
      return;
    }

    // Create a new peer connection for this attendee
    const attendeePC = createAttendeeConnection(language, attendeeId, tourId);

    // Set the remote description (the attendee's answer)
    await attendeePC.setRemoteDescription(new RTCSessionDescription(answer));
    console.log(`${langContext} Set remote description for attendee ${attendeeId}`);

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
