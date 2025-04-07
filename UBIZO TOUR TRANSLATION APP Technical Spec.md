Ubizo Tour Translation App - Complete Technical Specification
1. Overview
1.1 Purpose
The Ubizo Tour Translation App enables real-time multilingual communication between tour guides and attendees using OpenAI’s Realtime WebRTC API for ultra-low-latency voice-to-voice translation. The system ensures seamless translation of spoken content into multiple languages simultaneously while maintaining high audio quality and minimal delay.

1.2 Target Audience
Primary Users: Tour guides and attendees in small-group tours.

Secondary Users: Administrators managing backend infrastructure, analytics, and session monitoring.

2. Core Architecture
2.1 System Components
Component	Technology	Purpose
Frontend (Guide & Attendee)	Next.js, React, WebRTC	UI, real-time audio streaming, session management
Backend API	Next.js API Routes, Node.js	Session management, authentication, key rotation
Signaling Server	WebSocket (Socket.io)	WebRTC peer negotiation
Database	Supabase	Persistent session & user data
Real-time Cache	Redis	Active session tracking, language routing
Translation API	OpenAI Realtime WebRTC API	Speech-to-speech translation
TURN/STUN Servers	Coturn (self-hosted), Google STUN	NAT traversal for WebRTC
Deployment	Docker, Kubernetes	Scalable cloud deployment
3. Detailed Functional Requirements
3.1 Guide Functionality
1. Tour Session Creation
Frontend (app/guide/page.tsx):

Input field for tour name + "Create Tour" button.

On click → POST /api/tour/create.

Backend (app/api/tour/create/route.ts):

JWT auth → Generate TourID (UUID) → Store in Supabase (tour_sessions).

Return TourID + optional shareable code.

2. WebRTC Audio Streaming
Guide Device (lib/guideWebRTC.ts):

Toggle mic (push-to-talk or continuous).

Prepend OpenAI instruction (once per language):

typescript
Copy
if (!sentInstructions.has(language)) {
  sendAudioSegment(loadInstruction(language));
  sentInstructions.add(language);
}
Manage WebRTC connections:

1 sendonly connection per language to OpenAI.

Forward translations to attendees via Redis-routed P2P WebRTC.

3. Attendee Language Management
Redis Structure:

json
Copy
{
  "tour:{TourID}": {
    "attendees": {
      "AttendeeID1": "french",
      "AttendeeID2": "german"
    }
  }
}
Guide polls /api/tour/{TourID}/attendees or uses WebSocket updates.

3.2 Attendee Functionality
1. Joining a Tour
Frontend (app/attendee/page.tsx):

Input for TourID/QR scan → POST /api/tour/join.

Backend (app/api/tour/join/route.ts):

Validate TourID → Store attendee in Supabase + Redis.

2. Language Selection
Dropdown UI → POST /api/attendee/language → Update Redis.

3. Real-Time Translation Reception
WebRTC Flow:

Attendee selects language (e.g., Spanish).

Guide’s device receives OpenAI Spanish translation.

Guide forwards audio via WebRTC to all Spanish-speaking attendees.

Attendees play stream via <audio> element.

4. Asking Questions
Push-to-talk → WebRTC stream to guide.

Prepend reverse instruction (e.g., spanish_to_english_instruction.mp3).

4. Enhanced Technical Implementation
4.1 Audio Processing Pipeline
Step	Action	Tech Used
1. Mic Capture	getUserMedia with noise suppression	WebRTC
2. Instruction Prepend	One-time per language	AudioContext
3. OpenAI Streaming	Send via WebRTC	RTCPeerConnection
4. Translation Routing	Redis → Attendee WebRTC	P2P
4.2 Ephemeral Key Management
Backend Service (lib/keyManager.ts):

typescript
Copy
// Proactive rotation (45s intervals)
const keyManager = new EphemeralKeyManager({
  minPoolSize: 3,
  maxPoolSize: 5,
  refreshInterval: 45000,
  onError: (err) => {
    // Exponential backoff
    this.retryInterval = Math.min(this.retryInterval * 2, 300000);
  }
});

// Fetch key for WebRTC session
app.post("/api/webrtc/key", (req, res) => {
  res.json({ key: keyManager.getValidKey() });
});
4.3 Connection Pooling & Degradation
Guide Device (lib/connectionPool.ts):

typescript
Copy
class ConnectionPool {
  private maxConnections = 20;
  private connections: Map<string, RTCPeerConnection> = new Map();

  getConnection(key: string): RTCPeerConnection {
    if (!this.connections.has(key) && this.connections.size < this.maxConnections) {
      this.connections.set(key, new RTCPeerConnection(config));
    }
    return this.connections.get(key)!;
  }

  // Graceful degradation
  enforceLimits() {
    if (this.connections.size >= this.maxConnections * 0.9) {
      closeOldestInactiveConnection();
    }
  }
}
5. Error Handling & Recovery
Error Scenario	Recovery Action
Microphone permission denied	Show permissions modal → reload on grant.
ICE failure	RTCPeerConnection.restartIce() + 3 retries.
OpenAI quota exceeded	Queue translations, notify guide.
WebRTC connection limit	Close oldest inactive connection.
Network dropout	Buffer audio → auto-reconnect.
UI Integration (components/ErrorHandler.tsx):

tsx
Copy
<ErrorHandler 
  error={currentError}
  actions={{
    "microphone_permission_denied": () => reloadPage(),
    "ice_failure": () => reconnectWebRTC()
  }}
/>
6. Deployment & Scaling
6.1 Infrastructure
Component	Deployment	Scaling Strategy
Frontend	Vercel/Cloudflare	CDN caching
Backend	Kubernetes pods	Horizontal pod autoscaling
Redis	Managed cluster (Upstash)	Sharding
TURN	Regional Coturn servers	Load balancing
6.2 CI/CD Pipeline
mermaid
Copy
graph LR
  A[Git Push] --> B[Run Tests]
  B --> C[Build Docker Images]
  C --> D[Deploy to Staging]
  D --> E[Manual Approval]
  E --> F[Rollout to Production]
7. Security
Data Encryption: DTLS-SRTP (WebRTC default).

Auth: JWT with 15m expiry + secure cookies.

API Keys: Backend-only storage + rotation.

Monitoring: Prometheus alerts for anomalous traffic.

8. Appendix: Full File Structure
Copy
ubizo-app/
├── app/
│   ├── guide/
│   │   └── page.tsx          # Guide UI
│   ├── attendee/
│   │   └── page.tsx          # Attendee UI
│   └── api/
│       ├── tour/
│       │   ├── create/route.ts
│       │   └── join/route.ts
│       └── webrtc/key/route.ts
├── lib/
│   ├── guideWebRTC.ts        # Guide WebRTC logic
│   ├── attendeeWebRTC.ts     # Attendee WebRTC logic
│   ├── redis.ts              # Redis session management
│   └── keyManager.ts         # Ephemeral key rotation
├── public/
│   └── instructions/         # Preloaded OpenAI instruction audios
└── infra/
    ├── docker-compose.yml    # TURN + signaling
    └── k8s/                  # Kubernetes manifests
This spec provides a complete, production-ready blueprint for the Ubizo app.


$$$$$
Based on the code analysis, here's how the translation flow works from guide to attendees:

Guide's Audio Capture & Processing:
Guide's Microphone

AudioMonitor

TranslationHandler

WebRTC Data Channel

OpenAI API

Translation Distribution Flow:
Language 1

Language 2

Language N

OpenAI Translation

Guide's WebRTC

Redis Channel

Tour-specific Channel

Attendee 1

Attendee 2

Attendee N

The process works as follows:

Guide's Audio Capture:

Audio is captured in high quality (16kHz mono)
TranslationHandler processes audio into 16-bit PCM
Audio data is sent through WebRTC to OpenAI
OpenAI Translation:

OpenAI receives audio and returns translations
Translations come as delta updates via data channel
Guide's WebRTC handles these in onmessage event
Redis Distribution:

Each tour has language-specific Redis channels
Format: tour:{tourId}:{language}:answers
Translations are pushed to these channels
Each attendee subscribes to their language channel
Attendee Reception:

Attendees connect via WebRTC for their language
They receive translations through data channel
TranslationOutput component displays the text
Audio verification ensures connection quality
This creates a scalable one-to-many system where:

One guide can broadcast to multiple languages
Each language has its own Redis channel
Attendees receive only their selected language
System handles reconnections and failures gracefully


######

Redis Schema Updates:
tour:{tourId}:supported_languages - Set of supported languages
tour:{tourId}:attendees - Hash of attendee details including names
tour:{tourId}:language:{lang}:attendees - Set of attendees per language
WebRTC Connection Flow:
Supported

Attendee Joins

Submit Name & Language

Check Language Support

Store Attendee Info

Initialize WebRTC

Guide Receives Join Event

Update Attendee List


