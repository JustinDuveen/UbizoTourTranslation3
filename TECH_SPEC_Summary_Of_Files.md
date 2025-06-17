Hi Sabu
Here is a detailed analysis of the main components of our Tour Translation App which have all been built so far  (there are many others, but this is the main "meat" of our app:
TECH SPEC SUMMARY OF FILES FOR UBIZO TOUR TRANSLATOR APP:

Summary of GuidePage Component and Guide-Side WebRTC Implementation
This section summarizes the `app/guide/page.tsx` component and the `lib/guideWebRTC.ts` module, which together handle the guide-side functionality of the Ubizo Tour Translator application.
**app/guide/page.tsx: Summary of GuidePage Component**
This React component provides the interface for tour guides to start and manage tours.
Key Functionality:
*   Manages the guide's connection to the OpenAI translation service via WebRTC.*   Handles language selection for the tour.*   Displays a list of attendees connected to the tour.*   Provides controls to start and end the tour.*   Displays the translated text output.*   Provides error handling for connection issues and tour management.*   Generates and displays the tour code for attendees to use.
Required Variables/Props:
The component relies on several internal state variables:
*   `translation`: Stores the current translated text (string).*   `language`: Tracks the selected language for translation (string).*   `attendees`: Stores a list of attendee IDs connected to the tour (string[]).*   `isLoading`: Manages loading state (boolean).*   `error`: Stores error messages (string | null).*   `isTourActive`: Tracks whether the tour is currently active (boolean).*   `isTourEnding`: Tracks whether the tour is intentionally ending (boolean).*   `tourCode`: Stores the tour code generated for the tour (string | null).*   `tourCreated`: Tracks whether the tour has been created (boolean).*   `copySuccess`: Stores a message indicating whether the tour code was successfully copied to the clipboard (string).
External Dependencies:
*   `useRouter` from Next.js for navigation.*   Custom WebRTC functions (`initGuideWebRTC`, `cleanupGuideWebRTC`) from `lib/guideWebRTC.ts`.*   UI components (`LanguageSelector`, `TranslationOutput`, `TourControls`, `AttendeeList`, `Alert`, `Button`).
Key Features:
*   Role verification (ensures user is a guide).*   Language selection dropdown.*   Tour start and end controls.*   Attendee list display.*   Tour code generation and display.*   Connection management to OpenAI translation service.*   Error handling for various scenarios.
The component automatically checks the user's role on mount and provides controls for guides to start and end tours. 
It uses the `initGuideWebRTC` function to establish the WebRTC connection with the OpenAI translation service and handles potential errors during the connection process. 
The component also displays a loading message while the connection is being established.
**lib/guideWebRTC.ts: Summary of Guide-Side WebRTC Implementation**
This module handles the guide-side WebRTC functionality, including connecting to the OpenAI translation service, managing attendee connections, and forwarding translated audio and text to attendees.
Key Functionality:
*   Connects to the OpenAI translation service via WebRTC.*   Manages attendee connections for each language.*   Forwards translated audio and text to attendees.*   Handles audio instructions for attendees.*   Provides functions for cleaning up WebRTC connections.*   Refreshes ephemeral keys for secure communication with OpenAI.
Core Components:
*   `openaiConnections`: A map of language to OpenAI connections (`Map<string, OpenAIConnection>`).*   `attendeeConnectionsByLanguage`: A map of language to a set of attendee connections (`Map<string, Set<AttendeeConnection>>`).*   `allAttendees`: A map of attendee ID to language (`Map<string, string>`).
Main Functions:
*   `initGuideWebRTC(setTranslation, language, setAttendees, tourId)`: Initializes the guide-side WebRTC connections for a specific language.*   `cleanupGuideWebRTC()`: Cleans up all WebRTC connections and intervals.
Key Processes:
1.  **OpenAI Connection Setup:**
    *   The `setupOpenAIConnection` function creates a WebRTC connection to the OpenAI translation service.    *   It fetches an ephemeral key for authentication and sets up a timer to refresh the key periodically.    *   It establishes a data channel for communication with OpenAI.    *   It sends the guide's audio to OpenAI for translation.    *   It handles incoming translated audio and text from OpenAI.2.  **Attendee Connection Management:**
    *   The `createAttendeeConnection` function creates a WebRTC offer for attendees to connect to the tour.    *   It stores the attendee offer in Redis for attendees to retrieve.    *   The `pollForAttendeeAnswers` function polls for attendee answers and ICE candidates.    *   It establishes WebRTC connections with attendees and forwards translated audio and text to them.3.  **Audio Handling:**
    *   The `loadAudioInstructions` function loads audio instructions for attendees in a specific language.    *   The audio instructions are prepended to the guide's audio stream and sent to OpenAI.    *   The `playAudioForGuide` function plays audio for the guide when no attendees are connected.4.  **Data Forwarding:**
    *   The `forwardTranslationToAttendees` function forwards translated text to all attendees of a specific language.    *   The `forwardAudioToAttendees` function forwards translated audio to all attendees of a specific language.5.  **Error Handling and Reconnection:**
    *   The `reconnect` function handles connection loss and attempts to re-establish the WebRTC connections.    *   It closes existing connections, clears intervals, and reinvokes `initGuideWebRTC`.
This module provides the core functionality for tour guides to connect to the OpenAI translation service and manage attendee connections, enabling real-time translation for tours.
[Attendee Browser]  │  ├─ (POST) /api/tour/offer?tourCode=ABC123  │     │  │     └─ [Redis] tour_codes:ABC123 → tour_789  │  └─ (WS) wss://signal/tour_789/french        │        ├─ [OpenAI] Real-time Translation        │     │        │     └─ [Guide] Audio Stream Mixing        │        └─ [Attendee] Translation Rendering
File: /app/attendee/page.tsx:
Summary of AttendeePage Component
This React component creates an interface for attendees in a "Tour Translator" application, allowing them to receive real-time audio translations during a tour.
Key Functionality:
*   Manages attendee connection to a tour guide's audio stream via WebRTC*   Handles language selection for translations*   Displays translated text output*   Provides error handling for connection issues, including invalid tour codes and connection failures.*   Role verification to ensure the user is an attendee.
Required Variables/Props:
The component relies on several internal state variables:
*   `translation`: Stores the current translated text (string).*   `language`: Tracks the selected language for translation (string).*   `isLoading`: Manages loading state (boolean).*   `error`: Stores general error messages (string or null).*   `noTourError`: Specific error for invalid tour codes or inactive tours (string or null).*   `tourId`: Stores the tour code input by the user (string or null). This is the *public* tour code.*   `connecting`: Tracks connection attempt state (boolean).
External Dependencies:
*   `useRouter` from Next.js for navigation.*   Custom WebRTC functions (`initWebRTC`, `cleanupWebRTC`) from `lib/webrtc.ts`.*   UI components (`LanguageSelector`, `TranslationOutput`, `Alert`, `Button`).
Key Features:
*   Role verification (ensures user is an attendee). Redirects unauthorized users.*   Tour code input validation.*   Language selection dropdown.*   Connection management to guide's audio stream, including handling connection errors and displaying appropriate messages.*   Loading states during initialization.
The component automatically checks the user's role on mount and provides a form for attendees to connect to a tour by entering a tour code and selecting their preferred language. 
It uses the `initWebRTC` function to establish the WebRTC connection and handles potential errors during the connection process. The component also displays a loading message while the connection is being established.
######################
Summary of API Route Handler: /app/api/tour/offer/route.ts
This is a Next.js API route handler that handles WebRTC offer exchange between guides and attendees in a tour translation system. It has two main functions:
*   **POST:** Allows guides to store WebRTC offers in Redis.*   **GET:** Allows attendees to retrieve WebRTC offers.
Key Functionality:
*   Authentication and role verification for both endpoints.*   Tour validation and attendee registration system.
Endpoints:
1.  **POST /api/tour/offer**
    *   Purpose: Store guide's WebRTC offer.    *   Authentication: Requires a valid guide token in cookies.    *   Request Body Fields:        *   `language`: Target translation language (string).        *   `offer`: WebRTC offer object (SDP) (string).        *   `tourId`: Internal ID of the current tour (string).    *   Redis Storage:        *   Stores the offer at key `tour:{tourId}:offer:{language}`.        *   Sets a 5-minute expiration (300 seconds).        *   Verifies that the tour exists before storing the offer.    *   Error Handling: Returns 401 for unauthorized access, 400 for missing parameters, and 404 if no active tour is found.2.  **GET /api/tour/offer**
    *   Purpose: Retrieve guide's WebRTC offer.    *   Authentication: Requires a valid attendee token in cookies.    *   Query Parameters:        *   `language`: Target translation language (string).        *   `tourCode`: Public tour code (string).    *   Redis Operations:        *   Converts the `tourCode` to the internal `tourId` using `tour_codes:{tourCode}`.        *   Retrieves the offer from `tour:{tourId}:offer:{language}`.        *   Checks the offer expiration (TTL).        *   Registers the attendee in the tour's attendee set if not already registered.    *   Error Handling: Returns 401 for unauthorized access, 400 for missing parameters, 404 for invalid tour code, no active tour, offer not found, or expired offer.
Common Components:
*   Shared `getUserFromHeaders()` helper for JWT authentication.*   Redis client (`getRedisClient`).*   Role verification (guide for POST, attendee for GET).
Key Features:
*   Offer Expiration: Offers automatically expire after 5 minutes.*   Attendee Registration: Attendees are automatically registered to tours when retrieving offers.*   Tour Validation: Verifies tour existence before all operations.*   Role-Based Access: Strict separation between guide and attendee endpoints.
This route facilitates the initial WebRTC connection setup by exchanging session description protocol (SDP) offers between guides and attendees, with additional tour management functionality built in. 
It uses Redis to store and retrieve offers, and JWTs for authentication.
######################
Summary of attendee-ice/route.ts API Route
This Next.js API route handles WebRTC ICE (Interactive Connectivity Establishment) candidate exchange between attendees and guides in a tour translation system.
Key Functionality:
*   POST endpoint: Allows attendees to store their ICE candidates in Redis.*   GET endpoint: Allows guides to retrieve stored ICE candidates for a specific attendee.*   Authentication and role verification for both endpoints.
Endpoints:
1.  **POST /api/attendee-ice**
    *   Purpose: Store attendee's ICE candidates.    *   Authentication: Requires a valid attendee token in cookies.    *   Request Body Fields:        *   `language`: Target translation language (string).        *   `candidate`: WebRTC ICE candidate object (JSON).        *   `tourId`: Internal ID of the current tour (string).    *   Redis Storage: Stores candidates in a list at key `tour:{tourId}:ice:attendee:{language}:{userId}`.2.  **GET /api/attendee-ice**
    *   Purpose: Retrieve attendee's ICE candidates.    *   Authentication: Requires a valid guide token in cookies.    *   Query Parameters:        *   `language`: Target translation language (string).        *   `attendeeId`: ID of the attendee (string).    *   Redis Retrieval: Gets candidates from the guide's active tour using the same key pattern as POST.
Common Dependencies:
*   `NextResponse` from Next.js.*   `headers` from Next.js for cookie access.*   `verifyToken` for JWT authentication.*   Redis client (`getRedisClient`).
Error Handling:
*   401 for unauthorized access.*   400 for missing parameters.*   404 when no active tour is found (GET only).*   500 for Redis/processing errors.
Key Redis Operations:
*   **POST:** `RPUSH` to add new ICE candidates to a language-specific attendee list.*   **GET:** `LRANGE` to retrieve all candidates for an attendee.
This route facilitates the NAT traversal process in WebRTC by exchanging network connectivity information between attendees and guides.
###################
Summary of webrtc.ts WebRTC Management Module
This module handles all WebRTC functionality for attendees in a tour translation system, managing real-time audio streaming and data channels for translations.
Key Functionality:
*   WebRTC connection establishment and management.*   Audio streaming for translated tour content.*   Data channel communication for text translations.*   Automatic reconnection on failure.*   Ephemeral key refresh mechanism.*   Connection cleanup.
Core Components:
1.  **Connection Management**
    *   `connections` Map: Tracks active WebRTC connections by language with:        *   `pc`: `RTCPeerConnection` instance.        *   `audioEl`: `HTMLAudioElement` for playback.        *   `tourCode`: Public tour identifier (string).        *   `keyRefreshTimer`: Interval timer for key refresh (`NodeJS.Timeout | null`).2.  **Main Functions:**
    *   `initWebRTC(setTranslation, language, tourCode, options?: { signal?: AbortSignal })`
        *   Initializes WebRTC connection for a specific language/tour.        *   Fetches the guide's offer from the server using the tour code and language.        *   Handles offer/answer exchange with the guide.        *   Manages ICE candidate exchange.        *   Sets up audio streaming and data channels.        *   Implements automatic reconnection.        *   Starts the ephemeral key refresh timer (every 45 seconds).    *   `reconnect(setTranslation, language)`
        *   Handles connection recovery when ICE fails.        *   Reuses the original tour code for reconnection.    *   `cleanupWebRTC()`
        *   Properly closes all active connections.        *   Clears all refresh timers.        *   Removes all connection references.
Technical Implementation:
*   Uses multiple STUN/TURN servers for reliable NAT traversal. The TURN servers require authentication with a username and password.*   Implements audio level monitoring for debugging.*   Handles autoplay restrictions gracefully.*   Manages WebRTC states and events:    *   `ontrack` (audio streaming).    *   `ondatachannel` (translation updates).    *   `oniceconnectionstatechange` (connection monitoring).    *   `onicecandidate` (NAT traversal).
**Ephemeral Key Rotation:**
The `initWebRTC` function fetches an ephemeral key from the `/api/session` endpoint and starts a timer to refresh it every 45 seconds. This key is used for authentication and authorization purposes, it is related to accessing translation services from OpenAI-Realtime-APi using WebRTC on a continuous basis throughout a tour. The key is refreshed periodically to enhance security by limiting the lifespan of any single key. 
The refreshed key is fetched but not actively used to update the existing connection, but rather for the next connection or reconnection attempt. As OpenAI-Realtime API keys expires after 60 seconds, this is crucial for keeping the WebRTC connection active.
Error Handling:
*   Comprehensive error logging throughout.*   Automatic reconnection on failure.*   Graceful handling of various WebRTC states.*   Proper cleanup of resources.
Dependencies:
*   Browser WebRTC API (`RTCPeerConnection`).*   Fetch API for server communication.*   Browser Audio API.
Key Features:
*   Bi-directional Communication:    *   Audio streaming from guide to attendee.    *   Text translation updates via data channel.*   Resilience:    *   Automatic reconnection logic.    *   ICE candidate retry mechanism.    *   Ephemeral key refresh.*   Debugging Support:    *   Extensive console logging.    *   Audio level monitoring.    *   Connection state tracking.
This module serves as the core real-time communication layer between attendees and guides, handling both the audio streaming and supplementary data transmission required for the tour translation system.
Summary of GuidePage Component and Guide-Side WebRTC Implementation
This section summarizes the `app/guide/page.tsx` component and the `lib/guideWebRTC.ts` module, which together handle the guide-side functionality of the Ubizo Tour Translator application.
**app/guide/page.tsx: Summary of GuidePage Component**
This React component provides the interface for tour guides to start and manage tours.
Key Functionality:
*   Manages the guide's connection to the OpenAI translation service via WebRTC.*   Handles language selection for the tour.*   Displays a list of attendees connected to the tour.*   Provides controls to start and end the tour.*   Displays the translated text output.*   Provides error handling for connection issues and tour management.*   Generates and displays the tour code for attendees to use.
Required Variables/Props:
The component relies on several internal state variables:
*   `translation`: Stores the current translated text (string).*   `language`: Tracks the selected language for translation (string).*   `attendees`: Stores a list of attendee IDs connected to the tour (string[]).*   `isLoading`: Manages loading state (boolean).*   `error`: Stores error messages (string | null).*   `isTourActive`: Tracks whether the tour is currently active (boolean).*   `isTourEnding`: Tracks whether the tour is intentionally ending (boolean).*   `tourCode`: Stores the tour code generated for the tour (string | null).*   `tourCreated`: Tracks whether the tour has been created (boolean).*   `copySuccess`: Stores a message indicating whether the tour code was successfully copied to the clipboard (string).
External Dependencies:
*   `useRouter` from Next.js for navigation.*   Custom WebRTC functions (`initGuideWebRTC`, `cleanupGuideWebRTC`) from `lib/guideWebRTC.ts`.*   UI components (`LanguageSelector`, `TranslationOutput`, `TourControls`, `AttendeeList`, `Alert`, `Button`).
Key Features:
*   Role verification (ensures user is a guide).*   Language selection dropdown.*   Tour start and end controls.*   Attendee list display.*   Tour code generation and display.*   Connection management to OpenAI translation service.*   Error handling for various scenarios.
The component automatically checks the user's role on mount and provides controls for guides to start and end tours. 
It uses the `initGuideWebRTC` function to establish the WebRTC connection with the OpenAI translation service and handles potential errors during the connection process. 
The component also displays a loading message while the connection is being established.
**lib/guideWebRTC.ts: Summary of Guide-Side WebRTC Implementation**
This module handles the guide-side WebRTC functionality, including connecting to the OpenAI translation service, managing attendee connections, and forwarding translated audio and text to attendees.
Key Functionality:
*   Connects to the OpenAI translation service via WebRTC.*   Manages attendee connections for each language.*   Forwards translated audio and text to attendees.*   Handles audio instructions for attendees.*   Provides functions for cleaning up WebRTC connections.*   Refreshes ephemeral keys for secure communication with OpenAI.
Core Components:
*   `openaiConnections`: A map of language to OpenAI connections (`Map<string, OpenAIConnection>`).*   `attendeeConnectionsByLanguage`: A map of language to a set of attendee connections (`Map<string, Set<AttendeeConnection>>`).*   `allAttendees`: A map of attendee ID to language (`Map<string, string>`).
Main Functions:
*   `initGuideWebRTC(setTranslation, language, setAttendees, tourId)`: Initializes the guide-side WebRTC connections for a specific language.*   `cleanupGuideWebRTC()`: Cleans up all WebRTC connections and intervals.
Key Processes:
1.  **OpenAI Connection Setup:**
    *   The `setupOpenAIConnection` function creates a WebRTC connection to the OpenAI translation service.    *   It fetches an ephemeral key for authentication and sets up a timer to refresh the key periodically.    *   It establishes a data channel for communication with OpenAI.    *   It sends the guide's audio to OpenAI for translation.    *   It handles incoming translated audio and text from OpenAI.2.  **Attendee Connection Management:**
    *   The `createAttendeeConnection` function creates a WebRTC offer for attendees to connect to the tour.    *   It stores the attendee offer in Redis for attendees to retrieve.    *   The `pollForAttendeeAnswers` function polls for attendee answers and ICE candidates.    *   It establishes WebRTC connections with attendees and forwards translated audio and text to them.3.  **Audio Handling:**
    *   The `loadAudioInstructions` function loads audio instructions for attendees in a specific language.    *   The audio instructions are prepended to the guide's audio stream and sent to OpenAI.    *   The `playAudioForGuide` function plays audio for the guide when no attendees are connected.4.  **Data Forwarding:**
    *   The `forwardTranslationToAttendees` function forwards translated text to all attendees of a specific language.    *   The `forwardAudioToAttendees` function forwards translated audio to all attendees of a specific language.5.  **Error Handling and Reconnection:**
    *   The `reconnect` function handles connection loss and attempts to re-establish the WebRTC connections.    *   It closes existing connections, clears intervals, and reinvokes `initGuideWebRTC`.
This module provides the core functionality for tour guides to connect to the OpenAI translation service and manage attendee connections, enabling real-time translation for tours.


#############################################################


