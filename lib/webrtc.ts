// Map of language to WebRTC connections for attendees
const connections = new Map<string, {
    pc: RTCPeerConnection,
    audioEl: HTMLAudioElement,
    tourId: string, // Store tourId here
    keyRefreshTimer: NodeJS.Timeout | null; // Add to store timer ID
}>()

export async function initWebRTC(setTranslation: (translation: string) => void, language: string, tourId: string) {
  try {
    console.log("=== INITIALIZING ATTENDEE WEBRTC ===")
    console.log(`Language selected: ${language}, Tour Code: ${tourId}`)

    // Fetch ephemeral key from /api/session
    const sessionResponse = await fetch("/api/session", {
      credentials: "include"
    })
    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text()
      console.error(`Failed to fetch ephemeral key: ${sessionResponse.status} ${sessionResponse.statusText}`, errorText)
      throw new Error(`Failed to fetch ephemeral key: ${sessionResponse.statusText}`)
    }
    const sessionData = await sessionResponse.json()
    const ephemeralKey = sessionData.client_secret.value
    console.log("Ephemeral key fetched successfully")

    // --- ADD KEY REFRESH TIMER HERE ---
    let keyRefreshTimerId: NodeJS.Timeout | null = null; // Variable to hold timer ID
    const startKeyRefreshTimer = () => {
        keyRefreshTimerId = setInterval(async () => {
            console.log(`Refreshing ephemeral key for language: ${language}`);
            try {
                const refreshResponse = await fetch("/api/session", { // Re-fetch ephemeral key
                    credentials: "include"
                });
                if (!refreshResponse.ok) {
                    const errorText = await refreshResponse.text();
                    console.error(`Failed to refresh ephemeral key: ${refreshResponse.status} ${refreshResponse.statusText}`, errorText);
                    // In a more robust implementation, you might trigger a reconnection here if key refresh consistently fails.
                } else {
                    const refreshData = await refreshResponse.json();
                    const newEphemeralKey = refreshData.client_secret.value;
                    console.log(`Ephemeral key refreshed successfully for language: ${language}`);
                    // In this basic implementation, we are NOT updating the existing connection.
                    // The new key will be used for the next connection or reconnection attempt.
                    //  More advanced:  Dynamic update or session renegotiation (complex).
                }
            } catch (error) {
                console.error("Error refreshing ephemeral key:", error);
                // Handle refresh error (e.g., retry, log to user)
            }
        }, 45000); // Refresh every 45 seconds (adjust as needed, slightly less than expected expiry)
    };

    startKeyRefreshTimer(); // Start the timer immediately after getting the initial key

    // Create peer connection for receiving translations with multiple STUN servers
    // for better NAT traversal as specified in the tech spec
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'turn:192.168.240.1:3478', // Replace with your TURN server IP
          username: 'username1', // Use a valid username from your turnserver.conf
          credential: 'password1' // Use the corresponding password
        },
        {
          urls: 'turns:192.168.240.1:443', // Replace with your TURN server IP (TURN over TLS)
          username: 'username1', // Use a valid username from your turnserver.conf
          credential: 'password1' // Use the corresponding password
        },
        { urls: ["stun:stun.l.google.com:19302"] },
        { urls: ["stun:stun1.l.google.com:19302"] },
        { urls: ["stun:stun2.l.google.com:19302"] },
        { urls: ["stun:stun3.l.google.com:19302"] },
        { urls: ["stun:stun4.l.google.com:19302"] }
      ],
    })

    console.log('Using ICE servers:', pc.getConfiguration().iceServers);

    // Set up audio element for receiving translated audio
    const audioEl = new Audio()
    audioEl.autoplay = true
    


    // Add event listener to handle autoplay restrictions
    audioEl.addEventListener('canplaythrough', () => {
      const playPromise = audioEl.play()
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error("Autoplay prevented:", error)
          // Implement user gesture requirement notification here if needed
        })
      }
    })
    
    // Handle incoming audio tracks from the guide
    pc.ontrack = (e) => {
      console.log("Received audio track from guide:", e.track.kind)
      audioEl.srcObject = e.streams[0]
      
      // Attempt to play audio after track is received
      audioEl.play().then(() => {
        console.log("Audio playback started successfully");
      }).catch(error => {
        console.error("Autoplay prevented or playback failed:", error);
        // Optionally, show a message to the user that they need to interact to start audio
      });

      // Monitor audio levels for debugging (optional, can be removed later)
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(e.streams[0])
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const checkAudioLevels = () => {
        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const average = sum / dataArray.length
        console.log(`Audio level: ${average}`)
        
        if (average > 0) {
          console.log("Audio is being received")
        }
      }
      
      // Check audio levels every second
      const audioLevelInterval = setInterval(checkAudioLevels, 1000)
      
      // Clean up when track ends
      e.track.onended = () => {
        clearInterval(audioLevelInterval)
        audioContext.close()
      }
    }

    // Handle data channel created by guide
    pc.ondatachannel = (event) => {
      console.log("Data channel received from guide:", event.channel.label)
      const dc = event.channel
      
      
      dc.onopen = () => {
        console.log("Data channel opened")
      }
      
      dc.onclose = () => {
        console.log("Data channel closed", dc.readyState)
      }
      
      dc.onerror = (error) => {
        console.error("Data channel error:", error)
      }
      
      dc.onmessage = (e) => {
        try {
          const realtimeEvent = JSON.parse(e.data)
          console.log("Received event from guide:", realtimeEvent.type)
          
          // Handle incremental translation updates
          if (realtimeEvent.type === "translation.update" && realtimeEvent.text) {
            setTranslation(realtimeEvent.text)
          }
          // Handle complete translation
          else if (realtimeEvent.type === "translation.complete" && realtimeEvent.text) {
            setTranslation(realtimeEvent.text)
          }
        } catch (error) {
          console.error("Error parsing data channel message:", error)
        }
      }
    }

    // Handle connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state: ${pc.iceConnectionState}`)
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        console.log(`ICE connection lost for ${language}, attempting to reconnect...`)
        reconnect(setTranslation, language)
      }
    }
    
    pc.onconnectionstatechange = () => {
      console.log(`Connection state: ${pc.connectionState}`)
    }

    // Get the guide's offer from the server, including tourId
    console.log("Fetching guide's offer with tour Code and language...")
    try {
      const offerResponse = await fetch(
        `/api/tour/join?tourId=${encodeURIComponent(tourId)}&language=${encodeURIComponent(language)}`,
        {
          credentials: "include",
        }
      );
      
      console.log("Offer fetch response:", offerResponse.status, offerResponse.statusText)
      
      if (!offerResponse.ok) {
        const errorText = await offerResponse.text()
        console.error(`Failed to get offer: ${offerResponse.status} ${offerResponse.statusText}`, errorText)
        throw new Error(`Failed to get offer: ${offerResponse.statusText}`)
      }
      
      const offerData = await offerResponse.json()
      console.log("Received guide's offer:", offerData)
      
      // Set the remote description (guide's offer)
      await pc.setRemoteDescription(offerData.offer)
      console.log("Remote description set")
      
      // Create an answer
      console.log("Creating answer...")
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      console.log("Local description set")
      
      // Send the answer back to the guide
      console.log("Sending answer to guide...")
      const answerResponse = await fetch("/api/tour/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          language,
          answer: pc.localDescription
        }),
        credentials: "include"
      })
      
      if (!answerResponse.ok) {
        const errorText = await answerResponse.text()
        console.error(`Failed to send answer: ${answerResponse.status} ${answerResponse.statusText}`, errorText)
        throw new Error(`Failed to send answer: ${answerResponse.statusText}`)
      }
      
      console.log("Answer sent successfully")

      // Set up handler for ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          try {
            await fetch("/api/tour/ice-candidate", { // Updated endpoint to /api/tour/ice-candidate
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                tourId,         // Include tourId
                language,
                candidate: event.candidate
              }),
              credentials: "include"
            })
          } catch (error) {
            console.error("Failed to send ICE candidate:", error)
          }
        }
      }
      
      // Get ICE candidates from the guide
      const getGuideIceCandidates = async () => {
        try {
          const iceResponse = await fetch(`/api/tour/guide-ice?language=${encodeURIComponent(language)}`, {
            credentials: "include"
          })
          
          if (iceResponse.ok) {
            const iceData = await iceResponse.json()
            if (iceData.candidates && iceData.candidates.length > 0) {
              for (const candidate of iceData.candidates) {
                await pc.addIceCandidate(candidate)
              }
              console.log(`Added ${iceData.candidates.length} ICE candidates from guide`)
            }
          }
        } catch (error) {
          console.error("Failed to get guide ICE candidates:", error)
        }
      }
      
      // Poll for ICE candidates every 2 seconds for 10 seconds
      let attempts = 0
      const iceInterval = setInterval(async () => {
        await getGuideIceCandidates()
        attempts++
        if (attempts >= 5) {
          clearInterval(iceInterval)
        }
      }, 2000)
      
      // Store connection info, including tourId and timer ID
      connections.set(language, { pc, audioEl, tourId, keyRefreshTimer: keyRefreshTimerId }); // Store timer ID in connections map
      console.log("WebRTC initialization completed successfully")
    } catch (error) {
      console.error("Error in WebRTC offer/answer exchange:", error)
      throw error
    }
  } catch (error) {
    console.error(`WebRTC initialization error for ${language}:`, error)
    throw error
  }
}

async function reconnect(setTranslation: (translation: string) => void, language: string) {
  try {
    const connection = connections.get(language);
    if (connection) {
      const tourId = connection.tourId; // Retrieve tourId for reconnection
      connection.pc.close();
      connections.delete(language);
      await initWebRTC(setTranslation, language, tourId); // Pass tourId to initWebRTC
    }
  } catch (error) {
    console.error(`Reconnection failed for ${language}:`, error)
    // Implement exponential backoff or show an error to the user
  }
}

export function cleanupWebRTC() {
  for (const [language, connection] of connections) {
    console.log(`Closing WebRTC connection for language: ${language}`);
    connection.pc.close();
    if (connection.keyRefreshTimer) { // Check if timer exists before clearing
        clearInterval(connection.keyRefreshTimer); // Clear the refresh timer
        console.log(`Cleared key refresh timer for language: ${language}`);
    }
  }
  connections.clear()
}
