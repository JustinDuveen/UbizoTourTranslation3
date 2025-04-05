Technical Specification: GuideWebRTC Module
Version: 1.2 (Reflecting code alignment for session.update, Redis interaction, and TURNS status)
Date: 2024-07-27
Author: AI Language Model (Based on provided code)

1. Overview

GuideWebRTC.ts is a client-side TypeScript module responsible for managing WebRTC connections on the "guide" side of a real-time tour translation application. Its primary functions are:

Establishing and maintaining a bidirectional WebRTC connection with OpenAI's Realtime API for each required translation language.

Capturing the guide's microphone audio and optional pre-recorded instructions.

Sending the guide's audio stream to OpenAI for transcription and translation.

Receiving translated audio and text streams from OpenAI.

Verifying the integrity and readiness of incoming audio streams from OpenAI.

Managing connections with multiple "attendee" clients for each language.

Forwarding the verified translated audio and text received from OpenAI to the appropriate attendee clients.

Handling connection lifecycle events, errors, key renewals, and reconnections gracefully.

2. Core Concepts

Language Group: The system manages resources independently for each target translation language (e.g., 'french', 'german').

OpenAI Connection (OpenAIConnection): Represents the WebRTC connection to OpenAI for a specific language. Contains an RTCPeerConnection (pc) and an RTCDataChannel (dc) for events/text.

Attendee Connection (AttendeeConnection): Represents the WebRTC connection to a single attendee client for a specific language. Contains an RTCPeerConnection (pc) and an RTCDataChannel (dc) for receiving forwarded translations.

Ephemeral Key: A short-lived API key (client_secret) fetched from a backend (/api/session) required to authenticate with the OpenAI Realtime API. Must be renewed periodically (typically every minute).

SDP (Session Description Protocol): Used to negotiate capabilities and connection details between peers (Guide <-> OpenAI, Guide <-> Attendee). The module specifically modifies the SDP offer to OpenAI to ensure bidirectional audio (a=sendrecv).

ICE (Interactive Connectivity Establishment): Framework using STUN and TURN servers to establish direct or relayed peer-to-peer connections through NATs and firewalls.

Audio Verification: A mandatory step performed on incoming audio streams from OpenAI to ensure they are stable and ready for playback/forwarding before use.

3. Key Features & Functionality

Multi-Language Support: Manages independent OpenAI and attendee connections for multiple target languages simultaneously.

OpenAI WebRTC Integration:

Establishes WebRTC connection using OpenAI's /v1/realtime endpoint.

Handles authentication using ephemeral keys.

Sends SDP Offer, specifically modified for a=sendrecv.

Receives and processes SDP Answer from OpenAI.

Uses a dedicated RTCDataChannel (oai-events) for control messages and text exchange with OpenAI.

Handles various OpenAI events (session.*, response.*, input_audio_buffer.*, output_audio_buffer.*, error).

Audio Input:

Accesses the guide's microphone using getUserMedia.

Optionally loads pre-recorded audio instructions (e.g., .mp3) and prepends them to the audio stream sent to OpenAI.

Audio Output Verification (verifyOpenAIAudio):

Intercepts incoming audio tracks from OpenAI via the ontrack event.

Waits a brief period (350ms) for stream stabilization as recommended by OpenAI.

Checks readyState, enabled, and muted status of audio tracks.

Validates that at least one audio track is live and considered active (enabled, not muted).

Logs detailed success or failure information.

Triggers reconnection if a track ends prematurely (readyState === 'ended').

Prevents processing of invalid or unstable audio streams.

Attendee Connection Management:

Generates an SDP Offer for potential attendees for each language (createAttendeeOffer) and stores it via a backend API (/api/tour/offer).

Polls a backend API (/api/tour/answer) for SDP Answers submitted by attendees.

Establishes individual RTCPeerConnections with attendees upon receiving their answer.

Handles ICE candidate exchange between the guide and attendees via backend APIs (/api/tour/ice-candidate, /api/tour/attendee-ice).

Manages data channels (translations) for sending data to attendees.

Data Forwarding:

Forwards verified audio tracks received from OpenAI to all connected attendees of the corresponding language using RTCPeerConnection.addTrack.

Forwards text deltas (response.text.delta) and other relevant events received from OpenAI's data channel to attendees via their respective data channels.

Local Playback: Plays the verified translated audio locally for the guide using an <audio> element (playAudioForGuide) only if no attendees are connected for that language.

Ephemeral Key Management: Automatically fetches and renews OpenAI ephemeral keys before they expire, handling retries on failure. Schedules renewal proactively.

Error Handling & Recovery:

Monitors iceConnectionState and connectionState for both OpenAI and attendee connections.

Implements an automatic reconnect mechanism with exponential backoff for failed or disconnected OpenAI connections.

Includes try...catch blocks around critical operations (API calls, SDP handling, media access).

Cleans up individual attendee connections on failure (cleanupAttendeeConnection).

Lifecycle Management:

Provides initGuideWebRTC to initialize connections for a specific language.

Provides cleanupGuideWebRTC and cleanupGuideWebRTCForLanguage to properly close all connections, clear timers, and remove resources.

4. Workflow & Lifecycle

Initialization (initGuideWebRTC(language, ...)):

Check if connection for language already exists; if so, exit.

Fetch initial Ephemeral Key from /api/session.

Schedule first key renewal (scheduleKeyRenewal).

Setup OpenAI Connection (setupOpenAIConnection):

Create openaiPC and openaiDC.

Get microphone stream (getUserMedia).

Load/process audio instructions.

Add audio tracks to openaiPC.

Set up openaiPC and openaiDC event handlers (state changes, messages, errors).

Create SDP Offer, modify it to ensure a=sendrecv.

Set Local Description.

Wait for ICE gathering completion.

Send Offer SDP to OpenAI Realtime API (/v1/realtime) with auth header.

Receive Answer SDP from OpenAI.

Set Remote Description. Connection conceptually established.

The openaiPC.ontrack handler is now active, waiting for incoming tracks.

Store the successful OpenAIConnection.

Prepare for Attendees (createAttendeeOffer):

Generate an SDP Offer suitable for attendees (e.g., recvonly audio).

Store this offer via the backend API (/api/tour/offer).

Start Attendee Polling:

Initiate polling (pollForAttendeeAnswers) via setInterval to check /api/tour/answer for attendee responses.

OpenAI ontrack Event:

Triggered when OpenAI starts sending an audio (or video) track.

If track.kind === 'audio':

Call verifyOpenAIAudio(stream, language).

If Verification Fails: Log error. If readyState === 'ended', trigger reconnect. Stop processing this track.

If Verification Passes:

Check attendeeConnectionsByLanguage.

If attendees exist: Iterate and call attendeePC.addTrack(verifiedTrack, verifiedStream) for each attendee.

If no attendees: Call playAudioForGuide(verifiedStream, language).

OpenAI Data Channel (onmessage):

Receives JSON events from OpenAI.

handleOpenAIMessage parses the event.

Handles response.text.delta (updates guide UI, forwards to attendees via forwardTranslationToAttendees).

Handles lifecycle/status events (logs, may forward simple status like speech_started to attendees).

Handles error events.

Attendee Answer Polling (pollForAttendeeAnswers):

Periodically fetches /api/tour/answer.

For each new answer:

Check if attendee ID is already connected; if so, skip.

Create a new attendeePC and AttendeeConnection structure.

Set up event handlers for this attendeePC (ICE, state changes, ondatachannel).

Add to tracking maps (attendeeConnectionsByLanguage, allAttendees). Update UI list.

Set Remote Description using the attendee's Answer SDP.

Forward any existing audio tracks from the openaiPC to this new attendeePC.

Start polling specifically for this attendee's ICE candidates (pollForAttendeeIceCandidates).

Attendee ICE Polling (pollForAttendeeIceCandidates):

Periodically fetches /api/tour/attendee-ice for a specific attendee.

Adds received candidates to the corresponding attendeePC using addIceCandidate.

Stops polling if the attendee connection fails or closes.

Key Renewal (renewEphemeralKey):

Triggered by scheduleKeyRenewal timer shortly before expiry.

Fetches a new key from /api/session.

Updates the EPHEMERAL_KEY variable.

Schedules the next renewal.

Crucially, if an OpenAIConnection exists, the current implementation re-initializes the entire connection for that language by calling initGuideWebRTC again after closing the old one. This ensures the new key is used for any subsequent API interactions (like potential re-negotiations, though the primary use is the initial SDP exchange).

Disconnection/Failure:

iceConnectionState or connectionState changes trigger logging.

failed or disconnected states on openaiPC trigger the reconnect function.

failed or closed states on attendeePC trigger cleanupAttendeeConnection.

reconnect calls cleanupGuideWebRTCForLanguage, waits with backoff, then calls initGuideWebRTC.

Cleanup (cleanupGuideWebRTC, cleanupGuideWebRTCForLanguage):

Called manually (e.g., on component unmount) or during reconnection.

Clears all intervals and timeouts (connectionIntervals, renewalTimers).

Closes all RTCPeerConnections and RTCDataChannels for the specified language(s).

Removes guide audio elements.

Clears tracking maps.

5. OpenAI Integration Details

API Endpoint: https://api.openai.com/v1/realtime

Authentication: Authorization: Bearer <EPHEMERAL_KEY> header. Requires fetching key from /api/session.

Request: POST request with Content-Type: application/sdp and the Guide's SDP Offer in the body. Query parameters model and voice are used.

SDP Offer Requirements: Must signal capability to send and receive audio (a=sendrecv). The module explicitly modifies the SDP to ensure this.

SDP Answer: OpenAI responds with its SDP Answer, also application/sdp.

Data Channel (oai-events): Used for JSON-based event communication. Key events handled:

session.update: In the provided code, this message type (specifically {"type": "session.update", "session": { "state": "closing" }}) is sent via the sendClosingMessage helper function before intentionally closing the OpenAI connection, acting as a graceful shutdown notification rather than initial configuration.

response.text.delta: Received from OpenAI with partial text translations.

response.audio.delta: Received but ignored (audio handled via ontrack).

response.done: Indicates OpenAI has finished processing a response segment.

input_audio_buffer.*, output_audio_buffer.*: Lifecycle events indicating speech detection and audio playback states on OpenAI's side.

error: Indicates an error occurred on OpenAI's server.

Audio Track (ontrack): The primary way translated audio is received. Requires the verification step (verifyOpenAIAudio).

6. Audio Verification System (verifyOpenAIAudio)

Purpose: To address potential instability or delays in the audio stream provided by OpenAI's WebRTC endpoint. Ensures the stream is usable before forwarding or playback.

Trigger: Called inside the openaiPC.ontrack handler for incoming audio tracks.

Mechanism:

Waits 350ms (setTimeout).

Gets all audio tracks from the received MediaStream.

Checks track.readyState: Must be 'live'.

Checks track.enabled and !track.muted: Used to infer an 'active' processing state.

Validation Rule: At least one audio track must satisfy readyState === 'live' AND processingState === 'active'.

Outcome: Returns { isValid: boolean, details: OpenAITrackDetails[] }.

Recovery: If isValid is false and any track readyState is 'ended', it triggers the reconnect process for the language.

7. Attendee Connection Handling

Signaling: Relies entirely on backend APIs for signaling:

/api/tour/offer: Guide POSTs offer for attendees.

/api/tour/answer: Guide GETs answers from attendees.

/api/tour/ice-candidate: Guide POSTs its candidates for a specific attendee.

/api/tour/attendee-ice: Guide GETs candidates from a specific attendee.

Connection: An RTCPeerConnection is created for each attendee only after their answer is received via polling.

Data Flow: Primarily unidirectional (Guide -> Attendee). The guide forwards verified OpenAI audio tracks via addTrack and text/events via the translations data channel.

8. Error Handling & Recovery Summary

Connection States: oniceconnectionstatechange and onconnectionstatechange listeners monitor PC states.

OpenAI Reconnect: reconnect function handles OpenAI connection loss with cleanup, backoff, and re-initialization.

Attendee Cleanup: cleanupAttendeeConnection handles individual attendee connection failures.

Key Renewal: Retries with exponential backoff on failure. If max retries are reached, logs an error; connection may subsequently fail.

API Errors: fetch calls include .ok checks and log errors. Polling handles 404s gracefully.

Audio Verification Failure: Specific handling for premature ended tracks triggers reconnection.

9. Helper Functions

arrayBufferToBase64 / base64ToArrayBuffer: Data format conversion.

createTransferableMessage / sendThroughDataChannel: Consistent message creation and sending via Data Channels, including size checks and binary handling.

playAudioForGuide: Manages local audio playback elements.

updateAttendeesList: Updates UI state.

loadAudioInstructions: Fetches and processes instruction audio.

store*InRedis (e.g., storeLanguageMapInRedis, storeTranslationInRedis): Functions that make API calls to the backend service (e.g., /api/tour/languages, /api/tour/answer). The backend service invoked by these APIs is responsible for the actual interaction with Redis persistence. The client code does not interact with Redis directly.

forward*ToAttendees: Logic for sending data to attendee groups.

poll*: Specific polling functions for answers and ICE candidates.

cleanup*: Resource cleanup functions.

sendClosingMessage: Attempts graceful shutdown notification to OpenAI using a session.update message before closing the connection.

10. Configuration & Dependencies

Backend API: Requires a backend implementing the specified /api/ endpoints for session management, offer/answer exchange, ICE candidate relaying, and persistence operations (like storing language maps or translations, likely using Redis).

ICE Servers: Configuration requires STUN and potentially TURN server URLs and credentials. TURN is recommended for reliability. Note that in the provided code's setupOpenAIConnection function, the turns: URL entry in the iceServers array is currently commented out. Attendee connection configurations might still include or utilize turns:.

Audio Files: Assumes instruction audio files are available at paths like audio/english_to_<language>_Translation_Instruction.mp3.

Environment: Runs in a browser environment supporting WebRTC and fetch.

11. Future Considerations & Potential Improvements

Codec Preferences: More explicit SDP manipulation to prefer/mandate specific codecs (e.g., Opus) if needed.

Network Monitoring: Implement more detailed network statistics monitoring (e.g., using getStats()) for advanced diagnostics.

UI Feedback: Provide clearer feedback to the guide about connection states, key renewal issues, verification failures, and reconnections.

Scalability: For very large numbers of attendees per language, investigate backend-based media forwarding/mixing solutions instead of direct guide-to-attendee tracks.

State Management: Consider integrating with a more formal state management library (like Redux, Zustand) if the application complexity grows.

Key Renewal Strategy: Evaluate if re-initializing the entire connection on key renewal is always necessary or if updating the key for subsequent API calls (if any occur beyond initial setup) would suffice. Re-initialization is safer but more disruptive.