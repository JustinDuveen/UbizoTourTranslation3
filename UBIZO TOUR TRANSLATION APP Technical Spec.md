UBIZO APP - step by step build plan based on spec with Perplexity 5 March

## **1. Overview**

### **1.1 Purpose**
The Ubizo Tour Translation App is designed to facilitate real-time multilingual communication between tour guides and attendees. It leverages the OpenAI Realtime WebRTC API for low-latency voice-to-voice interactions.

### **1.2 Target Audience**
- **Primary Users**: Tour guides and attendees participating in small group tours.
- **Secondary Users**: Administrators managing backend infrastructure and analytics.

---

## **2. Functional Requirements**

### **2.1 Core Features**
#### **Tour Guide Functionality**
- Ability to create a unique tour session with a custom name
- Toggle functionality: Press once to activate and again to deactivate.
- Keeps the microphone active while speaking.
- Complies with OPEN-AI-REALTIME-API with WebRTC for permanent connections with peers
- Guide device first appends a default audio instruction to the beginning of the stream and sends this to the Open-AI- Realtime API to ensure valid connection
- Guide device collects language pref from attendees and ensures only one translation request per language is sent asynchronously to the OPEN-AI-REALTIME-API with WebRTC together with the correctly prepended audio translation instruction.
- Guide device acts as main hub together with Redis for sending translations to attendees based on their language (for example all Dutch speakers receive the dutch translation via WebRTC.
- Real-time translation of guide speech into multiple attendee-selected languages.
- Distribution of translated audio streams directly to attendees using WebRTC from the Guide Device with the help of Redis and using the variables for TourID and Translation Language to send the right translation to the right attendee.

#### **Attendee Functionality**
- Join a tour session by entering the tour name or scanning a QR code.
- Select a preferred language for translation upon joining.
- Activates microphone for asking questions.
- Translates attendee speech into the guide’s language in real time.
- Receive translated audio streams from the guide.

### **2.2 Additional Features**
- Dynamic management of multiple languages per session (e.g., English to French, German, etc.).
- Support for up to 20 attendees per session using Guides device with Redis only for managing the communication during the tour.
- Connection quality monitoring with real-time feedback (e.g., jitter, packet loss).
- Automatic reconnection during network disruptions.
- Ensure echo cancellation and audio cleanup options in the browser are enabled to help ensure clean audio.(do not add any other server based audio processing!!)

---

## **3. Technical Requirements**

### **3.1 Backend Infrastructure**
#### **Core Components**
1. **Signaling Server**:
- Built using Node.js with WebSocket support for managing WebRTC connections.
- Handles session creation, attendee registration, and ICE candidate exchange.
- Includes JWT-based authentication for secure signaling.

2. **Ephemeral Key Management**:
- Use OpenAI’s REST API to generate ephemeral keys for client-side authentication.
- Implement an endpoint (`/api/session`) to fetch ephemeral keys securely.
= As they are temporary (60 seconds) they need to be stored and refreshed properly

3. **Database**:
- Use Supabase (PostgreSQL) for persistent storage:
- User profiles (guides and attendees).
- Tour session details (names, timestamps).
- TourID
- Language preferences and historical logs.

4. **OpenAI Integration**:
- Real-time API for speech-to-speech translation workflows.
- Secure API key management with rate limiting.

5. **TURN/STUN Servers**:
- Self-hosted TURN servers distributed regionally for low-latency NAT traversal.
- Google’s public STUN servers as backups.

---

### **3.2 Frontend Architecture**
#### **Guide Interface**
- Web app interface with:
- Tour creation form (name input).
- Push-to-talk button with toggle functionality.
- Real-time status indicators (e.g., active attendees, connection quality).

#### **Attendee Interface**
- Web or mobile app interface with:
- Join tour form (tour name or QR code input).
- Language selection dropdown menu.
- Audio playback controls.

#### **Shared Features**
- Notifications for connection issues or translation status updates.
- Visual feedback for active microphone or translation activity.

---

### **3.3 Real-Time Translation Pipeline**
1. Capture guide/attendee audio via WebRTC RTP streams.
2. Use OpenAI’s Realtime API for speech-to-speech translation:
- Authenticate with ephemeral keys.
- Prepend default audio instruction and send audio directly to OpenAI for real-time translation via WebRTC.
- Based on Attendee languages, once for each language translation required: Prepend appropriate audio instruction and send audio directly to OpenAI for real-time translation via WebRTC (eg. english_to_dutch_Translation_Instruction.mp3. Perform this asyncronously for each language required by Attendees in that particular tour.
3. Receive translated audio from OpenAI via WebRTC and distribute it directly to the correct recipients using WebRTC P2P connections.

---

### **3.4 Deployment Architecture**
1. Use Docker containers for all components (backend, signaling server, TURN servers).
2. Orchestrate deployments using Kubernetes for scalability.
3. Monitoring & Observability:
- Prometheus + Grafana for real-time metrics on latency, jitter, packet loss.
4. CI/CD Pipeline:
- Automated testing of WebRTC components.
---

### **4.2 Security**
- DTLS-SRTP encryption for all WebRTC streams.
- Short-lived JWT tokens for authentication.
- Secure API key storage with rotation policies.

### **4.3 Reliability**
- Automatic reconnection with session persistence during network disruptions.
- Circuit breaker patterns to prevent cascading failures in case of API outages.


##### CURRENT PROJECT DIRECTORY STRUCTURE FOR REFERENCE:

.
├── .cursorrules.txt
├── .gitignore
├── AIexplantionforfiles.md
├── middleware.ts
├── next.config.js
├── next.config.mjs
├── Open_AI_Realtime_API_USING_WEBRTC_Setup.md
├── package-lock.json
├── package.json
├── postcss.config.mjs
├── tailwind.config.js
├── testred.js
├── tsconfig.json
├── UBIZO TOUR TRANSLATION APP Technical Spec.pdf
├── app
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   ├── api
│   │   ├── auth
│   │   │   ├── check
│   │   │   │   └── route.ts
│   │   │   ├── login
│   │   │   │   └── route.ts
│   │   │   └── register
│   │   │       └── route.ts
│   │   ├── session
│   │   │   └── route.ts
│   │   └── tour
│   │       ├── answer
│   │       │   └── route.ts
│   │       ├── attendee-ice
│   │       │   └── route.ts
│   │       ├── end
│   │       │   └── route.ts
│   │       ├── guide-ice
│   │       │   └── route.ts
│   │       ├── ice-candidate
│   │       │   └── route.ts
│   │       ├── join
│   │       │   └── route.ts
│   │       ├── offer
│   │       │   └── route.ts
│   │       └── start
│   │           └── route.ts
│   ├── attendee
│   │   └── page.tsx
│   ├── guide
│   │   └── page.tsx
│   ├── login
│   │   └── page.tsx
│   └── register
│       └── page.tsx
├── components
│   ├── AttendeeList.tsx
│   ├── GuideWebRTCManager.tsx
│   ├── LanguageSelector.tsx
│   ├── theme-provider.tsx
│   ├── TourControls.tsx
│   ├── TranslationOutput.tsx
│   └── ui
│       ├── accordion.tsx
│       ├── alert-dialog.tsx
│       ├── alert.tsx
│       ├── aspect-ratio.tsx
│       ├── avatar.tsx
│       ├── badge.tsx
│       ├── breadcrumb.tsx
│       ├── button.tsx
│       ├── calendar.tsx
│       ├── card.tsx
│       ├── carousel.tsx
│       ├── chart.tsx
│       ├── checkbox.tsx
│       ├── collapsible.tsx
│       ├── command.tsx
│       ├── context-menu.tsx
│       ├── dialog.tsx
│       ├── drawer.tsx
│       ├── dropdown-menu.tsx
│       ├── form.tsx
│       ├── hover-card.tsx
│       ├── input-otp.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── menubar.tsx
│       ├── navigation-menu.tsx
│       ├── pagination.tsx
│       ├── popover.tsx
│       ├── progress.tsx
│       ├── radio-group.tsx
│       ├── resizable.tsx
│       ├── scroll-area.tsx
│       ├── select.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── sidebar.tsx
│       ├── skeleton.tsx
│       ├── slider.tsx
│       ├── sonner.tsx
│       ├── switch.tsx
│       ├── table.tsx
│       ├── tabs.tsx
│       ├── textarea.tsx
│       ├── toast.tsx
│       ├── toaster.tsx
│       ├── toggle-group.tsx
│       ├── toggle.tsx
│       ├── tooltip.tsx
│       ├── use-mobile.tsx
│       └── use-toast.ts
├── hooks
│   ├── use-mobile.tsx
│   └── use-toast.ts
├── lib
│   ├── auth.ts
│   ├── guideWebRTC.ts
│   ├── redis.ts
│   ├── supabase.ts
│   ├── utils.ts
│   └── webrtc.ts
├── pages
│   └── api
│       ├── [...nextauth].ts
│       ├── test-redis.ts
│       └── tours
│           └── [id].ts
└── public
    ├── placeholder-logo.png
    ├── placeholder-logo.svg
    ├── placeholder-user.jpg
    ├── placeholder.jpg
    ├── placeholder.svg
    └── audio
        ├── english_to_dutch_Translation_Instruction.mp3
        ├── english_to_english_Translation_Instruction.mp3
        ├── english_to_french_Translation_Instruction.mp3
        └── english_to_german_Translation_Instruction.mp3