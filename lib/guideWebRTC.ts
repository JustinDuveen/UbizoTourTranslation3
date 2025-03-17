interface OpenAIConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
}

interface AttendeeConnection {
  id: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
}


// Map of language to OpenAI connection
const openaiConnections = new Map<string, OpenAIConnection>();

// Map of language to Set of attendee connections for that language
const attendeeConnectionsByLanguage = new Map<string, Set<AttendeeConnection>>();

// Map to track all attendees (for UI updates)
export const allAttendees = new Map<string, string>(); // attendeeId -> language

// Keep track of connection status
// Keep track of connection status
let connectionInterval: number | null = null;
const renewalTimers = new Map<string, number>();

// Track temporary audio elements for guide playback
const guideAudioElements = new Map<string, HTMLAudioElement>();

/**
 * Creates and plays an audio element for the guide when no attendees are connected.
 * @param stream The MediaStream containing audio to play
 * @param language The language of the audio stream
 */
function playAudioForGuide(stream: MediaStream, language?: string): void {
  console.log("Playing audio for guide (no attendees connected)");
  
  // Clean up any existing audio element for this language
  if (language && guideAudioElements.has(language)) {
    const existingAudio = guideAudioElements.get(language);
    if (existingAudio) {
      existingAudio.pause();
      existingAudio.srcObject = null;
      existingAudio.remove();
      guideAudioElements.delete(language);
    }
  }
  
  // Create a new audio element
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  audioEl.muted = false;
  audioEl.srcObject = stream;
  
  // Add to DOM (hidden)
  audioEl.style.display = 'none';
  document.body.appendChild(audioEl);
  
  // Store reference if language is provided
  if (language) {
    guideAudioElements.set(language, audioEl);
    
    // Clean up when an attendee joins this language
    const checkForAttendees = setInterval(() => {
      const connections = attendeeConnectionsByLanguage.get(language);
      if (connections && connections.size > 0) {
        console.log(`Attendee joined ${language}, stopping guide audio playback`);
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
        guideAudioElements.delete(language);
        clearInterval(checkForAttendees);
      }
    }, 2000);
  }
  
  // Clean up when audio ends
  audioEl.addEventListener('ended', () => {
    audioEl.remove();
    if (language) {
      guideAudioElements.delete(language);
    }
  });
  
  console.log("Guide audio playback started");
}

/**
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
      console.log(`Updated attendees list with ${attendeeList.length} attendees`);
    } catch (error) {
      // Catch any errors during the update process
      console.error("Error updating attendees list:", error);
    }
  } else {
    // Log a warning but don't throw an error as this might be called in contexts
    // where setAttendees is optional
    console.log("No valid setAttendees function provided to updateAttendeesList");
  }
}

/**
 * Loads an audio instruction file and converts it to a base64 data URL.
 */
async function loadAudioInstructions(language: string): Promise<string> {
  const filePath = `audio/english_to_${language.toLowerCase()}_Translation_Instruction.mp3`;
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load audio instructions from ${filePath}`);
    }
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        // reader.result is a base64 data URL
        resolve(reader.result as string);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`Failed to load audio instructions for ${language}:`, error);
    throw error;
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
    console.log(`Stored translation in Redis for ${language}`);
  } catch (error) {
    console.error("Error storing translation in Redis:", error);
  }
}

/**
 * Forward a translation (text or audio) to all attendees of a specific language
 */
function forwardTranslationToAttendees(language: string, translationData: any): void {
  const connections = attendeeConnectionsByLanguage.get(language);
  if (!connections || connections.size === 0) {
    console.log(`No attendees to forward translation for ${language}`);
    return;
  }

  console.log(`Forwarding translation to ${connections.size} attendees for ${language}`);
  for (const conn of connections) {
    if (conn.dc.readyState === "open") {
      try {
        conn.dc.send(JSON.stringify(translationData));
      } catch (error) {
        console.error(`Error forwarding translation to attendee ${conn.id}:`, error);
      }
    }
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
): Promise<OpenAIConnection> {
  console.log(`Setting up OpenAI connection for ${language}...`);

  
  const renewalTimers = new Map<string, number>();
  
  
  let ephemeralKeyExpiryTime: number | null = null;
  let EPHEMERAL_KEY: string; // Declare EPHEMERAL_KEY here

  let retryCount = 0;
  const MAX_RETRIES = 5;



async function renewEphemeralKey(language: string): Promise<void> {
  console.log(`Renewing ephemeral key for ${language}...`);
  try {
    const newKey = await fetchEphemeralKey();
    console.log(`New ephemeral key fetched for ${language}: ${newKey}`);
    EPHEMERAL_KEY = newKey;

    // Reinitialize connection
    const existingConn = openaiConnections.get(language);

    if (existingConn) {
      console.log(`Reinitializing connection for ${language} with new key`);
      try {
        await sendClosingMessage(language);
        existingConn.pc.close();
        existingConn.dc.close();
        openaiConnections.delete(language);
        //initGuideWebRTC parameters: setTranslation: (translation: string) => void, language: string, setAttendees: (attendees: string[]) => void, tourId: string
        await initGuideWebRTC(setTranslation, language, setAttendees, tourId);
      } catch (reinitError) {
        console.error(`Error reinitializing connection for ${language}:`, reinitError);
      }
    }

    // Reset retry count on successful renewal
    retryCount = 0;

    // Schedule the next renewal
    scheduleKeyRenewal(language);
  } catch (error) {
    console.error(`Failed to renew ephemeral key for ${language}:`, error);

    // Retry with exponential backoff
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(30000, 1000 * Math.pow(2, retryCount)); // Max delay of 30 seconds
      console.log(`Retrying key renewal in ${delay}ms...`);
      setTimeout(() => renewEphemeralKey(language), delay);
      retryCount++;
    } else {
      console.error("Max retries reached, giving up on key renewal");
    }
  }
}



  async function fetchEphemeralKey(): Promise<string> {
    const response = await fetch("/api/session", { credentials: "include" });
    if (!response.ok) {
      console.error(`Failed to fetch ephemeral key: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch ephemeral key: ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.client_secret || !data.client_secret.value) {
      console.error("Invalid session data:", data);
      throw new Error("Failed to get ephemeral key from session API");
    }
  
    // Store the key's creation time and calculate expiry time (1 minute later)
    const now = Date.now();
    ephemeralKeyExpiryTime = now + 60000; // 1 minute in milliseconds
  
    console.log("Ephemeral key obtained successfully, expires at:", new Date(ephemeralKeyExpiryTime).toISOString());
    return data.client_secret.value;
  }

  

  try {
    EPHEMERAL_KEY = await fetchEphemeralKey();
    console.log("Ephemeral key obtained successfully");

    // Schedule the first key renewal
    scheduleKeyRenewal(language);
  } catch (error) {
    console.error("Initial ephemeral key fetch failed:", error);
    throw error;
  }


  let renewalTimer: number | null = null;

function scheduleKeyRenewal(language: string) {
  const existingTimer = renewalTimers.get(language);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  if (!ephemeralKeyExpiryTime) {
    console.error("Cannot schedule key renewal: No expiry time set");
    return;
  }

  const now = Date.now();
  const timeUntilExpiry = ephemeralKeyExpiryTime - now;

  if (timeUntilExpiry <= 0) {
    console.error("Key has already expired, renewing immediately");
    renewEphemeralKey(language);
    return;
  }

  const renewalTime = timeUntilExpiry - 50000;
  const timerId = window.setTimeout(
    () => renewEphemeralKey(language), 
    renewalTime // Pass delay as second argument
  );
  renewalTimers.set(language, timerId);

  console.log(`Scheduled key renewal for ${language} in ${renewalTime}ms`);
}


  // Create RTCPeerConnection for OpenAI
  const openaiPC = new RTCPeerConnection({
    iceServers: [
      {
        urls: 'turn:192.168.240.1:3478',
        username: 'username1',
        credential: 'password1'
      },      
      {
        urls: 'turns:192.168.240.1:443',
        username: 'username1',
        credential: 'password1'
      },
      { urls: ["stun:stun.l.google.com:19302"] },
      { urls: ["stun:stun1.l.google.com:19302"] },
      { urls: ["stun:stun2.l.google.com:19302"] },
      { urls: ["stun:stun3.l.google.com:19302"] },
      { urls: ["stun:stun4.l.google.com:19302"] }
    ],
  });

  openaiPC.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('OpenAI ICE Candidate:', event.candidate.candidate);
      if (event.candidate.candidate.includes('relay')) {
        console.log('TURN server is being used for OpenAI');
      }
    }
  };

  openaiPC.oniceconnectionstatechange = () => {
    console.log('OpenAI ICE Connection State:', openaiPC.iceConnectionState);
  };

  console.log('OpenAI using ICE servers:', openaiPC.getConfiguration().iceServers);

   // Monitor connection state
   openaiPC.oniceconnectionstatechange = () => {
    console.log(`OpenAI ICE connection state for ${language}: ${openaiPC.iceConnectionState}`);
    if (
      openaiPC.iceConnectionState === "disconnected" ||
      openaiPC.iceConnectionState === "failed" ||
      openaiPC.iceConnectionState === "closed"
    ) {
      console.log(`Connection lost for ${language}, attempting to reconnect...`);
      reconnect(setTranslation, language, setAttendees, tourId);
    }
  };

  
  openaiPC.onconnectionstatechange = () => {
    console.log(`OpenAI connection state for ${language}: ${openaiPC.connectionState}`);
  };

  // Access microphone for guide's audio
  const micStream = await navigator.mediaDevices.getUserMedia({ 
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
  });
  
  micStream.getAudioTracks().forEach(track => {
    console.log(`Adding audio track to OpenAI connection: ${track.label}`);
    openaiPC.addTrack(track, micStream);
  });

  // Create data channel for OpenAI communication
  const openaiDC = openaiPC.createDataChannel("oai-events", { ordered: true });

  openaiDC.onopen = async () => {
    console.log(`OpenAI data channel opened for ${language}`);
    
    try {
      // Load language-specific audio instructions
      const audioInstructionsBase64 = await loadAudioInstructions(language);
      
      // Send audio instructions only - NO TEXT INSTRUCTIONS
      openaiDC.send(JSON.stringify({
        type: "response.create",
        response: { modalities: ["audio"] }
      }));
    } catch (error) {
      console.error(`Failed to load audio instructions for ${language}:`, error);
      return;
    }
    
    // Set up a ping interval to keep the connection alive
    if (connectionInterval) window.clearInterval(connectionInterval);
    connectionInterval = window.setInterval(() => {
      if (openaiDC.readyState === "open") {
        openaiDC.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 30000);
  };

  openaiDC.onclose = () => {
    console.log(`OpenAI data channel closed for ${language}`, openaiDC.readyState);
    if (connectionInterval) {
      window.clearInterval(connectionInterval);
      connectionInterval = null;
    }
  };

  openaiDC.onerror = (error) => {
    console.error(`OpenAI data channel error for ${language}:`, error);
    console.error("Data channel error details:", error); // Log more details
    // Attempt to reconnect
    reconnect(setTranslation, language, setAttendees, tourId);
  };

  openaiDC.addEventListener('error', event => {
    console.error(`Data channel event error for ${language}:`, event);
  });

  // Handle incoming messages from OpenAI
  openaiDC.onmessage = (e) => {
    const realtimeEvent = JSON.parse(e.data);
    console.log(`OpenAI event received for ${language}:`, realtimeEvent.type);
    
    // ✅ No text event handling remains
    // Add audio-related event handling here if needed
  };
  
  // Create and send offer to OpenAI
  console.log('Creating OpenAI offer...');
  const openaiOffer = await openaiPC.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: false
  });
  console.log('Setting local description for OpenAI offer...');
  await openaiPC.setLocalDescription(openaiOffer);
  console.log('Local description set for OpenAI offer');

  // Wait for ICE gathering to complete or timeout
  await Promise.race([
    new Promise<void>((resolve) => {
      if (openaiPC.iceGatheringState === "complete") {
        resolve();
      } else {
        const checkState = () => {
          if (openaiPC.iceGatheringState === "complete") {
            openaiPC.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };
        openaiPC.addEventListener("icegatheringstatechange", checkState);
      }
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 5000))
  ]);
  
  // Send the SDP offer to OpenAI Realtime API
  const baseUrl = "https://api.openai.com/v1/realtime";
  const model = "gpt-4o-realtime-preview-2024-12-17";
  const voice = "verse";
  
  try {
    console.log('Sending SDP offer to OpenAI API...');
    const sdpResponse = await fetch(`${baseUrl}?model=${model}&voice=${voice}`, {
      method: "POST",
      body: openaiPC.localDescription?.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });
    
    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      console.error(`OpenAI WebRTC setup failed: ${sdpResponse.status} ${sdpResponse.statusText}`, errorText);
      throw new Error(`OpenAI WebRTC setup failed: ${sdpResponse.statusText}`);
    }
    console.log('SDP offer sent to OpenAI API, response:', sdpResponse.status, sdpResponse.statusText);

    const openaiAnswer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    
    await openaiPC.setRemoteDescription(openaiAnswer as RTCSessionDescriptionInit);
    console.log(`Remote description set successfully for OpenAI ${language} connection`);
    
    // Set up track handling - when we receive audio from OpenAI, forward to all attendees
    openaiPC.ontrack = (e) => {
      console.log(`Received track from OpenAI for ${language}:`, e.track.kind);

      // Get attendee connections for this language
      const connections = attendeeConnectionsByLanguage.get(language);

      if (connections && connections.size > 0) {
        // Forward audio to attendees if there are any
        for (const conn of connections) {
          try {
            // Add the track to each attendee's connection
            console.log(`Forwarding ${e.track.kind} track to attendee ${conn.id}`);
            conn.pc.addTrack(e.track, e.streams[0]);
          } catch (error) {
            console.error(`Error forwarding track to attendee ${conn.id}:`, error);
          }
        }
      } else {
        // Play audio for guide if no attendees
        console.log("No attendees connected, playing audio for guide");
        playAudioForGuide(e.streams[0], language);
      }
    };

    return { pc: openaiPC, dc: openaiDC };
  } catch (error) {
    console.error(`Error connecting to OpenAI Realtime API for ${language}:`, error);
    throw error;
  }
}

/**
 * Create and set up a new attendee connection for a specific language
 */
async function createAttendeeConnection(
  language: string,
  tourId: string,
  openaiConnection: OpenAIConnection
): Promise<void> {
  console.log(`Creating offer for attendees of ${language}...`);
  
  // Create peer connection for attendees
  const attendeePC = new RTCPeerConnection({
    iceServers: [
      {
        urls: 'turn:192.168.240.1:3478',
        username: 'username1',
        credential: 'password1'
      },

      
      {
        urls: 'turns:192.168.240.1:443',
        username: 'username1',
        credential: 'password1'
      },
      { urls: ["stun:stun.l.google.com:19302"] },
      { urls: ["stun:stun1.l.google.com:19302"] },
      { urls: ["stun:stun2.l.google.com:19302"] },
      { urls: ["stun:stun3.l.google.com:19302"] },
      { urls: ["stun:stun4.l.google.com:19302"] }
    ],
  });


  attendeePC.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Attendee ICE Candidate:', event.candidate.candidate);
      if (event.candidate.candidate.includes('relay')) {
        console.log('TURN server is being used for attendee');
      }
    }
  };

  
  attendeePC.oniceconnectionstatechange = () => {
    console.log('Attendee ICE Connection State:', attendeePC.iceConnectionState);
  };

  
  console.log('Attendee connection using ICE servers:', attendeePC.getConfiguration().iceServers);

  // Create a data channel for sending translated audio/text to attendees
  const attendeeDC = attendeePC.createDataChannel("translations");

  // Create an offer for the attendee connection
  console.log('Creating attendee offer...');
  const attendeeOffer = await attendeePC.createOffer();
  console.log('Setting local description for attendee offer...');
  await attendeePC.setLocalDescription(attendeeOffer);
  console.log('Local description set for attendee offer');

  // Wait for ICE gathering to complete or timeout
  await Promise.race([
    new Promise<void>((resolve) => {
      if (attendeePC.iceGatheringState === "complete") {
        resolve();
      } else {
        const checkState = () => {
          if (attendeePC.iceGatheringState === "complete") {
            attendeePC.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };
        attendeePC.addEventListener("icegatheringstatechange", checkState);
      }
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 5000))
  ]);

  // Store the attendee offer in Redis
  const offerKey = `tour:${tourId}:${language}`;
  console.log(`Storing attendee offer in Redis with key: ${offerKey}`);
  
  console.log('Storing attendee offer in Redis:', attendeePC.localDescription);

  try {
    console.log('Sending attendee offer to /api/tour/offer...');
    const tourResponse = await fetch("/api/tour/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language,
        tourId,
        offer: attendeePC.localDescription,
      }),
      credentials: "include"
    });
    
    if (!tourResponse.ok) {
      const errorText = await tourResponse.text();
      console.error(`Failed to store offer: ${tourResponse.status} ${tourResponse.statusText}`, errorText);
      throw new Error(`Failed to store offer: ${tourResponse.statusText}`);
    }
    
    console.log("Attendee offer stored successfully, response:", tourResponse.status, tourResponse.statusText);
  } catch (error) {
    console.error(`Error storing attendee offer for ${language}:`, error);
    throw error;
  }

  // Handle ICE candidate exchange for the attendee connection
  attendeePC.onicecandidate = async (event) => {
    if (event.candidate) {
      try {
        await fetch("/api/tour/ice-candidate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language,
            tourId,
            candidate: event.candidate
          }),
          credentials: "include"
        });
      } catch (error) {
        console.error(`Failed to send ICE candidate for ${language}:`, error);
      }
    }
  };
}

/**
 * Poll for and process attendee answers and ICE candidates
 */
async function pollForAttendeeAnswers(
  language: string, 
  tourId: string, 
  setAttendees: (attendees: string[]) => void
): Promise<void> {
  console.log(`Polling for attendee answers for ${language}...`);

  try {
    const answersResponse = await fetch(
      `/api/tour/answer?language=${encodeURIComponent(language)}&tourId=${encodeURIComponent(tourId)}`, 
      { 
        method: "POST",
        credentials: "include" 
      }
    );

    
    if (!answersResponse.ok) {
      console.error(`Failed to poll for answers: ${answersResponse.status} ${answersResponse.statusText}`);
      return;
    }
    console.log('Poll for attendee answers response:', answersResponse.status, answersResponse.statusText);
    
    const answersData = await answersResponse.json();
    if (answersData.answers && answersData.answers.length > 0) {
      console.log(`Received ${answersData.answers.length} answers from attendees in poll response for ${language}`);
      
      for (const { attendeeId, answer } of answersData.answers) {
        try {
          console.log(`Processing answer from attendee ${attendeeId} for ${language}`);
          
          // Check if we already have a connection for this attendee
          let attendeeConnection: AttendeeConnection | undefined;
          const connections = attendeeConnectionsByLanguage.get(language);
          
          if (connections) {
            attendeeConnection = Array.from(connections).find(conn => conn.id === attendeeId);
          }
          
          // If not, create a new connection for this attendee
          if (!attendeeConnection) {
            console.log(`No existing connection found, creating new connection for attendee ${attendeeId} (${language})`);
            
            // Create new peer connection for this attendee
            const attendeePC = new RTCPeerConnection({
              iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
            });
            
            // Create data channel
            const attendeeDC = attendeePC.createDataChannel(`translations-${attendeeId}`);
            
            // Create new attendee connection
            attendeeConnection = { id: attendeeId, pc: attendeePC, dc: attendeeDC };
            
            // Add to our tracking maps
            if (!attendeeConnectionsByLanguage.has(language)) {
              attendeeConnectionsByLanguage.set(language, new Set());
            }
            attendeeConnectionsByLanguage.get(language)!.add(attendeeConnection);
            allAttendees.set(attendeeId, language);
            
            // Update UI
            updateAttendeesList(setAttendees);
            
            // Set up audio forwarding from OpenAI to this attendee
            const openaiConn = openaiConnections.get(language);
            if (openaiConn) {
              // We'll get tracks via openaiPC.ontrack which was set up earlier
              console.log(`Ready to forward audio from OpenAI to attendee ${attendeeId}`);
            }
          }
          
          // Set the remote description (answer) from the attendee
          console.log(`Setting remote description for attendee ${attendeeId}...`);
          await attendeeConnection.pc.setRemoteDescription(answer);
          console.log(`Remote description set for attendee ${attendeeId}`);
          
          // Get and add ICE candidates from this attendee
          const iceCandidatesResponse = await fetch(
            `/api/tour/attendee-ice?language=${encodeURIComponent(language)}&attendeeId=${encodeURIComponent(attendeeId)}&tourId=${encodeURIComponent(tourId)}`, 
            { credentials: "include" }
          );
          
          if (iceCandidatesResponse.ok) {
            const iceCandidatesData = await iceCandidatesResponse.json();
            if (iceCandidatesData.candidates && iceCandidatesData.candidates.length > 0) {
              console.log(`Received ICE candidates from attendee ${attendeeId}, adding ${iceCandidatesData.candidates.length} candidates`);
              
              for (const candidate of iceCandidatesData.candidates) {
                await attendeeConnection.pc.addIceCandidate(candidate);
              }
            }
          }
        } catch (error) {
          console.error(`Error processing answer from attendee ${attendeeId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error polling for answers for ${language}:`, error);
  }
}

/**
 * Main function to initialize the guide's WebRTC connections.
 * Sets up one OpenAI connection per language and prepares to handle multiple attendees per language.
 */
export async function initGuideWebRTC(
  setTranslation: (translation: string) => void,
  language: string,
  setAttendees: (attendees: string[]) => void,
  tourId: string
) {
  try {
    console.log("=== INITIALIZING GUIDE WEBRTC ===");
    console.log(`Language selected: ${language}`);
    
    // Avoid reinitializing if a connection for this language already exists
    if (openaiConnections.has(language)) {
      console.log(`WebRTC connection for ${language} already exists`);
      return;
    }

    // Set up OpenAI connection for this language
    const openaiConnection = await setupOpenAIConnection(language, setTranslation, setAttendees, tourId); // Pass setAttendees here
    openaiConnections.set(language, openaiConnection);
    
    // Initialize the language group in our attendee tracking maps
    if (!attendeeConnectionsByLanguage.has(language)) {
      attendeeConnectionsByLanguage.set(language, new Set());
    }
    
    // Create the initial attendee offer for this language
    await createAttendeeConnection(language, tourId, openaiConnection);
    
    // Begin polling for attendee answers - only if attendees are present
    const attendeeCount = attendeeConnectionsByLanguage.get(language)?.size || 0;
    if (attendeeCount > 0) {
      // Only poll if there are actually attendees
      await pollForAttendeeAnswers(language, tourId, setAttendees);
    }
    
    // Set up polling interval that checks attendee count before polling
    const pollInterval = setInterval(() => {
      const currentAttendeeCount = attendeeConnectionsByLanguage.get(language)?.size || 0;
      if (currentAttendeeCount > 0) {
        // Only poll if there are actually attendees
        pollForAttendeeAnswers(language, tourId, setAttendees);
      } else {
        console.log(`No attendees connected for ${language}, skipping poll`);
      }
    }, 5000);
    
    console.log("WebRTC initialization completed successfully for language:", language);

  } catch (error) {
    console.error(`Guide WebRTC initialization error for ${language}:`, error);
    throw error;
  }
}

/**
 * Reconnect logic in case the connection is lost.
 * Closes existing connections, clears intervals, and reinvokes initGuideWebRTC.
 */
async function reconnect(
  setTranslation: (translation: string) => void,
  language: string,
  setAttendees: (attendees: string[]) => void,
  tourId: string
): Promise<void> {
  console.log(`Reconnecting WebRTC for ${language}...`);
  let reconnectAttempt = 1;
  const maxReconnectAttempts = 5;

  while (reconnectAttempt <= maxReconnectAttempts) {
    console.log(`Reconnection attempt ${reconnectAttempt} for ${language}...`);
    try {
      // Close OpenAI connection for this language
      const openaiConn = openaiConnections.get(language);
      if (openaiConn) {
        console.log(`Closing OpenAI connection for ${language}...`);
        openaiConn.pc.close();
        openaiConn.dc.close();
        openaiConnections.delete(language);
        console.log(`OpenAI connection closed for ${language}.`);
      }

      // Close all attendee connections for this language
      const attendeeConns = attendeeConnectionsByLanguage.get(language);
      if (attendeeConns) {
        console.log(`Closing attendee connections for ${language}...`);
        for (const conn of attendeeConns) {
          conn.pc.close();
          conn.dc.close();
          allAttendees.delete(conn.id);
        }
        attendeeConnectionsByLanguage.delete(language);
        console.log(`Attendee connections closed for ${language}.`);
      }
      
      // Clean up any guide audio elements for this language
      if (guideAudioElements.has(language)) {
        console.log(`Cleaning up guide audio element for ${language}`);
        const audioEl = guideAudioElements.get(language)!;
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
        guideAudioElements.delete(language);
      }

      // Update attendees list in UI - Call updateAttendeesList with setAttendees
      updateAttendeesList(setAttendees);

      // Clear connection interval if it exists
      if (connectionInterval) {
        console.log(`Clearing connection interval...`);
        window.clearInterval(connectionInterval);
        connectionInterval = null;
        console.log(`Connection interval cleared.`);
      }

      // Wait a moment before reconnecting
      console.log(`Waiting 1 second before reinitializing...`);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reinitialize connections
      console.log(`Reinitializing WebRTC connections for ${language}...`);
      await initGuideWebRTC(setTranslation, language, setAttendees, tourId);
      console.log(`WebRTC reinitialization completed for ${language}.`);
      return; // If successful, exit the loop
    } catch (error) {
      console.error(`Reconnection attempt ${reconnectAttempt} failed for ${language}:`, error);
      if (reconnectAttempt === maxReconnectAttempts) {
        console.error(`Max reconnection attempts reached for ${language}. Giving up.`);
      } else {
        console.log(`Waiting 5 seconds before next reconnection attempt...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } finally {
      reconnectAttempt++;
    }
  }
}

/**
 * Cleans up all WebRTC connections and intervals.
 */
export function cleanupGuideWebRTC() {
  console.log("Cleaning up WebRTC connections...");
  
  if (connectionInterval) {
    window.clearInterval(connectionInterval);
    connectionInterval = null;
  }
  
  // Clean up any guide audio elements
  for (const [language, audioEl] of guideAudioElements.entries()) {
    console.log(`Cleaning up guide audio element for ${language}`);
    audioEl.pause();
    audioEl.srcObject = null;
    audioEl.remove();
  }
  guideAudioElements.clear();
  
  // Close all OpenAI connections
  for (const conn of openaiConnections.values()) {
    conn.pc.close();
    conn.dc.close();
  }
  openaiConnections.clear();

  // Close all attendee connections
  for (const [language, connections] of attendeeConnectionsByLanguage.entries()) {
    for (const conn of connections) {
      conn.pc.close();
      conn.dc.close();
    }
  }
  attendeeConnectionsByLanguage.clear();
  allAttendees.clear();
  
  console.log("WebRTC connections cleaned up");
}

async function sendClosingMessage(language: string): Promise<void> {
    const openaiConn = openaiConnections.get(language);
    if (openaiConn && openaiConn.dc.readyState === "open") {
        return new Promise<void>((resolve, reject) => {
            let closeTimeout: NodeJS.Timeout | null = null;

            const handleClose = () => {
                if (closeTimeout) {
                    clearTimeout(closeTimeout);
                }
                openaiConn.dc.removeEventListener("close", handleClose);
                openaiConn.dc.removeEventListener("error", handleError);
                resolve();
            };

            const handleError = (error: Event) => {
                if (closeTimeout) {
                    clearTimeout(closeTimeout);
                }
                openaiConn.dc.removeEventListener("close", handleClose);
                openaiConn.dc.removeEventListener("error", handleError);
                reject(error);
            };

            openaiConn.dc.addEventListener("close", handleClose);
            openaiConn.dc.addEventListener("error", handleError);

            openaiConn.dc.send(JSON.stringify({ type: "connection.closing" }));

            // Add a timeout to prevent indefinite waiting
            closeTimeout = setTimeout(() => {
                openaiConn.dc.removeEventListener("close", handleClose);
                openaiConn.dc.removeEventListener("error", handleError);
                reject(new Error("Data channel close timeout"));
            }, 5000); // 5 seconds timeout
        });
    }
}
