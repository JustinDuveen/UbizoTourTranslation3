graph LR
    subgraph "Guide WebRTC Flow"
    A[initGuideWebRTC] --> B{"openaiConnections.has(language)?"}
    B -- Yes --> H[Exit]
    B -- No --> C[setupOpenAIConnection]
    B -- No --> D[createAttendeeConnection]
    C --> C1[fetchEphemeralKey]
    C1 --> C2[scheduleKeyRenewal]
    C --> C3["Create OpenAI RTCPeerConnection"]
    C --> C4["Set up ICE, connection state handlers"]
    C --> C5["Access microphone"]
    C --> C6["Create OpenAI RTCDataChannel"]
    C6 --> C7{"Data channel events (open, close, error, message)"}
    C --> C8["Create and send SDP offer to OpenAI"]
    C --> C9["Set remote description"]
    C --> C10["Handle ontrack event"]
    D --> D1["Create Attendee RTCPeerConnection"]
    D --> D2["Set up ICE handlers"]
    D --> D3["Create RTCDataChannel for translations"]
    D --> D4["Create and store attendee offer in Redis"]
    D --> D5["Handle ICE candidate exchange"]
    A --> E[pollForAttendeeAnswers]
    E --> E1["Fetch attendee answers and ICE candidates"]
    E --> E2["Set remote description for attendees"]
    A --> F["setInterval (poll for attendees)"]
    A --> G{"WebRTC initialization completed"}
    H --> I{"WebRTC initialization already exists"}
    end
    
    subgraph "Attendee Join Flow"
    AA["Attendee fetches offer from /api/tour/offer"] --> AB["Attendee sets remote description"]
    AB --> AC["Attendee generates answer"]
    AC --> AD["Attendee sends answer to /api/tour/answer"]
    AD --> AE["Exchange ICE candidates via /api/tour/ice-candidate and /api/tour/attendee-ice"]
    AE --> E
    end
    
    subgraph "Reconnection Flow"
    J[reconnect] --> J1["Close OpenAI connection"]
    J --> J2["Close all attendee connections"]
    J --> J3["Cleanup guide audio element"]
    J --> J4["Update attendees list in UI"]
    J --> J5["Clear connection interval"]
    J --> J6["Reinitialize WebRTC connections"]
    end
    
    subgraph "Cleanup Flow"
    K[cleanupGuideWebRTC] --> K1["Clear connection interval"]
    K --> K2["Cleanup guide audio elements"]
    K --> K3["Close all OpenAI connections"]
    K --> K4["Close all attendee connections"]
    end
    
    subgraph "Helper Functions"
    L[base64ToArrayBuffer]
    M[playAudio]
    M --> M1[forwardTranslationToAttendees]
    end