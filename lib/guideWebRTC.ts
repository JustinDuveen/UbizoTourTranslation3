// lib/guideWebRTC.ts
// Map of language to OpenAI connection
interface OpenAIConnection {
    pc: RTCPeerConnection;
    dc: RTCDataChannel;
  }
  
  interface AttendeeConnection {
    id: string;
    pc: RTCPeerConnection;
    dc: RTCDataChannel;
  }
  
  // --- NEW: OpenAI Audio Verification Interface ---
  interface OpenAITrackDetails {
      id: string;
      enabled: boolean;
      muted: boolean;
      readyState: 'live' | 'ended';
      kind: string;
      contentType?: 'speech' | 'music'; // OpenAI-specific inference
      processingState?: 'active' | 'inactive'; // For OpenAI stream status
  }
  // --- END NEW ---
  
  
  // Map of language to Set of attendee connections for that language
  const openaiConnections = new Map<string, OpenAIConnection>();
  const attendeeConnectionsByLanguage = new Map<string, Set<AttendeeConnection>>();
  export const allAttendees = new Map<string, string>(); // attendeeId -> language
  
  // Keep track of connection status
  let connectionInterval: number | null = null;
  const renewalTimers = new Map<string, number>();
  
  // Track temporary audio elements for guide playback
  const guideAudioElements = new Map<string, HTMLAudioElement>();

  // Configuration constants
const ICE_CONFIG = {
    TIMEOUT: 25000,
    GATHERING_TIMEOUT: 33000
  };
  


  /**
  * Converts an ArrayBuffer to a Base64 string (for JSON transmission)
  *
  * @param buffer - The ArrayBuffer to convert.
  * @returns The Base64 representation of the ArrayBuffer.
  */
  export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const binary = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary.push(String.fromCharCode(bytes[i]));
    }
    return btoa(binary.join(''));
  }
  
  /**
  * Converts a Base64 string back to an ArrayBuffer
  *
  * @param base64 - The Base64 string to convert.
  * @returns The ArrayBuffer representation of the Base64 string.
  */
  export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  /**
  * Creates a transferable message for WebRTC data channels.  Always uses ArrayBuffer for audio.
  *
  * @param type - A string indicating the type of data being sent.
  * @param data - The data to send. Can be a JS object (serialized to JSON) or an ArrayBuffer.
  * @param options - (Optional) Options.
  * @param options.isBinary -  A boolean indicating whether the data is binary.
  * @returns Either a string (JSON-serialized) or an ArrayBuffer.
  */
  export function createTransferableMessage(type: string, data: any, options?: { isBinary?: boolean }): string | ArrayBuffer {
    if (options?.isBinary || type === 'audio') {
        return data; // Return the ArrayBuffer directly for binary data or audio
    } else {
        return JSON.stringify({ // Wrap JSON data with type and timestamp
            type,
            data,
            timestamp: Date.now()
        });
    }
  }
  
  /**
  * Sends data through a WebRTC data channel, with error handling.
  *
  * @param dataChannel - The WebRTC RTCDataChannel to send the data through.
  * @param type - A string indicating the type of data being sent.
  * @param data - The data to send.
  * @param options - (Optional) Options.
  * @returns A boolean indicating whether the send was successful.
  */
  export function sendThroughDataChannel(
    dataChannel: RTCDataChannel,
    type: string,
    data: any,
    options?: { isBinary?: boolean }
  ): boolean {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        console.warn(`Cannot send ${type}: Data channel not open (state: ${dataChannel?.readyState})`);
        return false;
    }
  
    if (typeof data === 'string' && data.length > 15000) { // ~15KB OpenAI limit
          console.error("Message too long - will be truncated by OpenAI");
          return false;
      }
  
    try {
        const message = createTransferableMessage(type, data, options);
  
        if (message instanceof ArrayBuffer) {
            dataChannel.send(message);
        } else {
            dataChannel.send(message as string);
        }
        return true;
    } catch (error) {
        console.error(`Error sending ${type} through data channel:`, error);
        return false;
    }
  }
  
  /**
   * --- NEW: OpenAI Audio Verification Function ---
   * Verifies the incoming audio stream from OpenAI based on their recommendations.
   *
   * @param stream The MediaStream received from OpenAI.
   * @param language The language context for logging.
   * @returns A promise resolving to an object containing validity status and track details.
   */
  const verifyOpenAIAudio = async (stream: MediaStream, language: string): Promise<{
    isValid: boolean;
    details: OpenAITrackDetails[];
  }> => {
    const streamId = stream?.id ?? 'unknown';
    console.log(`[${language}] Verifying OpenAI audio stream ${streamId}...`);
  
    // Wait for OpenAI's recommended initial buffer time
    await new Promise(resolve => setTimeout(resolve, 350));
  
    const tracks = stream?.getAudioTracks() ?? [];
    if (tracks.length === 0) {
        console.error(`[${language}] OpenAI Audio Validation Failed: No audio tracks found in stream ${streamId}.`, {
            streamActive: stream?.active,
        });
        return { isValid: false, details: [] };
    }
  
    const details: OpenAITrackDetails[] = tracks.map(track => {
        // Infer content type based on echo cancellation (common for speech)
        // Note: This is an inference, not a guarantee from OpenAI's API.
        const contentType = track.getSettings().echoCancellation ? 'speech' : undefined;
        // Determine processing state based on standard track properties
        const processingState = track.enabled && !track.muted && track.readyState === 'live' ? 'active' : 'inactive';
  
        return {
            id: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            kind: track.kind,
            contentType: contentType,
            processingState: processingState
        };
    });
  
    // OpenAI-specific validation: At least one track must be live and active (enabled, not muted)
    const isValid = details.some(track =>
      track.readyState === 'live' &&
      track.processingState === 'active'
    );
  
    if (!isValid) {
      console.error(`[${language}] OpenAI Audio Validation Failed for stream ${streamId}:`, {
        expected: 'At least one track with readyState="live" and processingState="active"',
        received: details.map(d => ({
            id: d.id,
            readyState: d.readyState,
            enabled: d.enabled,
            muted: d.muted,
            processingState: d.processingState,
        }))
      });
    } else {
        console.log(`[${language}] OpenAI audio stream ${streamId} verified successfully. Tracks:`, details);
    }
  
    return { isValid, details };
  };
  // --- END NEW ---
  
  
  /**
  * Plays audio for the guide when no attendees are connected.
  * Improved version with better resource management.
  */
  function playAudioForGuide(stream: MediaStream, language?: string): void {
    const langContext = language ? `[${language}]` : '[Guide]';
    console.log(`${langContext} Playing audio locally for guide (no attendees connected for ${language || 'this stream'}). Stream ID: ${stream.id}`);
  
    // Clean up any existing audio element for this language
    if (language && guideAudioElements.has(language)) {
        const existingAudio = guideAudioElements.get(language);
        if (existingAudio) {
            console.log(`${langContext} Stopping and removing previous guide audio element.`);
            existingAudio.pause();
            existingAudio.srcObject = null;
            existingAudio.remove();
            guideAudioElements.delete(language);
        }
    }
  
    // Create a new audio element with better error handling
    try {
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.muted = false; // Guide should hear this
  
        // Add error handling
        audioEl.onerror = (e) => {
            console.error(`${langContext} Guide audio playback error:`, e);
            audioEl.remove();
            if (language) {
                guideAudioElements.delete(language);
            }
        };
  
        // Log when playback actually starts
        audioEl.onplaying = () => {
            console.log(`${langContext} Guide audio playback started successfully for stream ${stream.id}.`);
        };
  
        // Set srcObject with error handling
        try {
            audioEl.srcObject = stream;
        } catch (error) {
            console.error(`${langContext} Error setting srcObject for guide audio:`, error);
            audioEl.remove(); // Clean up failed element
            return;
        }
  
        // Add to DOM (hidden)
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);
  
        // Store reference if language is provided
        if (language) {
            guideAudioElements.set(language, audioEl);
  
            // Optional: Clean up when an attendee joins this language (already handled elsewhere but good redundancy)
            // Consider if this interval check is still necessary given other logic
        }
  
        // Clean up when audio ends naturally
        audioEl.addEventListener('ended', () => {
            console.log(`${langContext} Guide audio playback ended for stream ${stream.id}. Removing element.`);
            audioEl.remove();
            if (language) {
                guideAudioElements.delete(language);
            }
        });
  
    } catch (error) {
        console.error(`${langContext} Error creating audio element for guide playback:`, error);
    }
  }
  
  /**
  * Updates the overall list of attendees from our tracking maps.
  * @param setAttendees Function to update the attendee list in the UI
  */
  function updateAttendeesList(setAttendees?: ((attendees: string[]) => void) | undefined): void {
    // First, check if setAttendees is defined and is a function
    if (setAttendees && typeof setAttendees === 'function') {
        try {
            // Get the current list of attendee IDs from our tracking map
            const attendeeList = Array.from(allAttendees.keys());
  
            // Call the setter function with the current list of attendees
            setAttendees(attendeeList);
  
            // Log the update for debugging purposes
            // console.log(`Updated attendees list with ${attendeeList.length} attendees`); // Reduce log noise
        } catch (error) {
            // Catch any errors during the update process
            console.error("Error updating attendees list:", error);
        }
    } else {
        // Log a warning but don't throw an error as this might be called in contexts
        // where setAttendees is optional
        console.warn("No valid setAttendees function provided to updateAttendeesList");
    }
  }
  
  /**
  * Loads an audio instruction file and converts it to an ArrayBuffer.
  */
  async function loadAudioInstructions(language: string): Promise<ArrayBuffer | null> { // Allow null return
    const filePath = `audio/english_to_${language.toLowerCase()}_Translation_Instruction.mp3`;
    try {
        console.log(`[${language}] Loading audio instructions from ${filePath}`);
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`Failed to load audio instructions from ${filePath} - Status: ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        console.log(`[${language}] Successfully loaded audio instructions (${buffer.byteLength} bytes).`);
        return buffer;
    } catch (error) {
        console.error(`[${language}] Failed to load audio instructions:`, error);
        // Return null instead of throwing, allows connection to proceed without instructions
        return null;
    }
  }
  
  
  
  /**
  * Stores the available language map in Redis for a given tour.
  * Contains: French, German, Dutch, Spanish, and Portuguese.
  */
  async function storeLanguageMapInRedis(tourId: string): Promise<void> {
      try {
          const response = await fetch(`/api/tour/languages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                  tourId,
                  languages: ['french', 'german', 'dutch', 'spanish', 'portuguese'],
              }),
          });
  
          if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Failed to store language map: ${response.status} ${response.statusText} - ${errorText}`);
          }
          console.log(`Stored language map in Redis for tour ${tourId}`);
      } catch (error) {
          console.error("Error storing language map in Redis:", error);
      }
    }
  
  
  
  /**
  * Stores the final translation result in Redis via a backend API.
  */
  async function storeTranslationInRedis(tourId: string, language: string, translation: string): Promise<void> {
    try {
        const response = await fetch(`/api/tour/answer?language=${language}&tourId=${tourId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                tourId,
                language,
                translation,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to store translation: ${response.status} ${response.statusText} - ${errorText}`);
        }
        console.log(`[${language}] Stored translation in Redis`);
    } catch (error) {
        console.error(`[${language}] Error storing translation in Redis:`, error);
    }
  }
  
  /**
  * Forward a translation (text or audio) to all attendees of a specific language
  */
  /**
  * Forward text translation to attendees
  */
  function forwardTranslationToAttendees(language: string, translationData: any): void {
    const connections = attendeeConnectionsByLanguage.get(language);
    if (!connections || connections.size === 0) {
      //   console.log(`[${language}] No attendees to forward translation.`); // Reduce log noise
        return;
    }
  
    // console.log(`[${language}] Forwarding translation to ${connections.size} attendees.`); // Reduce log noise
    for (const conn of connections) {
        if (conn.dc.readyState === "open") {
            try {
              //   console.log(`[${language}] Sending translation data to attendee ${conn.id}:`, translationData.type); // Log type, not full data
                conn.dc.send(JSON.stringify(translationData));
            } catch (error) {
                console.error(`[${language}] Error forwarding translation to attendee ${conn.id}:`, error);
            }
        } else {
            console.warn(`[${language}] Cannot forward translation to attendee ${conn.id}: Data channel state is ${conn.dc.readyState}`);
        }
    }
  }
  
  
  /**
   * Modified OpenAI data channel message handler with improved audio handling
   */
  function handleOpenAIMessage(e: MessageEvent, language: string, setTranslation: (translation: string) => void): void {
      const langContext = `[${language}]`;
      try {
          const realtimeEvent = JSON.parse(e.data);
          // console.log(`${langContext} OpenAI event received: ${realtimeEvent.type}`); // Reduce log noise unless debugging specific event types
  
          if (realtimeEvent.type === "error") {
              console.error(`${langContext} OpenAI Server Error Event:`, realtimeEvent);
              // Consider adding more specific error handling or UI feedback here
              return;
          }
  
          // Optional detailed logging for audio/buffer events during debugging
          // if (realtimeEvent.type.includes('audio') || realtimeEvent.type.includes('buffer')) {
          //   console.debug(`${langContext} Audio/Buffer Event:`, {
          //     type: realtimeEvent.type,
          //     response_id: realtimeEvent.response_id,
          //     timestamp: Date.now()
          //   });
          // }
  
          switch (realtimeEvent.type) {
              case "session.created":
              case "session.updated":
              case "response.created":
              case "rate_limits.updated":
                  console.log(`${langContext} OpenAI Info Event (${realtimeEvent.type}):`, realtimeEvent);
                  break;
  
              // Audio is handled via ontrack after verification, so delta isn't needed here.
              case "response.audio.delta":
                  // console.debug(`${langContext} Received audio delta (ignored, handled via WebRTC track)`);
                  break;
  
              case "response.text.delta":
                  const newText = realtimeEvent.delta;
                  setTranslation(newText); // Update UI
                  // Forward text delta to attendees
                  forwardTranslationToAttendees(language, { type: 'translation_delta', text: newText });
                  break;
  
               case "response.audio_transcript.delta":
                  // console.log(`${langContext} Transcript delta:`, realtimeEvent.delta);
                  // This might be useful for live captioning later
                  break;
  
              case "response.audio_transcript.done":
                  console.log(`${langContext} Final transcript available for response ID: ${realtimeEvent.response_id}`);
                  // Potentially trigger final storage or processing of the transcript here.
                  // Forward final transcript to attendees if needed
                  forwardTranslationToAttendees(language, { type: 'transcript_final', transcript: realtimeEvent.transcript });
                  break;
  
              case "response.done":
                  console.log(`${langContext} OpenAI Response Complete. Response ID: ${realtimeEvent.response_id}`);
                  // Forward completion signal to attendees
                  forwardTranslationToAttendees(language, { type: 'translation_complete' });
                  // You might store the final aggregated translation here if needed, though delta handles most cases.
                  // storeTranslationInRedis(tourId, language, aggregatedTranslation); // Need to aggregate deltas if doing this
                  break;
  
              case "conversation.item.truncated":
                  console.warn(`${langContext} OpenAI Conversation Item Truncated:`, {
                      item_id: realtimeEvent.item_id,
                      truncated_bytes: realtimeEvent.truncated_bytes,
                      remaining_length: realtimeEvent.remaining_length
                  });
                  // Optional: Send a notification to the guide UI.
                  forwardTranslationToAttendees(language, { type: 'warning', message: 'Translation history may be incomplete.' });
                  break;
  
              // --- Audio Lifecycle Events (Informational) ---
              case "input_audio_buffer.speech_started":
                   console.log(`${langContext} OpenAI detected speech start.`);
                   forwardTranslationToAttendees(language, { type: 'guide_speech_start' });
                   break;
              case "input_audio_buffer.speech_stopped":
                   console.log(`${langContext} OpenAI detected speech stop.`);
                   forwardTranslationToAttendees(language, { type: 'guide_speech_stop' });
                   break;
              case "input_audio_buffer.committed":
                   // console.log(`${langContext} OpenAI committed input audio buffer.`); // Usually too noisy
                   break;
              case "output_audio_buffer.started":
                   console.log(`${langContext} OpenAI audio output started.`);
                   forwardTranslationToAttendees(language, { type: 'translation_audio_start' });
                   // Could trigger UI indicator that audio is playing for attendees
                   break;
              case "output_audio_buffer.stopped":
                   console.log(`${langContext} OpenAI audio output stopped.`);
                   forwardTranslationToAttendees(language, { type: 'translation_audio_stop' });
                   // Could stop UI indicator
                   break;
              case "output_audio_buffer.cleared":
                   console.log(`${langContext} OpenAI audio output buffer cleared.`);
                   break;
              // --- End Audio Lifecycle Events ---
  
              case "conversation.item.created":
              case "response.output_item.added":
              case "response.content_part.added":
              case "response.content_part.done":
              case "response.output_item.done":
                  // console.debug(`${langContext} OpenAI structural event: ${realtimeEvent.type}`, realtimeEvent); // Log only if debugging structure
                  break;
  
              case "response.audio.done": // Renamed event? Check docs
                  console.log(`${langContext} OpenAI Response Audio Done event received.`);
                  // This might signal the end of audio data for a specific response part.
                  break;
  
              default:
                  console.warn(`${langContext} Unhandled OpenAI message type: ${realtimeEvent.type}`, realtimeEvent);
          }
  
      } catch (error) {
          console.error(`${langContext} Error parsing OpenAI message:`, error, "Raw data:", e.data);
      }
  }
  
 
  
  
  /**
  * Create and set up an OpenAI connection for a specific language
  */
  async function setupOpenAIConnection(
    language: string,
    setTranslation: (translation: string) => void,
    setAttendees: (attendees: string[]) => void, // Add setAttendees parameter
    tourId: string
  ): Promise<OpenAIConnection | null> { // Allow null return on failure
    const langContext = `[${language}]`;
    console.log(`${langContext} Setting up OpenAI connection...`);
  
    const renewalTimers = new Map<string, number>(); // Local scope is fine here
  
    let ephemeralKeyExpiryTime: number | null = null;
    let EPHEMERAL_KEY: string | null = null; // Allow null initially
  
    let retryCount = 0;
    const MAX_RETRIES = 5;
  
    async function renewEphemeralKey(): Promise<void> { // Removed language param, uses outer scope
        console.log(`${langContext} Renewing ephemeral key...`);
        try {
            const newKeyData = await fetchEphemeralKey(); // Fetches key and sets expiry
            console.log(`${langContext} New ephemeral key fetched, expires at ${new Date(ephemeralKeyExpiryTime!).toISOString()}`);
            EPHEMERAL_KEY = newKeyData.key;
  
            // Reinitialize connection ONLY IF IT EXISTS AND IS PROBLEMATIC
            // Often, just updating the key might be enough if the underlying connection is okay,
            // but OpenAI's model suggests re-establishing.
            const existingConn = openaiConnections.get(language);
            if (existingConn) {
                console.warn(`${langContext} Reinitializing connection due to key renewal.`);
                try {
                    await sendClosingMessage(language); // Attempt graceful close
                    existingConn.pc.close();
                    // existingConn.dc.close(); // Closing PC often closes DC
                    openaiConnections.delete(language); // Remove old connection
                    // Re-initiate the whole process
                    // Note: This recursive call structure can be complex. Consider alternatives if issues arise.
                     await initGuideWebRTC(setTranslation, language, setAttendees, tourId);
                } catch (reinitError) {
                    console.error(`${langContext} Error during reinitialization after key renewal:`, reinitError);
                    // Attempt to clean up partially closed resources
                    if (openaiConnections.has(language)) {
                        openaiConnections.get(language)?.pc.close();
                        openaiConnections.delete(language);
                    }
                }
            } else {
                console.log(`${langContext} No existing connection found, key renewed for potential future connection.`);
            }
  
  
            retryCount = 0; // Reset retry count on successful renewal
            scheduleKeyRenewal(); // Schedule the next renewal
        } catch (error) {
            console.error(`${langContext} Failed to renew ephemeral key:`, error);
            retryCount++;
            if (retryCount < MAX_RETRIES) {
                const delay = Math.min(30000, 1000 * Math.pow(2, retryCount)); // Exponential backoff up to 30s
                console.log(`${langContext} Retrying key renewal in ${delay / 1000} seconds...`);
                setTimeout(renewEphemeralKey, delay);
            } else {
                console.error(`${langContext} Max retries reached for key renewal. Connection may fail.`);
                // Potentially trigger a UI error state for the guide
            }
        }
    }
  
    async function fetchEphemeralKey(): Promise<{ key: string; expires: number }> {
        console.log(`${langContext} Fetching ephemeral key...`);
        const response = await fetch("/api/session", { credentials: "include" });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`${langContext} Failed to fetch ephemeral key: ${response.status} ${response.statusText}`, errorText);
            throw new Error(`Failed to fetch ephemeral key: ${response.statusText}`);
        }
        const data = await response.json();
        if (!data.client_secret || !data.client_secret.value) {
            console.error(`${langContext} Invalid session data received:`, data);
            throw new Error("Invalid session data: Missing client_secret.value");
        }
  
        const key = data.client_secret.value;
        // Assume key is valid for 60 seconds from fetch time
        ephemeralKeyExpiryTime = Date.now() + 60000;
  
        console.log(`${langContext} Ephemeral key obtained, expires approx: ${new Date(ephemeralKeyExpiryTime).toISOString()}`);
        return { key: key, expires: ephemeralKeyExpiryTime };
    }
  
  
    try {
        const keyData = await fetchEphemeralKey();
        EPHEMERAL_KEY = keyData.key;
        scheduleKeyRenewal(); // Schedule the first renewal
    } catch (error) {
        console.error(`${langContext} Initial ephemeral key fetch failed:`, error);
        // Consider if we should stop the setup here or retry
        return null; // Indicate failure to set up
    }
  


    function scheduleKeyRenewal() { // Removed language param
        const existingTimer = renewalTimers.get(language);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
  
        if (!ephemeralKeyExpiryTime) {
            console.error(`${langContext} Cannot schedule key renewal: Expiry time not set.`);
            return;
        }
  
        const now = Date.now();
        const timeUntilExpiry = ephemeralKeyExpiryTime - now;
  
        if (timeUntilExpiry <= 10000) { // If less than 10 seconds remain
            console.warn(`${langContext} Key expiry imminent (${(timeUntilExpiry / 1000).toFixed(1)}s). Renewing immediately.`);
            // Don't wait, renew now asynchronously
             renewEphemeralKey().catch(err => console.error(`${langContext} Immediate renewal failed:`, err));
             // Still schedule a safety net renewal slightly later in case immediate fails
             const safetyDelay = 15000; // 15 seconds from now
             const timerId = window.setTimeout(renewEphemeralKey, safetyDelay);
             renewalTimers.set(language, timerId);
             console.log(`${langContext} Scheduled safety net key renewal in ${safetyDelay / 1000}s.`);
  
        } else {
            // Renew 15 seconds before expiry for a buffer
            const renewalDelay = Math.max(1000, timeUntilExpiry - 15000); // Ensure at least 1s delay
            const timerId = window.setTimeout(renewEphemeralKey, renewalDelay);
            renewalTimers.set(language, timerId);
            console.log(`${langContext} Scheduled key renewal in ${(renewalDelay / 1000).toFixed(1)} seconds (approx. 15s before expiry).`);
        }
    }
  
    


    // --- Peer Connection Setup ---
const config: RTCConfiguration = {
    iceTransportPolicy: 'all', // Start with 'all', fallback to 'relay' if needed
    iceServers: [
      // Keep your TURN servers (critical for reliability)
      {
        urls: 'turn:192.168.245.82:3478',
        username: 'username1',
        credential: 'password1'
      },
    //  {
    //    urls: 'turns:192.168.245.82:443',
    //    username: 'username1',
    //    credential: 'password1'
    //  },
      // Expanded STUN servers
      ...[
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
        'stun:stun.voipbuster.com:3478',
        'stun:stun.voipstunt.com:3478',
        'stun:stun.xten.com:3478',
        'stun:stun.sipgate.net:3478',
        'stun:stun.rixtelecom.se:3478',
        'stun:stun.schlund.de:3478',
        'stun:stun.stunprotocol.org:3478'
      ].map(url => ({ urls: url }))
    ],
    iceCandidatePoolSize: 5,
  //  bundlePolicy: 'max-bundle',
  //  rtcpMuxPolicy: 'require',
  //  sdpSemantics: 'unified-plan'
  };
  
  const openaiPC = new RTCPeerConnection(config);

  // Enhanced logging (keep this)
    openaiPC.oniceconnectionstatechange = () => {
    console.log(`${langContext} ICE Connection State: ${openaiPC.iceConnectionState}`);
    if (openaiPC.iceConnectionState === 'failed') {
        console.warn(`${langContext} ICE connection failed, attempting recovery...`);
        reconnect(setTranslation, language, setAttendees, tourId)
        .catch(err => console.error(`${langContext} Reconnect failed:`, err));
    }
    };
        
    
    // Logging connection states


    openaiPC.onicecandidate = (event) => {
        if (event.candidate) {

            //Additional Turn server logs
            console.log('ICE Candidate:', {
                type: event.candidate.type,
                protocol: event.candidate.protocol,
                address: event.candidate.address,
                port: event.candidate.port,
                candidate: event.candidate.candidate
              });

          //   console.log(`${langContext} OpenAI ICE Candidate: Type=${event.candidate.type} Protocol=${event.candidate.protocol} Addr=${event.candidate.address}`); // Less verbose logging
            if (event.candidate.candidate.includes('relay')) {
                console.log(`${langContext} TURN server used for OpenAI connection.`);
            }
        } else {
          //   console.log(`${langContext} OpenAI ICE Gathering Complete.`); // Can be noisy
        }
    };
    openaiPC.onicegatheringstatechange = () => {
      //   console.log(`${langContext} OpenAI ICE Gathering State: ${openaiPC.iceGatheringState}`);
    };
    openaiPC.oniceconnectionstatechange = () => {
        console.log(`${langContext} OpenAI ICE Connection State: ${openaiPC.iceConnectionState}`);
        switch (openaiPC.iceConnectionState) {
              case "checking":
              case "connected":
              case "completed":
                   // Normal states, potentially reset retry counters if reconnecting
                   break;
              case "disconnected":
                   console.warn(`${langContext} OpenAI ICE Disconnected. May auto-recover.`);
                   // Start a timer to check if it recovers or moves to 'failed'
                   break;
              case "failed":
                   console.error(`${langContext} OpenAI ICE Failed. Attempting reconnect.`);
                   // Trigger immediate reconnect attempt
                   reconnect(setTranslation, language, setAttendees, tourId).catch(err => console.error(`${langContext} Reconnect attempt failed:`, err));
                   break;
              case "closed":
                  console.log(`${langContext} OpenAI ICE Closed.`);
                  // Connection is fully closed, ensure cleanup happens
                  // This might be triggered by calling pc.close() elsewhere
                  break;
        }
    };
    openaiPC.onconnectionstatechange = () => {
        console.log(`${langContext} OpenAI Connection State: ${openaiPC.connectionState}`);
         if (openaiPC.connectionState === "failed") {
              console.error(`${langContext} OpenAI Connection Failed. Attempting reconnect.`);
              reconnect(setTranslation, language, setAttendees, tourId).catch(err => console.error(`${langContext} Reconnect attempt failed:`, err));
         } else if (openaiPC.connectionState === "closed") {
              console.log(`${langContext} OpenAI Connection Closed.`);
              // Remove from active connections if not already done
              if (openaiConnections.has(language)) {
                  console.log(`${langContext} Removing closed OpenAI connection from map.`);
                  openaiConnections.delete(language);
                  // Potentially clear associated renewal timer
                  const timer = renewalTimers.get(language);
                  if(timer) clearTimeout(timer);
                  renewalTimers.delete(language);
              }
         }
    };
  
  
    // --- Media Stream Setup ---
    let micStream: MediaStream | null = null;
    try {
          micStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true, // Recommended for speech
                  // sampleRate: 16000 // Consider specifying if OpenAI prefers/requires it
              }
          });
          console.log(`${langContext} Microphone access granted.`);
    } catch (error) {
          console.error(`${langContext} Failed to get microphone access:`, error);
          openaiPC.close(); // Clean up PC if mic fails
          return null; // Cannot proceed without mic
    }
  
    // Load audio instructions (now allows null if loading fails)
    const audioInstructionsBuffer = await loadAudioInstructions(language);
    let audioInstructionsTrack: MediaStreamTrack | null = null;
  
    // Create track from buffer if loaded successfully
    if (audioInstructionsBuffer) {
      try {
          const audioContext = new AudioContext();
          const decodedBuffer = await audioContext.decodeAudioData(audioInstructionsBuffer);
          const sourceNode = audioContext.createBufferSource();
          sourceNode.buffer = decodedBuffer;
          const destination = audioContext.createMediaStreamDestination();
          sourceNode.connect(destination);
          sourceNode.start(0); // Start playing the buffer into the stream destination
          audioInstructionsTrack = destination.stream.getAudioTracks()[0];
          console.log(`${langContext} Created MediaStreamTrack from audio instructions.`);
  
          // Important: Stop the source node and close the context when done
          // This is tricky as we don't know when the track is *actually* finished sending
          // For short instructions, this might be okay. For longer audio, more robust handling is needed.
          sourceNode.onended = () => {
              console.log(`${langContext} Audio instruction source node ended.`);
              // Disconnect and potentially close context IF the track is truly finished being used.
              // sourceNode.disconnect();
              // audioContext.close(); // Closing context might stop the track abruptly
          };
  
      } catch (error) {
          console.error(`${langContext} Failed to process audio instructions buffer:`, error);
      }
    }
  
    // Add tracks to the peer connection
    // Add instructions track FIRST if it exists
    if (audioInstructionsTrack) {
        console.log(`${langContext} Adding audio instructions track to OpenAI PC.`);
        openaiPC.addTrack(audioInstructionsTrack);
    }
    // Add microphone track
    micStream.getAudioTracks().forEach(track => {
        console.log(`${langContext} Adding microphone audio track to OpenAI PC: ${track.label} (ID: ${track.id})`);
        openaiPC.addTrack(track, micStream!); // Add track associated with the mic stream
    });
  
  
    // --- Data Channel Setup ---
    const openaiDC = openaiPC.createDataChannel("oai-events", { ordered: true });
    console.log(`${langContext} OpenAI data channel created.`);
  
    openaiDC.onopen = async () => {
         };
  
    openaiDC.onmessage = (e) => {
        // Route messages to the shared handler
        handleOpenAIMessage(e, language, setTranslation);
    };
  
    openaiDC.onerror = (event) => {
        // The event object itself might not be very descriptive for 'error'
        console.error(`${langContext} OpenAI data channel error. State: ${openaiDC.readyState}`, event);
        // Consider if reconnect should be triggered here or rely on PC state changes
    };
  
    openaiDC.onclose = () => {
        console.log(`${langContext} OpenAI data channel closed. State: ${openaiDC.readyState}`);
        // Cleanup related resources if necessary, often handled by PC close
    };
  
  
    // --- SDP Offer/Answer Exchange ---
    try {
      console.log(`${langContext} Creating OpenAI offer...`);
      const offer = await openaiPC.createOffer({
          offerToReceiveAudio: true, // We expect audio back from OpenAI
          offerToReceiveVideo: false
      });
  
      if (!offer?.sdp) {
          throw new Error('Failed to create a valid WebRTC offer SDP.');
      }
  
      // SDP Modification (Force sendrecv, prefer Opus) - Essential for OpenAI
      const modifySDP = (sdp: string): string => {
          let modified = sdp;
          // Ensure sendrecv for audio media line
          modified = modified.replace(/a=recvonly/g, 'a=sendrecv');
          modified = modified.replace(/a=inactive/g, 'a=sendrecv'); // Also handle inactive
          // Ensure the audio line itself implies sendrecv if attributes are missing
           if (!/m=audio.*a=sendrecv/.test(modified) && /m=audio/.test(modified)) {
               modified = modified.replace(/(m=audio.*)\r\n/, '$1\r\na=sendrecv\r\n');
           }
          // Optional: Prioritize Opus codec (usually 111, but check capabilities)
          // This part is more complex and browser-dependent, might not be strictly needed if Opus is default
          // modified = modified.replace(/m=audio (\d+) RTP\/SAVPF (.*)/, 'm=audio $1 RTP/SAVPF 111 $2'); // Example, may need refinement
          return modified;
      };
  
      const originalSDP = offer.sdp;
      const modifiedSDP = modifySDP(originalSDP);
  
      if (modifiedSDP !== originalSDP) {
          console.log(`${langContext} SDP modified to ensure sendrecv.`);
          // console.debug("Original SDP:", originalSDP); // Optional debug
          // console.debug("Modified SDP:", modifiedSDP); // Optional debug
          offer.sdp = modifiedSDP;
      } else {
          console.warn(`${langContext} SDP modification did not change the SDP. Ensure it already includes sendrecv.`);
      }
  
  
      console.log(`${langContext} Setting local description with potentially modified offer.`);
      await openaiPC.setLocalDescription(offer);
  
      // Wait for ICE gathering (important!)
      console.log(`${langContext} Waiting for ICE gathering to complete...`);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (openaiPC.iceGatheringState !== 'complete') {
            console.warn('ICE gathering timed out, proceeding with available candidates');
          }
          resolve();
        }, ICE_CONFIG.GATHERING_TIMEOUT);
      
        if (openaiPC.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
          return;
        }
      
        openaiPC.onicegatheringstatechange = () => {
          if (openaiPC.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            resolve();
          }
        };
      });
      

      console.log(`${langContext} ICE gathering complete. Local SDP ready.`);
      // console.debug(`${langContext} Final Local Description SDP:`, openaiPC.localDescription?.sdp); // Optional debug
  
  
      // --- Send Offer to OpenAI API ---
      if (!EPHEMERAL_KEY) {
          throw new Error("Cannot send SDP offer: Ephemeral key is missing.");
      }
      const baseUrl = "https://api.openai.com/v1/realtime"; // Use production URL
      const model = "gpt-4o-realtime-preview-2024-12-17"; // Use your desired model
      const voice = "verse"; // Use desired voice
  
      const apiUrl = `${baseUrl}?model=${model}&voice=${voice}`;
      console.log(`${langContext} Sending SDP offer to OpenAI API: ${apiUrl}`);
  
      const sdpResponse = await fetch(apiUrl, {
          method: "POST",
          body: openaiPC.localDescription?.sdp, // Send the final local SDP
          headers: {
              Authorization: `Bearer ${EPHEMERAL_KEY}`,
              "Content-Type": "application/sdp",
              // Session-Id header might be required by some OpenAI versions/docs
              // "Session-Id": "YOUR_UNIQUE_SESSION_ID_IF_NEEDED",
          },
          credentials: "omit", // API key is in header, don't send cookies
      });
  
      if (!sdpResponse.ok) {
          const errorText = await sdpResponse.text();
          console.error(`${langContext} OpenAI API request failed: ${sdpResponse.status} ${sdpResponse.statusText}`, errorText);
          throw new Error(`OpenAI API request failed: ${sdpResponse.statusText}. Body: ${errorText}`);
      }
      console.log(`${langContext} OpenAI API responded successfully (${sdpResponse.status}).`);
  
      const openaiAnswerSDP = await sdpResponse.text();
      // console.log(`${langContext} Received OpenAI Answer SDP:`, openaiAnswerSDP); // Debugging
  
      if (!openaiAnswerSDP || !openaiAnswerSDP.includes('m=audio')) {
           throw new Error('Invalid Answer SDP received from OpenAI: Missing audio media description.');
      }
      if (!openaiAnswerSDP.includes('a=sendrecv') && !openaiAnswerSDP.includes('a=sendonly')) {
           console.warn(`${langContext} OpenAI answer SDP does not explicitly state sendrecv/sendonly. Assuming compatible based on successful request.`);
           // Proceed cautiously. If audio isn't received, this is a likely cause.
      }
  
  
      console.log(`${langContext} Setting remote description with OpenAI answer.`);
      await openaiPC.setRemoteDescription(new RTCSessionDescription({
          type: "answer",
          sdp: openaiAnswerSDP
      }));



      //Connectivity Checks
      const checkConnection = () => {
        if (openaiPC.iceConnectionState === 'connected') {
          console.log('TURN server connectivity verified');
        } else if (openaiPC.iceConnectionState === 'failed') {
          console.error('Failed to establish TURN connection');
        }
      };
      
      openaiPC.oniceconnectionstatechange = checkConnection;
      checkConnection(); // Initial check


  
      console.log(`${langContext} Remote description set. WebRTC connection established with OpenAI.`);
  
      // Log transceiver states after connection
      console.log(`${langContext} Checking transceivers after connection:`);
      openaiPC.getTransceivers().forEach((t, index) => {
          console.log(`  Transceiver[${index}] (MID: ${t.mid}): Direction=${t.direction}, CurrentDirection=${t.currentDirection}, Kind=${t.receiver?.track?.kind || 'N/A'}`);
      });
  
  
      // --- Setup Track Handling (Crucial Part with Verification) ---
      openaiPC.ontrack = async (e: RTCTrackEvent) => {
        const track = e.track;
        const stream = e.streams[0]; // Usually the first stream
  
        console.log(`${langContext} Received track from OpenAI: Kind=${track.kind}, ID=${track.id}, ReadyState=${track.readyState}, StreamID=${stream?.id}`);
  
        if (track.kind !== 'audio') {
          console.log(`${langContext} Ignoring non-audio track from OpenAI.`);
          return;
        }
  
        // --- Integrate Audio Verification ---
        const { isValid, details } = await verifyOpenAIAudio(stream, language);
  
        if (!isValid) {
            console.error(`${langContext} OpenAI incoming audio stream failed verification. Not processing track ${track.id}.`);
  
            // Check if the failure is due to the track ending prematurely
            if (details.some(d => d.readyState === 'ended')) {
                console.warn(`${langContext} OpenAI track ${details.find(d=>d.readyState === 'ended')?.id} ended prematurely. Triggering reconnect.`);
                // Attempt reconnect if a track ended unexpectedly
                reconnect(setTranslation, language, setAttendees, tourId).catch(err => console.error(`${langContext} Reconnect triggered by ended track failed:`, err));
            } else {
                // Other validation failure (e.g., no tracks, tracks not live/active)
                // May indicate a deeper issue with the connection setup or OpenAI's stream.
                // Consider logging more details or specific error handling.
            }
            return; // Stop processing this track/stream
        }
        // --- Verification Passed ---
        console.log(`${langContext} OpenAI audio track ${track.id} (Stream: ${stream.id}) passed verification. Processing...`);
  
  
        // Proceed with existing logic: Forward to attendees or play for guide
        const connections = attendeeConnectionsByLanguage.get(language);
  
        if (connections && connections.size > 0) {
            // Forward verified audio track to all connected attendees for this language
            console.log(`${langContext} Forwarding verified OpenAI track ${track.id} to ${connections.size} attendees.`);
            let forwardedCount = 0;
            for (const conn of connections) {
                try {
                    // Check if the track is already added to avoid duplicates
                    const sender = conn.pc.getSenders().find(s => s.track === track);
                    if (!sender) {
                        console.log(`${langContext} Adding track ${track.id} to attendee ${conn.id} PC.`);
                        conn.pc.addTrack(track, stream);
                        forwardedCount++;
                    } else {
                        console.log(`${langContext} Track ${track.id} already present on attendee ${conn.id} PC.`);
                    }
                } catch (error) {
                    console.error(`${langContext} Error forwarding track ${track.id} to attendee ${conn.id}:`, error);
                    // Consider removing problematic attendee connection?
                }
            }
             console.log(`${langContext} Finished forwarding track ${track.id} to ${forwardedCount} new attendee connections.`);
        } else {
            // No attendees for this language, play audio locally for the guide
            console.log(`${langContext} No attendees connected for ${language}. Playing verified OpenAI audio locally for guide.`);
            playAudioForGuide(stream, language); // Pass the verified stream
        }
  
        // Optional: Add listener for when this specific track ends
        track.onended = () => {
              console.warn(`${langContext} OpenAI audio track ${track.id} ended.`);
              // Decide if this should trigger a reconnect or just cleanup
              // Maybe remove from attendees? Or rely on overall connection state?
              // If playing locally, clean up the audio element
              if (guideAudioElements.has(language)) {
                  const audioEl = guideAudioElements.get(language);
                  if (audioEl?.srcObject === stream) { // Ensure it's the correct stream
                      console.log(`${langContext} Removing guide audio element as track ${track.id} ended.`);
                      audioEl.pause();
                      audioEl.srcObject = null;
                      audioEl.remove();
                      guideAudioElements.delete(language);
                  }
              }
        };
      }; // End of ontrack handler
  
      // Return the successful connection details
      return { pc: openaiPC, dc: openaiDC };
  
    } catch (error) {
        console.error(`${langContext} Error during OpenAI WebRTC setup (Offer/Answer/API):`, error);
        // Cleanup partially created resources
        if (openaiPC.connectionState !== 'closed') {
           openaiPC.close();
        }
        const timer = renewalTimers.get(language);
        if(timer) clearTimeout(timer);
        renewalTimers.delete(language);
        // Don't re-throw here, allow setupOpenAIConnection to return null
        return null; // Indicate failure
    }
  }
  
  /**
  * Create and set up a new attendee connection structure (offer stored in Redis).
  * This function *prepares* for an attendee, it doesn't establish the full connection yet.
  */
  async function createAttendeeOffer( // Renamed for clarity
    language: string,
    tourId: string
    // Removed openaiConnection param as it's not directly needed here
  ): Promise<RTCSessionDescriptionInit | null> { // Return the offer or null on failure
    const langContext = `[${language}]`;
    console.log(`${langContext} Preparing attendee offer structure...`);
  
    // Create a temporary peer connection *just* to generate the offer.
    // This PC will NOT be used for the actual connection.
    const tempPC = new RTCPeerConnection({
        iceServers: [ // Use the same ICE servers as real connections
            { urls: 'turn:192.168.245.82:3478', username: 'username1', credential: 'password1' },
            { urls: 'turns:192.168.245.82:443', username: 'username1', credential: 'password1' },
            { urls: "stun:stun.l.google.com:19302" },
            // Add others...
        ],
    });
  
    try {
          // Add a data channel placeholder (attendee will connect to this)
          tempPC.createDataChannel("translations", { ordered: true }); // Match attendee DC name
  
          // Add a placeholder audio transceiver (important for the offer)
          // We expect to receive audio from the guide (via OpenAI forwarding)
          tempPC.addTransceiver('audio', { direction: 'recvonly' });
          // We might send text/control messages, but typically not audio *to* the guide here
          // tempPC.addTransceiver('video', { direction: 'inactive' }); // If video were ever needed
  
          console.log(`${langContext} Creating attendee offer...`);
          const attendeeOffer = await tempPC.createOffer();
  
          // Optional: Modify SDP if needed (e.g., prefer codecs), but usually less critical than OpenAI side
          // await tempPC.setLocalDescription(attendeeOffer); // Not strictly needed just for generating offer
  
          console.log(`${langContext} Attendee offer created successfully.`);
          // console.debug(`${langContext} Attendee Offer SDP:`, attendeeOffer.sdp); // Optional debug
  
  
          // --- Store the offer in Redis via API ---
          const offerData = {
              language,
              tourId,
              offer: attendeeOffer, // Send the RTCSessionDescriptionInit object
          };
  
          console.log(`${langContext} Storing attendee offer via API for tour ${tourId}...`);
          const tourResponse = await fetch("/api/tour/offer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(offerData),
              credentials: "include"
          });
  
          if (!tourResponse.ok) {
              const errorText = await tourResponse.text();
              console.error(`${langContext} Failed to store attendee offer: ${tourResponse.status} ${tourResponse.statusText}`, errorText);
              throw new Error(`Failed to store attendee offer: ${tourResponse.statusText}`);
          }
  
          console.log(`${langContext} Attendee offer stored successfully via API.`);
          return attendeeOffer; // Return the generated offer
  
      } catch (error) {
          console.error(`${langContext} Error creating or storing attendee offer:`, error);
          return null; // Indicate failure
      } finally {
          // Clean up the temporary peer connection
          tempPC.close();
           console.log(`${langContext} Closed temporary PC used for offer generation.`);
      }
  }
  
  /**
  * Polls the backend for answers from new attendees and establishes their connections.
  */
  async function pollForAttendeeAnswers(
    language: string,
    tourId: string,
    setAttendees: (attendees: string[]) => void
  ): Promise<void> {
    const langContext = `[${language}]`;
    // console.log(`${langContext} Polling for new attendee answers...`); // Reduce log noise
  
    try {
        const answersResponse = await fetch(
            // Ensure URL encoding for language and tourId
            `/api/tour/answer?language=${encodeURIComponent(language)}&tourId=${encodeURIComponent(tourId)}`,
            {
                method: "GET",
                credentials: "include", // Important for session/auth
                headers: { // Prevent caching of poll requests
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            }
        );
  
        if (!answersResponse.ok) {
            // Gracefully handle expected errors like 404 (no answers yet) vs server errors
            if (answersResponse.status === 404) {
              //   console.log(`${langContext} No new attendee answers found (404).`);
                return; // Normal case, no answers to process
            }
            const errorText = await answersResponse.text();
            console.error(`${langContext} Failed to poll for answers: ${answersResponse.status} ${answersResponse.statusText}`, errorText);
            // Consider backoff or temporary pause in polling on repeated server errors (e.g., 5xx)
            return;
        }
  
        const answersData = await answersResponse.json();
  
        if (!answersData || !Array.isArray(answersData.answers) || answersData.answers.length === 0) {
          //   console.log(`${langContext} Poll response received, but no new answers in data.`);
            return; // No new answers in the payload
        }
  
        console.log(`${langContext} Received ${answersData.answers.length} new answer(s) from attendees.`);
  
        // Process each new answer
        for (const { attendeeId, answer } of answersData.answers) {
            if (!attendeeId || !answer || !answer.sdp || answer.type !== 'answer') {
                 console.warn(`${langContext} Skipping invalid answer data received:`, { attendeeId, answer });
                 continue;
             }
  
             console.log(`${langContext} Processing answer from new attendee: ${attendeeId}`);
  
            // Check if we are *already* connected to this attendee (e.g., due to race condition or previous attempt)
            const existingConnections = attendeeConnectionsByLanguage.get(language);
            if (existingConnections && Array.from(existingConnections).some(conn => conn.id === attendeeId)) {
                console.log(`${langContext} Already have a connection for attendee ${attendeeId}. Skipping duplicate answer processing.`);
                continue; // Avoid creating duplicate connections
            }
  
            // --- Create the actual PeerConnection for this new attendee ---
            console.log(`${langContext} Creating new RTCPeerConnection for attendee ${attendeeId}...`);
            const attendeePC = new RTCPeerConnection({
                iceServers: [ // Use consistent ICE server config
                    { urls: 'turn:192.168.245.82:3478', username: 'username1', credential: 'password1' },
                //    { urls: 'turns:192.168.245.82:443', username: 'username1', credential: 'password1' },
                    { urls: "stun:stun.l.google.com:19302" },
                    // ... other servers
                ],
            });
  
            let attendeeDC: RTCDataChannel | null = null; // Will be set by ondatachannel
            const attendeeConnection: AttendeeConnection = { id: attendeeId, pc: attendeePC, dc: null! }; // Temporarily null DC
  
  
            // --- Set up Attendee PC Event Handlers ---
  
            attendeePC.onicecandidate = async (event) => {
                if (event.candidate) {
                     console.log(`${langContext} Sending ICE candidate for attendee ${attendeeId} to server...`);
                     try {
                          // Use the API endpoint dedicated to receiving *guide's* candidates for an attendee
                          const iceResponse = await fetch("/api/tour/ice-candidate", { // Assuming this endpoint handles guide -> attendee candidates
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                  language,
                                  tourId,
                                  attendeeId, // Identify target attendee
                                  candidate: event.candidate,
                                  sender: 'guide' // Indicate sender
                              }),
                              credentials: "include"
                          });
                          if (!iceResponse.ok) {
                              console.error(`${langContext} Failed to send ICE candidate for attendee ${attendeeId}: ${iceResponse.status} ${iceResponse.statusText}`);
                          }
                     } catch (error) {
                         console.error(`${langContext} Error sending ICE candidate for attendee ${attendeeId}:`, error);
                     }
                }
            };
  
            attendeePC.oniceconnectionstatechange = () => {
                console.log(`${langContext} Attendee ${attendeeId} ICE Connection State: ${attendeePC.iceConnectionState}`);
                if (attendeePC.iceConnectionState === 'failed' || attendeePC.iceConnectionState === 'disconnected' || attendeePC.iceConnectionState === 'closed') {
                    console.warn(`${langContext} Attendee ${attendeeId} connection issue (${attendeePC.iceConnectionState}). Cleaning up.`);
                    // Clean up this specific attendee connection
                    cleanupAttendeeConnection(language, attendeeId, setAttendees);
                }
            };
             attendeePC.onconnectionstatechange = () => {
                 console.log(`${langContext} Attendee ${attendeeId} Connection State: ${attendeePC.connectionState}`);
                 if (attendeePC.connectionState === 'failed' || attendeePC.connectionState === 'closed') {
                     console.warn(`${langContext} Attendee ${attendeeId} connection state ${attendeePC.connectionState}. Cleaning up.`);
                     cleanupAttendeeConnection(language, attendeeId, setAttendees);
                 } else if (attendeePC.connectionState === 'connected') {
                     console.log(`${langContext} Attendee ${attendeeId} successfully connected.`);
                     // Potentially send a welcome message or initial state
                     if (attendeeConnection.dc && attendeeConnection.dc.readyState === 'open') {
                         sendThroughDataChannel(attendeeConnection.dc, 'status', { connected: true, language: language });
                     }
                 }
             };
  
  
             // --- Handle Data Channel from Attendee ---
              attendeePC.ondatachannel = (event) => {
                  console.log(`${langContext} Received data channel '${event.channel.label}' from attendee ${attendeeId}.`);
                  const dc = event.channel;
  
                  if (dc.label !== 'translations') { // Expect specific channel name
                       console.warn(`${langContext} Unexpected data channel label from ${attendeeId}: ${dc.label}. Closing it.`);
                       dc.close();
                       return;
                  }
  
                  attendeeDC = dc; // Assign the received data channel
                  attendeeConnection.dc = dc; // Update the connection object reference
  
                  dc.onopen = () => {
                      console.log(`${langContext} Data channel to attendee ${attendeeId} opened.`);
                      // Now safe to send messages
                      sendThroughDataChannel(dc, 'status', { connected: true, language: language });
                      // Forward current translation state if available?
                  };
                  dc.onmessage = (msgEvent) => {
                      console.log(`${langContext} Message from attendee ${attendeeId}:`, msgEvent.data);
                      // Handle messages FROM attendee (e.g., requests, acknowledgements)
                      // Currently, attendees mainly receive, but this handler is ready.
                  };
                  dc.onerror = (err) => {
                      console.error(`${langContext} Data channel error with attendee ${attendeeId}:`, err);
                  };
                  dc.onclose = () => {
                      console.log(`${langContext} Data channel to attendee ${attendeeId} closed.`);
                       // Trigger cleanup if the DC closes unexpectedly
                       cleanupAttendeeConnection(language, attendeeId, setAttendees);
                  };
              };
  
  
               // --- Add Attendee to Tracking Maps ---
               if (!attendeeConnectionsByLanguage.has(language)) {
                  attendeeConnectionsByLanguage.set(language, new Set());
              }
              attendeeConnectionsByLanguage.get(language)!.add(attendeeConnection);
              allAttendees.set(attendeeId, language);
              console.log(`${langContext} Added attendee ${attendeeId} to tracking maps.`);
              updateAttendeesList(setAttendees); // Update UI
  
              // --- Set Remote Description (The Attendee's Answer) ---
               try {
                  console.log(`${langContext} Setting remote description (answer) for attendee ${attendeeId}...`);
                  await attendeePC.setRemoteDescription(new RTCSessionDescription(answer)); // Use the received answer
                  console.log(`${langContext} Remote description set for attendee ${attendeeId}.`);
  
                                // --- Forward Existing/Future OpenAI Tracks ---
               const openaiConn = openaiConnections.get(language);
               if (openaiConn?.pc) {
                  console.log(`${langContext} Adding existing tracks RECEIVED from OpenAI to new attendee ${attendeeId}...`);

                  // Iterate through RECEIVERS on the OpenAI connection
                  openaiConn.pc.getReceivers().forEach(receiver => {
                      // Check if the receiver actually has a track and it's audio
                      if (receiver.track && receiver.track.kind === 'audio') {
                          const trackToForward = receiver.track;
                          console.log(`${langContext} Found existing received track ${trackToForward.id} (Kind: ${trackToForward.kind}, State: ${trackToForward.readyState}) to forward.`);

                          // Check if track is still live before forwarding
                          if (trackToForward.readyState === 'live') {
                              try {
                                  // Check if this track (by ID) is already being sent to the attendee
                                  const existingSender = attendeePC.getSenders().find(s => s.track?.id === trackToForward.id);

                                  if (!existingSender) {
                                        console.log(`${langContext} Adding track ${trackToForward.id} to attendee ${attendeeId} PC.`);
                                        // Add just the track. The associated stream is often optional for the receiver.
                                        attendeePC.addTrack(trackToForward);
                                  } else {
                                       console.log(`${langContext} Track ${trackToForward.id} is already being sent to attendee ${attendeeId}. Skipping addTrack.`);
                                  }

                              } catch (addTrackError) {
                                  console.error(`${langContext} Error adding existing track ${trackToForward.id} to attendee ${attendeeId}:`, addTrackError);
                              }
                          } else {
                               console.warn(`${langContext} Skipping forwarding track ${trackToForward.id} because its readyState is '${trackToForward.readyState}'.`);
                          }
                      }
                  });
               } else {
                   console.warn(`${langContext} OpenAI connection not ready when attendee ${attendeeId} joined. Tracks will be added via 'ontrack' later.`);
               }


                   // --- Poll for Attendee's ICE Candidates ---
                   // Start polling *specifically* for this attendee's candidates after setting remote desc
                   pollForAttendeeIceCandidates(language, tourId, attendeeId, attendeePC);
  
  
               } catch (error) {
                   console.error(`${langContext} Error setting remote description or processing connection for attendee ${attendeeId}:`, error);
                   cleanupAttendeeConnection(language, attendeeId, setAttendees); // Clean up failed connection attempt
               }
        } // End loop processing answersData.answers
  
    } catch (error) {
        // Log errors related to the fetch/parsing itself
        if (error instanceof SyntaxError) {
            console.error(`${langContext} Error parsing JSON response from answer poll:`, error);
        } else {
            console.error(`${langContext} Unexpected error during attendee answer polling:`, error);
        }
        // Optional: Implement backoff for polling mechanism on persistent errors
    }
  }
  
  
  /**
   * Polls for and adds ICE candidates sent *by* a specific attendee *to* the guide.
   */
  async function pollForAttendeeIceCandidates(
      language: string,
      tourId: string,
      attendeeId: string,
      attendeePC: RTCPeerConnection // The specific PC for this attendee
  ): Promise<void> {
      const langContext = `[${language}]`;
      const pollInterval = 3000; // Poll every 3 seconds
      let pollTimer: number | null = null;
  
      const pollAction = async () => {
          // Stop polling if the connection is closed or failed
          if (!attendeePC || attendeePC.connectionState === 'closed' || attendeePC.connectionState === 'failed') {
              console.log(`${langContext} Stopping ICE candidate polling for disconnected attendee ${attendeeId}.`);
              if (pollTimer) clearTimeout(pollTimer);
              return;
          }
  
          // console.log(`${langContext} Polling for ICE candidates from attendee ${attendeeId}...`); // Reduce noise
  
          try {
              // Use the specific API endpoint for getting candidates *from* an attendee
              const iceResponse = await fetch(
                  `/api/tour/attendee-ice?language=${encodeURIComponent(language)}&attendeeId=${encodeURIComponent(attendeeId)}&tourId=${encodeURIComponent(tourId)}&sender=attendee`, // Specify sender=attendee
                  {
                      method: 'GET',
                      credentials: 'include',
                      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
                  }
              );
  
              if (iceResponse.status === 404) {
                  // console.log(`${langContext} No new ICE candidates from attendee ${attendeeId} (404).`);
              } else if (!iceResponse.ok) {
                  console.error(`${langContext} Failed to poll for ICE candidates from ${attendeeId}: ${iceResponse.status} ${iceResponse.statusText}`);
                  // Consider stopping polling on persistent errors?
              } else {
                  const iceData = await iceResponse.json();
                  if (iceData && Array.isArray(iceData.candidates) && iceData.candidates.length > 0) {
                      console.log(`${langContext} Received ${iceData.candidates.length} ICE candidate(s) from attendee ${attendeeId}.`);
                      for (const candidate of iceData.candidates) {
                          if (candidate && candidate.candidate && candidate.sdpMid != null && candidate.sdpMLineIndex != null) {
                               try {
                                  // console.log(`${langContext} Adding ICE candidate from ${attendeeId}:`, candidate); // Debugging
                                  await attendeePC.addIceCandidate(new RTCIceCandidate(candidate));
                               } catch (addIceError) {
                                   // Ignore errors for candidates that can't be added (e.g., duplicates, outdated)
                                   if (addIceError instanceof Error && addIceError.message.includes("OperationError")) {
                                        // console.warn(`${langContext} Ignoring benign error adding ICE candidate from ${attendeeId}:`, addIceError.message);
                                   } else {
                                        console.error(`${langContext} Error adding ICE candidate from ${attendeeId}:`, addIceError, "Candidate:", candidate);
                                   }
                               }
                          } else {
                              console.warn(`${langContext} Skipping invalid ICE candidate structure received from attendee ${attendeeId}:`, candidate);
                          }
                      }
                  }
              }
          } catch (error) {
              console.error(`${langContext} Error during ICE candidate polling for ${attendeeId}:`, error);
           
          } finally {
              // Schedule the next poll if the connection is in a state where it might still proceed or recover
              const currentState = attendeePC.connectionState;
              if (currentState === 'new' ||
                  currentState === 'connecting' ||
                  currentState === 'connected' ||
                  currentState === 'disconnected') // Poll even if disconnected, as it might recover
              {
                   // console.log(`${langContext} Scheduling next ICE poll for ${attendeeId} (State: ${currentState})`); // Optional debug
                   pollTimer = window.setTimeout(pollAction, pollInterval);
              } else {
                   console.log(`${langContext} NOT scheduling next ICE poll for ${attendeeId} (State: ${currentState})`);
                   // Clear timer just in case (though it shouldn't be set if we reach here)
                   if (pollTimer) clearTimeout(pollTimer);
              }
          }
      };
  
      // Start the first poll
      pollAction();
  }
  
  
  /**
   * Cleans up resources associated with a specific attendee connection.
   */
  function cleanupAttendeeConnection(language: string, attendeeId: string, setAttendees: (attendees: string[]) => void) {
      const langContext = `[${language}]`;
      console.log(`${langContext} Cleaning up connection for attendee ${attendeeId}...`);
  
      const connections = attendeeConnectionsByLanguage.get(language);
      if (connections) {
          const connection = Array.from(connections).find(conn => conn.id === attendeeId);
          if (connection) {
              // Close PC and DC
              if (connection.dc && connection.dc.readyState !== 'closed') {
                  connection.dc.close();
              }
              if (connection.pc && connection.pc.connectionState !== 'closed') {
                  connection.pc.close();
              }
  
              // Remove from tracking maps
              connections.delete(connection);
              if (connections.size === 0) {
                  attendeeConnectionsByLanguage.delete(language); // Clean up language set if empty
              }
              allAttendees.delete(attendeeId);
  
              console.log(`${langContext} Attendee ${attendeeId} removed from tracking.`);
  
              // Update UI
              updateAttendeesList(setAttendees);
  
          } else {
              console.log(`${langContext} Attendee ${attendeeId} not found in active connections for cleanup.`);
          }
      } else {
           console.log(`${langContext} No connection set found for language during cleanup of attendee ${attendeeId}.`);
      }
  
       // Optional: Send notification to backend that attendee disconnected?
       // fetch(`/api/tour/disconnect?attendeeId=${attendeeId}&tourId=${tourId}`, { method: 'POST', credentials: 'include' });
  }
  
  
  /**
  * Main function to initialize the guide's WebRTC connections for a specific language.
  */
  export async function initGuideWebRTC(
      setTranslation: (translation: string) => void,
      language: string,
      setAttendees: (attendees: string[]) => void,
      tourId: string
  ): Promise<void> { // Return void, errors are logged internally
      const langContext = `[${language}]`;
      try {
          console.log(`\n=== ${langContext} INITIALIZING GUIDE WEBRTC FOR LANGUAGE: ${language} ===`);
  
          // Avoid reinitializing if a connection is already active or pending
          if (openaiConnections.has(language)) {
              const existingConn = openaiConnections.get(language)!;
              console.warn(`${langContext} WebRTC connection already exists or is initializing (State: ${existingConn.pc?.connectionState ?? 'pending'}). Aborting duplicate initialization.`);
              return;
          }
  
          // --- Phase 1: Set up OpenAI Connection ---
          console.log(`${langContext} Phase 1: Setting up OpenAI connection...`);
          const openaiConnection = await setupOpenAIConnection(language, setTranslation, setAttendees, tourId);
  
          if (!openaiConnection) {
              console.error(`${langContext} CRITICAL: Failed to establish OpenAI connection. Cannot proceed for this language.`);
              // Cleanup potentially half-created resources if setupOpenAIConnection didn't already
              if (openaiConnections.has(language)) {
                  openaiConnections.get(language)?.pc.close();
                  openaiConnections.delete(language);
              }
              // Maybe notify UI?
              return; // Stop initialization for this language
          }
          openaiConnections.set(language, openaiConnection);
          console.log(`${langContext} Phase 1: OpenAI connection setup successful.`);
  
  
          // --- Phase 2: Prepare for Attendees ---
          console.log(`${langContext} Phase 2: Creating and storing initial attendee offer...`);
          // Initialize the language group in attendee tracking maps *before* creating offer
          if (!attendeeConnectionsByLanguage.has(language)) {
              attendeeConnectionsByLanguage.set(language, new Set());
          }
          const initialOffer = await createAttendeeOffer(language, tourId);
          if (!initialOffer) {
               console.error(`${langContext} CRITICAL: Failed to create or store the initial attendee offer. New attendees may not be able to join.`);
               // The OpenAI connection might still work, but attendee joining is broken. Decide whether to proceed.
               // For now, we proceed but log the error prominently.
          } else {
               console.log(`${langContext} Phase 2: Initial attendee offer created and stored.`);
          }
  
  
          // --- Phase 3: Start Polling for Attendee Answers ---
          console.log(`${langContext} Phase 3: Starting polling for attendee answers (every 5s)...`);
          // Clear any previous interval for this language (safety measure)
          const existingInterval = connectionIntervals.get(language);
          if (existingInterval) clearInterval(existingInterval);
  
          // Start polling immediately once, then set interval
          pollForAttendeeAnswers(language, tourId, setAttendees).catch(err => console.error(`${langContext} Initial poll failed:`, err));
  
          const pollTimerId = window.setInterval(() => {
              // Check if OpenAI connection is still valid before polling
              const currentOpenAIConn = openaiConnections.get(language);
              if (!currentOpenAIConn || currentOpenAIConn.pc.connectionState === 'closed' || currentOpenAIConn.pc.connectionState === 'failed') {
                  console.warn(`${langContext} Stopping attendee polling because OpenAI connection is closed or failed.`);
                  clearInterval(pollTimerId);
                  connectionIntervals.delete(language);
                  return;
              }
              pollForAttendeeAnswers(language, tourId, setAttendees).catch(err => console.error(`${langContext} Error during scheduled poll:`, err));
          }, 5000); // Poll every 5 seconds
  
          connectionIntervals.set(language, pollTimerId); // Store interval ID
  
  
          console.log(`=== ${langContext} GUIDE WEBRTC INITIALIZATION COMPLETE ===\n`);
  
      } catch (error) {
          // Catch any unexpected errors during the init sequence
          console.error(`${langContext} CRITICAL ERROR during initGuideWebRTC:`, error);
          // Attempt cleanup
          cleanupGuideWebRTCForLanguage(language, setAttendees); // Cleanup specific language
          // Re-throw or notify UI?
          // throw error; // Optional: re-throw if calling code needs to know about failure
      }
  }
  
  // Map to store polling interval IDs per language
  const connectionIntervals = new Map<string, number>();
  
  
  /**
  * Reconnect logic for a specific language.
  */
  async function reconnect(
      setTranslation: (translation: string) => void,
      language: string,
      setAttendees: (attendees: string[]) => void,
      tourId: string
  ): Promise<void> {
      const langContext = `[${language}]`;
      console.warn(`${langContext} Attempting to reconnect WebRTC...`);
  
      // Prevent multiple concurrent reconnect attempts for the same language
      if (reconnectStatus.get(language)) {
          console.log(`${langContext} Reconnect already in progress. Skipping.`);
          return;
      }
      reconnectStatus.set(language, true);
  
      let success = false;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          console.log(`${langContext} Reconnect attempt ${attempt}/${maxAttempts}...`);
          try {
              // 1. Cleanup existing resources for this language thoroughly
              await cleanupGuideWebRTCForLanguage(language, setAttendees);
  
              // 2. Wait before retrying (exponential backoff)
              const delay = Math.min(10000, 1000 * Math.pow(2, attempt -1)); // 1s, 2s, 4s, max 10s
              console.log(`${langContext} Waiting ${delay / 1000}s before re-initializing...`);
              await new Promise(resolve => setTimeout(resolve, delay));
  
              // 3. Re-initialize
              console.log(`${langContext} Re-initializing WebRTC...`);
              await initGuideWebRTC(setTranslation, language, setAttendees, tourId);
  
              // 4. Check if connection succeeded (basic check, might need refinement)
              const newConn = openaiConnections.get(language);
              if (newConn && (newConn.pc.connectionState === 'connected' || newConn.pc.connectionState === 'connecting')) {
                   console.log(`${langContext} Reconnect attempt ${attempt} appears successful (Connection state: ${newConn.pc.connectionState}).`);
                   success = true;
                   break; // Exit loop on success
               } else {
                   console.warn(`${langContext} Reconnect attempt ${attempt} finished, but connection state is ${newConn?.pc?.connectionState ?? 'not found'}. Retrying if possible.`);
               }
  
          } catch (error) {
              console.error(`${langContext} Reconnect attempt ${attempt} failed:`, error);
              // Continue to next attempt if possible
          }
      }
  
      if (!success) {
          console.error(`${langContext} Reconnect failed after ${maxAttempts} attempts. Giving up.`);
          // Notify UI or take other actions as needed
      }
  
      reconnectStatus.delete(language); // Allow future reconnects
  }
  
  // Helper to track reconnect attempts status
  const reconnectStatus = new Map<string, boolean>();
  
  
  /**
   * Cleans up all WebRTC resources for a specific language.
   */
  async function cleanupGuideWebRTCForLanguage(language: string, setAttendees: (attendees: string[]) => void) {
      const langContext = `[${language}]`;
      console.log(`${langContext} Cleaning up WebRTC resources for language: ${language}`);
  
       // Clear polling interval
      const intervalId = connectionIntervals.get(language);
      if (intervalId) {
          clearInterval(intervalId);
          connectionIntervals.delete(language);
          console.log(`${langContext} Cleared attendee polling interval.`);
      }
  
       // Clear key renewal timer
      const renewalTimerId = renewalTimers.get(language);
      if (renewalTimerId) {
          clearTimeout(renewalTimerId);
          renewalTimers.delete(language);
          console.log(`${langContext} Cleared key renewal timer.`);
      }
  
      // Clean up guide audio element
      if (guideAudioElements.has(language)) {
          const audioEl = guideAudioElements.get(language)!;
          console.log(`${langContext} Removing guide audio element.`);
          audioEl.pause();
          audioEl.srcObject = null;
          audioEl.remove();
          guideAudioElements.delete(language);
      }
  
      // Close OpenAI connection
      const openaiConn = openaiConnections.get(language);
      if (openaiConn) {
          await sendClosingMessage(language); // Attempt graceful close first
          console.log(`${langContext} Closing OpenAI PeerConnection.`);
          openaiConn.pc.close();
          // DC usually closes with PC
          openaiConnections.delete(language);
      }
  
      // Close all attendee connections for this language
      const attendeeConns = attendeeConnectionsByLanguage.get(language);
      if (attendeeConns) {
          console.log(`${langContext} Closing ${attendeeConns.size} attendee connection(s)...`);
          attendeeConns.forEach(conn => {
              try {
                  if (conn.dc && conn.dc.readyState !== 'closed') conn.dc.close();
                  if (conn.pc && conn.pc.connectionState !== 'closed') conn.pc.close();
                  allAttendees.delete(conn.id); // Remove from global list
              } catch (closeErr) {
                  console.warn(`${langContext} Error closing resources for attendee ${conn.id}:`, closeErr);
              }
          });
          attendeeConnectionsByLanguage.delete(language); // Remove the set itself
          updateAttendeesList(setAttendees); // Update UI after removing attendees
      }
  
      console.log(`${langContext} Cleanup complete for language.`);
  }
  
  
  /**
  * Cleans up ALL WebRTC connections and intervals (e.g., on component unmount).
  */
  export function cleanupGuideWebRTC() {
      console.log("=== CLEANING UP ALL GUIDE WEBRTC RESOURCES ===");
  
      // Get all languages currently managed
      const languages = new Set([
          ...openaiConnections.keys(),
          ...attendeeConnectionsByLanguage.keys(),
          ...connectionIntervals.keys(),
          ...renewalTimers.keys(),
          ...guideAudioElements.keys()
      ]);
  
      // Create a dummy setAttendees if none provided, to prevent errors in cleanup functions
      const dummySetAttendees = (attendees: string[]) => {};
  
      // Clean up each language individually
      languages.forEach(lang => {
           cleanupGuideWebRTCForLanguage(lang, dummySetAttendees).catch(err => {
               console.error(`Error during final cleanup for language ${lang}:`, err);
           });
      });
  
      // Clear global maps just in case
      allAttendees.clear();
      reconnectStatus.clear();
  
      console.log("=== ALL GUIDE WEBRTC CLEANUP COMPLETE ===");
  }
  
  
  /**
   * Attempts to send a closing/update message to OpenAI before closing the connection.
   */
  async function sendClosingMessage(language: string): Promise<void> {
      const langContext = `[${language}]`;
      const openaiConn = openaiConnections.get(language);
      if (openaiConn && openaiConn.dc && openaiConn.dc.readyState === "open") {
        try {
          // Use a standard message type like session.update, potentially with a custom state
          const message = {
            type: "session.update", // Or another appropriate type
            session: { state: "closing" } // Custom state information
          };
          console.log(`${langContext} Sending closing indication message to OpenAI...`);
          openaiConn.dc.send(JSON.stringify(message));
  
          // Give the message a brief moment to send before closing
          await new Promise(resolve => setTimeout(resolve, 100)); // Short delay (100ms)
  
        } catch (error) {
          console.error(`${langContext} Error sending closing message:`, error);
        }
      } else {
          // console.log(`${langContext} Cannot send closing message, data channel not open.`);
      }
    }
  
  // Dummy setTranslation function if needed for contexts where the real one isn't available
  function _setTranslation(translation: string): void {
      // console.log("Internal setTranslation:", translation);
  }
  
  
  /**
  * Helper function to forward raw audio buffer to attendees (less common now with track forwarding)
  * Kept for potential future use cases or direct audio manipulation.
  */
  async function forwardAudioBufferToAttendees(language: string, audioBuffer: ArrayBuffer): Promise<void> {
      const langContext = `[${language}]`;
      const connections = attendeeConnectionsByLanguage.get(language);
      if (!connections || connections.size === 0) {
          // console.log(`${langContext} No attendees to forward audio buffer.`);
          return;
      }
  
      console.log(`${langContext} Forwarding audio buffer (${audioBuffer.byteLength} bytes) to ${connections.size} attendees.`);
  
      for (const conn of connections) {
          // Ensure data channel exists and is open before sending binary data
          if (conn.dc && conn.dc.readyState === "open") {
              try {
                  // Use the sendThroughDataChannel helper for consistency and error handling
                  const success = sendThroughDataChannel(conn.dc, "audio_buffer", audioBuffer, { isBinary: true });
                  if (!success) {
                       console.warn(`${langContext} Failed to send audio buffer to attendee ${conn.id} via helper.`);
                  }
              } catch (error) {
                  console.error(`${langContext} Error forwarding audio buffer to attendee ${conn.id}:`, error);
              }
          } else {
               console.warn(`${langContext} Cannot forward audio buffer to attendee ${conn.id}: Data channel not ready (State: ${conn.dc?.readyState})`);
          }
      }
  }