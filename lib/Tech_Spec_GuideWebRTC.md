Of course. Here is a comprehensive technical specification for the GuideWebRTC.ts file.

Technical Specification: GuideWebRTC.ts
1. Overview

GuideWebRTC.ts is a client-side module responsible for managing all WebRTC-related functionalities for the "guide" user in a real-time, multi-language tour translation application. Its primary purpose is to capture the guide's microphone audio, send it to the OpenAI Realtime API for translation, receive the translated audio, and then broadcast that translated audio and text to all connected "attendee" clients for a specific language.

The module implements a two-hop WebRTC architecture:

Hop 1 (Guide <-> OpenAI): A primary WebRTC connection is established between the guide's browser and the OpenAI API. The guide sends their microphone audio, and OpenAI sends back translated audio on a separate track.

Hop 2 (Guide <-> Attendees): For each attendee, a separate WebRTC connection is established. The guide's browser acts as a forwarder, taking the translated audio stream received from OpenAI and sending it to the attendee.

This architecture allows a single guide to support multiple translation languages simultaneously, as each language is managed as an independent Guide <-> OpenAI session.

2. Core Components & State Management

The module's state is managed through a set of key data structures and helper classes.

openAIConnectionsByLanguage (Map<string, OpenAIConnection>):

Purpose: The central registry for the primary connection to the OpenAI API for each language.

Key: string (normalized language, e.g., "spanish").

Value: OpenAIConnection object, which contains the RTCPeerConnection (pc), RTCDataChannel (dc), audio stream from OpenAI (audioStream), and other related resources for that language.

attendeeConnectionsByLanguage (Map<string, Map<string, AttendeeConnection>>):

Purpose: A nested map that tracks all connected attendees, organized by language.

Outer Key: string (normalized language).

Inner Key: string (unique attendeeId).

Value: AttendeeConnection object, containing the RTCPeerConnection and RTCDataChannel specific to that attendee.

AudioMonitor (Class):

A utility class that uses the Web Audio API (AnalyserNode) to monitor the guide's microphone stream for audio activity.

It detects periods of silence and speech resumption, which are used to trigger re-sending of translation instructions to OpenAI, ensuring the session remains correctly configured.

It also handles a periodic refresh of instructions to maintain session integrity over long durations.

StatsCollector (Class):

A diagnostic utility to collect WebRTC statistics (pc.getStats()) like Round-Trip Time (RTT), packet loss, and jitter. Used for monitoring connection health.

AnswerDeduplicationManager (Class):

A singleton manager to prevent processing the same attendee connection request (answer) multiple times. This is critical in a system with dual signaling (WebSocket + HTTP Polling), where the same message could arrive through both channels.

Enterprise Modules (enterpriseConnectionManager, EnterpriseICEManager, EnterpriseSDPManager):

These modules abstract away complex or provider-specific configurations.

EnterpriseICEManager: Provides centralized, reliable RTC configuration, likely pre-configured with Xirsys STUN/TURN servers for robust NAT traversal.

EnterpriseSDPManager: Creates optimized Session Description Protocol (SDP) offers, potentially with specific codecs or settings tailored for the platform.

3. Process Flow & Lifecycle

The module operates through a well-defined lifecycle of initialization, connection management, and cleanup.

Trigger: The UI calls initGuideWebRTC when a guide starts a translation stream for a specific language.

Normalization: The provided language string is normalized (e.g., to lowercase) for consistent map keying.

Cleanup: Any existing connection for that language is torn down by calling cleanupGuideWebRTC to ensure a clean state.

Signaling: initializeSignaling is called to establish a WebSocket connection to the signaling server. The WebSocket is used for real-time exchange of SDP and ICE candidates with attendees. The module is designed to be resilient and will proceed even if WebSocket initialization fails, but with a critical warning as the HTTP polling fallback is disabled.

OpenAI Connection: The core logic is delegated to setupOpenAIConnection.

This function establishes the first hop of the audio pipeline (Guide -> OpenAI).

Authentication: Fetches a short-lived EPHEMERAL_KEY from /api/session to authenticate with the OpenAI API.

Peer Connection Creation:

An RTCPeerConnection (openaiPC) is created using a configuration from EnterpriseICEManager.

A data channel (openaiDC) is created for receiving text translations and session events from OpenAI.

Microphone Access:

The module checks if a microphone stream is already active from another language session. If so, it reuses the existing tracks to avoid multiple permission prompts and ensure consistent mute/unmute behavior.

If not, it calls navigator.mediaDevices.getUserMedia to acquire the guide's microphone audio.

The microphone tracks are added to openaiPC via pc.addTrack().

Offer/Answer Exchange with OpenAI:

An SDP offer is generated using EnterpriseSDPManager.createOptimizedOffer.

SDP Modification: The SDP is programmatically modified to:

Set the direction to a=sendrecv (the guide sends audio and receives translated audio).

Prioritize the Opus codec for high-quality audio.

The local description is set on openaiPC (setLocalDescription).

After ICE gathering is complete, the SDP offer is sent to the OpenAI Realtime API (POST https://api.openai.com/v1/realtime).

OpenAI responds with an SDP answer, which is set as the remote description on openaiPC (setRemoteDescription).

Storing the Offer for Attendees: The guide's SDP offer is sent to the application's backend (POST /api/tour/offer) and stored in Redis. This allows attendees to retrieve the offer when they join the tour.

Event Handlers:

openaiDC.onopen: When the data channel opens, sendTranslationInstructions is called to send a system prompt to OpenAI, instructing it on how to perform the translation.

openaiDC.onmessage: Handles incoming messages from OpenAI, such as text translation deltas (response.text.delta) and session status updates.

openaiPC.ontrack: This is a critical step. When OpenAI begins sending the translated audio, this event fires. The handler captures the incoming MediaStream, stores it in the corresponding OpenAIConnection object (connection.audioStream), and immediately calls forwardAudioToAttendees to ensure any already-connected attendees start receiving the audio.

This flow begins when an attendee joins the tour and their SDP answer is received by the guide's client via the signaling layer (WebSocket or HTTP polling).

Trigger: The signaling layer receives an answer and calls processAttendeeAnswer.

Deduplication: The AnswerDeduplicationManager checks if this attendee's answer has already been processed. If so, it's ignored.

Peer Connection Creation: A new, separate RTCPeerConnection (attendeePC) is created for this specific attendee.

Audio Forwarding:

The module retrieves the audioStream received from OpenAI (which was stored in Step 2.6).

The audio tracks from this stream are added to attendeePC using pc.addTrack(). This effectively pipes the translated audio from the OpenAI connection to the attendee connection.

If the audioStream is not yet available (a race condition where the attendee connects before OpenAI sends audio), a retry mechanism with a timeout is initiated.

Offer/Answer Exchange with Attendee:

The guide's role is technically the "offerer" in this leg. However, since the attendee has already provided an answer to the guide's pre-stored offer, the guide sets the attendee's answer as the remote description (setRemoteDescription).

The guide then creates its own local description (which acts as the "answer" to the attendee's "offer" in this context, completing the handshake) and sets it.

ICE Candidate Exchange:

attendeePC.onicecandidate is configured to send any generated ICE candidates to the specific attendee via the signaling layer (sendIceCandidateToAttendee).

The guide's client also polls (pollForAttendeeIceCandidates) for the attendee's ICE candidates (or receives them via WebSocket) and adds them to attendeePC via pc.addIceCandidate().

toggleMicrophoneMute(mute: boolean): This function iterates through all active openAIConnectionsByLanguage and toggles the enabled property of the microphone's MediaStreamTrack. This effectively mutes/unmutes the audio being sent to OpenAI for all languages at once.

cleanupGuideWebRTC(language?: string):

If a language is provided, it tears down the connections only for that language. If not, it cleans up everything.

It stops the AudioMonitor and any polling intervals.

It closes all related RTCPeerConnections and RTCDataChannels (for both OpenAI and all attendees of that language).

It stops the microphone tracks only if they are not being used by another active language session.

It removes the connections from the central state maps.

cleanupLanguageSession(language: string): A specific cleanup helper that removes the language entry from the AnswerDeduplicationManager to prevent memory leaks when a session ends.

4. Public API Reference

async function initGuideWebRTC(setTranslation, language, setAttendees, tourId, tourCode): Promise<void>

Initializes the entire WebRTC stack for a given language. Sets up the connection to OpenAI and prepares to accept attendee connections.

function toggleMicrophoneMute(mute: boolean): void

Enables or disables the guide's microphone track being sent to OpenAI across all active language connections.

function cleanupGuideWebRTC(specificLanguage?: string): void

Tears down and cleans up all WebRTC resources. If specificLanguage is provided, it only cleans up that session; otherwise, it cleans up all sessions.

function cleanupLanguageSession(language: string): void

Performs session-specific cleanup, primarily for the answer deduplication cache.

function getDeduplicationStats(language: string): { processedCount: number }

A debugging utility to get statistics from the answer deduplication manager.

5. Detailed Data Structures
The module's operation relies on several key interfaces that encapsulate the state for each connection.
interface OpenAIConnection: Represents the primary connection between the guide and the OpenAI API for a single language.
pc: RTCPeerConnection: The WebRTC peer connection object for this session.
dc: RTCDataChannel: The data channel for text-based communication (instructions, translation text, errors).
audioMonitor?: AudioMonitor: An instance of the AudioMonitor class, attached to the guide's microphone to detect speech and silence.
statsCollector?: StatsCollector: An instance of the StatsCollector class for gathering connection metrics.
audioElement?: HTMLAudioElement: A DOM element used to play back the incoming translated audio from OpenAI. While it's set to autoplay, its primary purpose in this architecture is to be the source for the audioStream.
audioStream?: MediaStream: The most critical property. This holds the incoming audio stream from OpenAI containing the real-time translation. It is the source for all outbound attendee connections.
microphoneTracks?: MediaStreamTrack[]: A reference to the guide's local microphone tracks. Stored for shared use across languages and for proper cleanup.
answerPollInterval?: NodeJS.Timeout: The timer ID for the legacy HTTP polling mechanism to fetch attendee answers (used as a fallback if WebSocket fails).
signalingClient?: any: The WebSocket client instance for real-time signaling with attendees.
interface AttendeeConnection: Represents a connection from the guide to a single attendee.
pc: RTCPeerConnection: The peer connection object for this specific attendee.
dc: RTCDataChannel: The data channel used to send text translations to the attendee.
iceMonitor?: any: An instance of the ICEMonitor to watch for connection timeouts and failures for this specific attendee link.
interface AttendeeAnswerData: A standardized, type-safe interface for attendee answers received from the signaling layer.
attendeeId: string: The unique identifier for the connecting attendee.
answer: RTCSessionDescriptionInit | string: The SDP answer from the attendee, which can be a direct object or a JSON string.
timestamp?: number: An optional timestamp for logging and debugging.
6. Signaling Mechanism: A Hybrid Approach
The system employs a robust, dual-channel signaling strategy to exchange SDP and ICE candidates between the guide and attendees.
Primary Channel (WebSocket):
Provider: webrtcSignaling.ts
Purpose: Provides a low-latency, real-time, bi-directional communication channel. This is the preferred method for exchanging ICE candidates and answers.
Workflow:
Upon initialization, the guide connects to a language-specific room on the signaling server.
The signalingClient listens for answer and ice-candidate events from attendees.
When the guide generates an ICE candidate for an attendee, it calls signalingClient.sendIceCandidate(), which sends the candidate directly to the target attendee's WebSocket client.
Resilience: The signaling client has a built-in retry mechanism for sending messages, but the initial connection is treated as critical.
Fallback & Persistence Channel (Redis + HTTP API):
Purpose: Serves as a persistent store and a reliable fallback. An attendee might connect via HTTP before their WebSocket is established, or a WebSocket message might be dropped. Storing signaling data in Redis ensures it is never lost.
Workflow:
Offer: The guide's initial SDP offer is always stored in Redis via POST /api/tour/offer.
Answer: Attendees post their SDP answer to Redis. The guide's client has a legacy poller (pollForAttendeeAnswers) that periodically fetches these answers via GET /api/tour/answer. This polling is a secondary mechanism to the WebSocket listener.
ICE Candidates:
Guide -> Attendee: After attempting to send via WebSocket, the guide always stores its ICE candidate in Redis via POST /api/tour/ice-candidate. This guarantees delivery even if the WebSocket send fails.
Attendee -> Guide: The guide polls for attendee candidates via GET /api/tour/attendee-ice or receives them via WebSocket. The polling is crucial for bootstrapping the connection if the attendee's WebSocket isn't ready. Polling for a specific attendee stops once their ICE connection is established.
This hybrid model combines the speed of WebSockets with the reliability of a persistent datastore, making the connection process highly resilient to network and timing issues.
7. Error Handling, Recovery, and Resilience
The module is designed to be highly resilient, with several layers of error handling and automatic recovery.
ICE Connection Failures:
Timeout Monitoring: Each attendee connection is wrapped in an ICEMonitor. If a connection doesn't reach the connected state within a 30-second timeout, it's considered failed, logged with a detailed analysis, and cleaned up automatically.
Automatic ICE Restarts: The createAttendeeConnection function implements a sophisticated, research-based ICE restart protocol. If an ICE connection enters a failed or disconnected state, or if an insufficient number of ICE candidates are generated, it will automatically trigger an ICE restart. This is done by creating a new offer with the iceRestart: true flag and using an exponential backoff delay to avoid overwhelming the network. This can recover connections dropped due to transient network changes (e.g., switching from Wi-Fi to cellular).
Connection Keepalive: Once an attendee connection is established, a keepaliveInterval is started. It periodically calls getStats(), which is a lightweight operation that keeps the NAT/firewall pinhole open, preventing the connection from timing out due to inactivity on quiet networks.
Race Conditions and Timing Issues:
Answer Deduplication: The AnswerDeduplicationManager is a critical component that prevents race conditions between the WebSocket and HTTP polling channels. It ensures that an attendee's connection request (their SDP answer) is processed only once, even if it arrives multiple times.
Delayed OpenAI Audio Stream: A common race condition occurs if an attendee connects before the guide has received the translated audio stream from OpenAI. The processAttendeeAnswer function handles this gracefully. If the audioStream is not yet available, it initiates a retry loop that waits for the stream to arrive before proceeding to add the audio track to the attendee's connection.
API and Authentication Failures:
Ephemeral Key: If the initial fetch for the OpenAI EPHEMERAL_KEY fails, the entire setupOpenAIConnection process is aborted, and an error is thrown, preventing further execution with invalid credentials.
SDP Storage: The code includes a retry loop with exponential backoff when storing the SDP offer in Redis, handling transient backend API failures.
8. Performance and Audio Quality Optimizations
Several key optimizations are implemented to ensure high-quality, low-latency audio transmission while minimizing resource consumption.
Microphone Stream Reuse: By checking for existing microphoneTracks from other language sessions, the module avoids redundant getUserMedia calls. This provides a better user experience (no multiple permission prompts) and conserves CPU/memory resources.
Optimized Audio Constraints: When calling getUserMedia, specific constraints are requested:
sampleRate: 16000: 16kHz is the optimal sample rate for speech-to-text engines like OpenAI's, providing sufficient quality for recognition without the overhead of higher fidelity audio.
channelCount: 1: Mono audio is used, as stereo provides no benefit for translation and doubles the bandwidth.
echoCancellation, noiseSuppression, autoGainControl: Standard browser features are enabled to provide a cleaner audio signal to the API, improving translation accuracy.
SDP Manipulation for Quality:
Codec Prioritization: The SDP offer sent to OpenAI is programmatically modified to move the Opus codec to the top of the priority list. Opus is a highly efficient, variable-bitrate codec ideal for real-time voice.
Directionality: The SDP direction is explicitly set to a=sendrecv, which is a requirement for the Guide <-> OpenAI connection.
Server-Side Voice Activity Detection (VAD): Instructions sent to OpenAI configure server_vad with a silence_duration_ms of 300ms. This tells the API to detect short pauses in the guide's speech and finalize the translation segment quickly, leading to a more responsive, conversational feel for the attendees.
9. Security Considerations
Security is a foundational aspect of the module's design.
Encryption: All WebRTC media streams are encrypted end-to-end using DTLS-SRTP, which is a mandatory part of the WebRTC standard. Signaling communication is secured via HTTPS and WebSocket Secure (WSS).
Authentication:
OpenAI API: Communication is authenticated using a short-lived, single-use EPHEMERAL_KEY fetched from a secure backend endpoint.
Internal APIs: All calls to the application's backend API (/api/tour/*) are made with credentials: 'include', ensuring they are authenticated using the guide's session cookie or JWT.
TURN Server Security: The Xirsys TURN servers provided by the EnterpriseICEManager require time-limited credentials. This prevents unauthorized third parties from using the application's relay servers to tunnel traffic.
Data Isolation: The use of Map data structures keyed by language and attendeeId ensures strict data sandboxing. A connection for one attendee has no access to the data or peer connection of another.
10. Diagnostics and Maintainability
The code is written with debugging and long-term maintenance in mind.
Structured Logging: Nearly every significant operation logs its status to the console. All logs are prefixed with a langContext (e.g., [spanish]), making it easy to filter the console and trace the lifecycle of a single language session, even when multiple are running concurrently.
State Change Monitoring: All iceConnectionState, connectionState, and iceGatheringState changes are logged, providing a clear audit trail for diagnosing connectivity problems.
Dedicated Verification Function: The verifyOpenAIAudio function is a powerful diagnostic tool. It can be called to inspect the incoming stream from OpenAI, checking critical properties like readyState, enabled, and muted to quickly identify why attendees might not be hearing audio.
Clear Modularity: The logic is broken down into well-defined functions (setupOpenAIConnection, processAttendeeAnswer, createAttendeeConnection, etc.) and helper classes (AudioMonitor, AnswerDeduplicationManager), making the codebase easier to understand, test, and refactor.
11. External Dependencies and APIs
The module's functionality is dependent on a set of external and internal services.
Backend APIs:
GET /api/session: Fetches the ephemeral key required for OpenAI API authentication.
POST /api/tour/offer: Stores the guide's SDP offer in Redis for attendees to fetch.
GET /api/tour/answer: Polls for attendee SDP answers stored in Redis.
POST /api/tour/ice-candidate: Stores the guide's ICE candidates in Redis.
GET /api/tour/attendee-ice: Polls for an attendee's ICE candidates stored in Redis.
Signaling Server (WebSocket): A separate server (not defined in this file) that manages WebSocket connections and message relaying between clients in a room.
External Services:
OpenAI Realtime API: The core AI service that performs the speech-to-text and translation.
Xirsys (or similar TURN provider): Provides the STUN and TURN servers necessary for NAT traversal, managed via the EnterpriseICEManager.
Browser APIs:
RTCPeerConnection, RTCDataChannel, RTCSessionDescription, RTCIceCandidate
navigator.mediaDevices.getUserMedia
Web Audio API (AudioContext, AnalyserNode)

12. Architectural Decisions and Rationale
The design of GuideWebRTC.ts incorporates several key architectural decisions, each with specific trade-offs. Understanding the rationale behind these choices is crucial for maintaining and evolving the system.
Decision: Two-Hop (Guide-as-Forwarder) Architecture
Description: The guide's browser acts as a lightweight media forwarder. It establishes one connection to receive translated audio from OpenAI and separate connections to send that audio to each attendee.
Rationale/Pros:
Reduced Infrastructure Complexity & Cost: This model avoids the need for a dedicated, expensive media server (like an SFU or MCU). The forwarding logic is handled entirely on the client-side, leveraging the guide's existing browser and network connection.
Rapid Prototyping and Deployment: It simplifies the backend architecture significantly, allowing for faster development and deployment, as the only server-side components needed are for signaling and authentication.
End-to-End Encryption (in segments): The media is encrypted on both hops (Guide <-> OpenAI and Guide <-> Attendee), maintaining a strong security posture, although the guide's client does decrypt and re-encrypt the media.
Trade-offs/Cons:
Scalability Bottleneck: The primary limitation is the guide's upload bandwidth. The required upload speed scales linearly with the number of attendees: Required Upload BW ≈ (BW_to_OpenAI) + (N_attendees * BW_per_attendee). This practically limits the number of attendees a single guide can support.
Single Point of Failure: The guide's client (browser and computer) and their network connection are a single point of failure. If their browser crashes or network degrades, the stream is lost for all attendees of that language.
Decision: Hybrid Signaling (WebSocket + Redis/HTTP Polling)
Description: A primary, low-latency WebSocket channel is used for real-time message delivery, while a persistent Redis-backed HTTP API serves as a robust fallback and initial state store.
Rationale:
Reliability over Latency: For the initial connection setup (offer/answer exchange), absolute reliability is more critical than millisecond latency. Storing offers in Redis guarantees that an attendee can join even if their WebSocket connection is delayed or fails.
Resilience to Race Conditions: This model gracefully handles scenarios where an attendee's HTTP request for an offer/candidate arrives before their WebSocket client is fully initialized and subscribed to the room.
Decoupled Connection Flow: It allows the guide and attendee to proceed with the connection handshake asynchronously, without being strictly dependent on the WebSocket channel being live for both parties at the exact same moment.
Decision: Client-Side SDP Manipulation
Description: Instead of relying on the browser's default SDP generation, the code programmatically modifies the SDP to enforce specific settings.
Rationale:
Enforced Quality of Service: It ensures that the most optimal codec (Opus) is prioritized for the connection with OpenAI. This provides a level of control that cannot be guaranteed by default browser behavior, which may vary.
Compatibility and Correctness: It allows for explicit setting of session attributes, such as the a=sendrecv direction, which is a strict requirement for the OpenAI Realtime API and might not be the default for a connection where only one track is initially added. This prevents common connection issues rooted in incorrect session negotiation.
13. Known Limitations and Scaling Considerations
While robust for its intended use case, the current architecture has inherent limitations.
Guide's Client-Side Resource Load: The guide's browser is responsible for managing N+1 peer connections (1 for OpenAI, N for attendees) per language. This consumes significant CPU for audio encoding/decoding and memory for connection state. Supporting multiple high-attendee languages simultaneously on a mid-range machine could lead to performance degradation (e.g., UI lag, audio stutter).
Latency Accumulation: The total latency perceived by an attendee is the sum of latencies across both hops:
Total Latency ≈ T(guide→openai) + T(openai_processing) + T(openai→guide) + T(guide→attendee)
While each hop is low-latency, they are additive. This makes the architecture more sensitive to network degradation on the guide's side compared to a direct-to-server model.
Dependency on OpenAI API Performance: The quality and responsiveness of the translation are entirely dependent on the performance of the OpenAI Realtime API. Any degradation, rate limiting, or outage at the API level will directly impact the user experience, and this module has no ability to mitigate it.
Limited Diagnostic Visibility: While client-side logging is extensive, there is no centralized, server-side visibility into the health of all active WebRTC connections. Diagnosing a widespread issue requires collecting logs from individual client machines.
14. Role of Enterprise Abstraction Modules
The imports from ./enterprise* files represent a key design pattern for building scalable, maintainable, enterprise-grade software.
Purpose: To decouple the core application logic (GuideWebRTC.ts) from specific, third-party service implementations and configurations. This adheres to the Dependency Inversion Principle.
EnterpriseICEManager:
Role: Acts as a centralized factory or provider for RTCConfiguration objects.
Benefits:
Centralized Credentials: It encapsulates the logic for fetching and managing time-sensitive TURN server credentials (e.g., from a Xirsys or Twilio API call), removing this responsibility from the core WebRTC file.
Provider Agnosticism: The application can switch its TURN provider by changing only the implementation within EnterpriseICEManager, with no changes needed in GuideWebRTC.ts.
Configuration Optimization: It can provide different configurations based on context (e.g., a larger iceCandidatePoolSize for connections that need faster setup).
EnterpriseSDPManager:
Role: Encapsulates the "best practices" and business logic for creating SDP offers.
Benefits:
Separation of Concerns: It isolates the complex and often fragile logic of SDP manipulation (like codec prioritization) from the orchestration logic in the main file.
Consistent Offers: Ensures that every SDP offer generated by the application adheres to a consistent, optimized standard, reducing negotiation errors.
Testability: The logic for creating and modifying SDPs can be unit-tested in isolation.