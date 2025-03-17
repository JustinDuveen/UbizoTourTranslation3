//guideWebRTC.ts

interface OpenAIConnection { pc: RTCPeerConnection; dc: RTCDataChannel; }

This sets up a "blueprint" for how the computer will keep track of the connection to OpenAI.
pc stands for "Peer Connection," which is like a phone line for sending audio and video.
dc stands for "Data Channel," which is like a text messaging line for sending messages.
interface AttendeeConnection { id: string; pc: RTCPeerConnection; dc: RTCDataChannel; }

This is another "blueprint," but this one is for the connections to each person listening to the tour.
id is a unique name for each listener.
pc and dc are the same as before, for audio/video and messages.
const openaiConnections = new Map<string, OpenAIConnection>();

This creates a "map" (like a dictionary) that stores the connections to OpenAI for different languages.
The "key" is the language (like "Spanish"), and the "value" is the OpenAI connection.
const attendeeConnectionsByLanguage = new Map<string, Set<AttendeeConnection>>();

This creates another "map" that stores the connections to each listener, grouped by language.
For example, all the people listening in Spanish will be in one group.
const allAttendees = new Map<string, string>(); // attendeeId -> language

This map keeps track of every attendee, matching their ID to the language they are listening to.
let connectionInterval: number | null = null;

This sets up a timer that will check if the connection to OpenAI is still working.
function updateAttendeesList(setAttendees?: ((attendees: string[]) => void) | undefined) { ... }

This function updates the list of people listening to the tour.
It takes all the attendee IDs and puts them into a list.
If a part of the program is waiting for that list, this function will give it to them.
async function loadAudioInstructions(language: string): Promise<string> { ... }

This function loads a special audio file that tells OpenAI how to translate the guide's voice.
It gets the audio file from a folder and turns it into a special code (base64) that can be sent over the internet.
It loads the file for the specific language requested.
async function storeTranslationInRedis(tourId: string, language: string, translation: string): Promise<void> { ... }

This function saves the final translated text into a database (Redis) so it can be used later.
It sends the translated text to a special web address (API) that saves it.
function forwardTranslationToAttendees(language: string, translationData: any): void { ... }

This function sends the translated text or audio to all the people listening in a specific language.
It goes through each listener's connection and sends them the translation.
async function setupOpenAIConnection(language: string, setTranslation: (translation: string) => void, tourId: string): Promise<OpenAIConnection> { ... }

This is the main function that sets up the connection to OpenAI.
It gets a special "key" that lets it talk to OpenAI.
It sets up the "phone line" (Peer Connection) and the "text messaging line" (Data Channel).
It gets the guide's voice from the microphone and sends it to OpenAI.
It handles messages from OpenAI, like the translated text.
It connects to the OpenAI API using the ephemeral key.
It sets up the forwarding of the translated audio from OpenAi to the attendees.
async function createAttendeeConnection(language: string, tourId: string, openaiConnection: OpenAIConnection): Promise<void> { ... }

This function sets up the connection for each person listening to the tour.
It creates the "phone line" and "text messaging line" for the listener.
It saves the listener's connection information in the database.
It handles the process of exchanging connection details (ICE candidates) with the listener.
async function pollForAttendeeAnswers(language: string, tourId: string, setAttendees: (attendees: string[]) => void): Promise<void> { ... }

This function checks the database for new listeners who want to join the tour.
It sets up connections for each new listener and adds them to the list.
export async function initGuideWebRTC(setTranslation: (translation: string) => void, language: string, setAttendees: (attendees: string[]) => void, tourId: string) { ... }

This is the main function that starts everything.
It sets up the connection to OpenAI and prepares for listeners to join.
It starts the process of checking for new listeners.
async function reconnect(setTranslation: (translation: string) => void, language: string, setAttendees: (attendees: string[]) => void, tourId: string) { ... }

This function tries to reconnect if the connection to OpenAI is lost.
It closes all the old connections and starts them again.
export function cleanupGuideWebRTC() { ... }

This function closes all the connections and stops the timer when the tour is finished.
In simpler terms:

Imagine you have a walkie-talkie (WebRTC) that lets you talk to a robot (OpenAI) that can speak many languages. You want to use this to give a tour to people who speak different languages.

The code sets up the walkie-talkie to talk to the robot.
It loads special instructions for the robot so it knows how to translate.
It creates "listening stations" for each person on the tour.
It sends your voice to the robot, and the robot sends back the translated voice.
It sends the translated voice to each person at their listening station.
It keeps a list of everyone listening.
If the walkie-talkie stops working, it tries to fix it.
When the tour is over, it turns everything off.


##########
//middleware.ts:
This code implements a middleware for a Next.js application that handles authentication and authorization for specific routes (/guide and /attendee). It ensures that only authenticated users with the correct roles can access these routes.

Key Components
Token Verification:

The verifyToken function uses the jose library to verify JWT tokens.

It checks for the presence of a JWT_SECRET environment variable and decodes the token.

If the token is invalid or missing, it returns null.

Middleware Logic:

The middleware function intercepts requests to /guide and /attendee routes.

It checks for the presence of a token in the request cookies.

If no token is found, or if the token is invalid, the user is redirected to the /login page.

It also verifies the user's role (guide or attendee) and ensures they have access to the requested route.

Route Protection:

The middleware protects routes starting with /guide and /attendee.

Only users with the correct role (guide for /guide routes, attendee for /attendee routes) are granted access.

Edge Runtime:

The middleware is designed to run in the Edge Runtime, which is optimized for low-latency, serverless environments.

Configuration:

The config object specifies which routes the middleware should apply to (/guide, /guide/:path*, /attendee, /attendee/:path*).

Workflow
Request Interception:

The middleware intercepts requests to /guide and /attendee routes.

Token Check:

It checks for a token in the request cookies.

If no token is found, the user is redirected to /login.

Token Verification:

The token is verified using the verifyToken function.

If the token is invalid, the user is redirected to /login.

Role Validation:

The user's role is checked against the requested route.

If the role does not match (guide for /guide, attendee for /attendee), the user is redirected to /login.

Access Grant:

If all checks pass, the request is allowed to proceed.

Key Features
Authentication:

Ensures only authenticated users can access protected routes.

Authorization:

Validates user roles to ensure they have access to specific routes.

Edge Runtime Support:

Optimized for low-latency, serverless environments.

Redirection:

Redirects unauthorized users to the /login page.

Comparison to Other Code
Feature	This Code (Middleware)	Guide/Attendee Code
Purpose	Authentication and authorization.	Real-time communication and translation.
Token Handling	Verifies JWT tokens.	Uses ephemeral keys for secure communication.
Role Validation	Checks user roles (guide or attendee).	Manages WebRTC connections based on roles.
Runtime	Edge Runtime (serverless).	Standard runtime (Node.js/WebRTC).
Redirection	Redirects unauthorized users to /login.	No redirection; handles connection errors.
Conclusion
This middleware ensures secure access to /guide and /attendee routes by verifying JWT tokens and validating user roles. It is optimized for the Edge Runtime and integrates seamlessly with Next.js applications. Unlike the guide/attendee code, which focuses on real-time communication, this code is dedicated to authentication and authorization.



##########
//guide/page.tx: 

Overview
This is a Tour Guide Interface built with React and Next.js. It allows a guide to:

Start and end a tour.

Select a language for translation.

Share a unique tour code with attendees.

View real-time translations and a list of attendees.

Handle errors and loading states.

Key Features
State Management:

Uses useState and useEffect to manage:

Translation text, selected language, attendee list, loading state, errors, tour status, and tour ID.

Tracks whether the tour is active and if the tour has been created.

Tour Management:

Start Tour:

Sends a POST request to /api/tour/start with the selected language.

Initializes WebRTC for real-time communication (initGuideWebRTC).

Sets the tour ID and marks the tour as active.

End Tour:

Sends a POST request to /api/tour/end.

Cleans up WebRTC (cleanupGuideWebRTC).

Resets all tour-related states.

Real-Time Communication:

Uses WebRTC (initGuideWebRTC and cleanupGuideWebRTC) to:

Send translations to attendees.

Track attendees joining the tour.

User Role Validation:

On page load, checks if the user is a guide via /api/auth/check.

Displays an error if the user is not a guide.

UI Components:

LanguageSelector: Lets the guide choose a language.

TranslationOutput: Displays real-time translations.

TourControls: Buttons to start/end the tour.

AttendeeList: Shows a list of attendees.

Alerts: Displays success/error messages.

Utility Functions:

Copy Tour Code: Copies the tour ID to the clipboard.

Spinner: Shows a loading animation during API calls.

Error Handling
Displays errors for:

Failed tour start/end.

Invalid user role (non-guide users).

WebRTC initialization failures.

Clipboard copy failures.

Dependencies
React: For state management and UI rendering.

Next.js: For routing and API integration.

WebRTC: For real-time communication.

Lucide Icons: For UI icons (e.g., copy, alert).

Workflow
Page Load:

Checks user role.

Sets up initial state (e.g., default language, empty attendee list).

Start Tour:

Validates user, starts tour, initializes WebRTC, and generates a tour ID.

During Tour:

Displays translations and attendee list.

Allows copying the tour code.

End Tour:

Cleans up WebRTC and resets state.

Error Handling:

Displays relevant errors and redirects if necessary.

Key Functions
handleStartTour: Starts the tour and initializes WebRTC.

handleEndTour: Ends the tour and cleans up resources.

handleCopyTourCode: Copies the tour ID to the clipboard.

checkUserRole: Validates if the user is a guide.

Spinner: Displays a loading animation.

This code is a real-time tour management system for guides, with robust error handling and a clean UI.



################
/lib/webrtc.ts:

This code implements a WebRTC-based real-time communication system for attendees in a tour guide application. It enables attendees to:

Receive real-time audio translations from the guide.

Handle incremental and complete translation updates via a WebRTC data channel.

Manage ephemeral key refresh for secure communication.

Automatically reconnect if the connection is lost.

Clean up resources when the session ends.

Key Components
connections Map:

Tracks WebRTC connections for each language.

Stores:

RTCPeerConnection (WebRTC connection).

HTMLAudioElement (for playing received audio).

tourId (unique tour identifier).

keyRefreshTimer (timer for refreshing ephemeral keys).

initWebRTC Function:

Initializes WebRTC for a specific language and tour.

Steps:

Fetches an ephemeral key from /api/session for secure communication.

Sets up a key refresh timer to periodically refresh the ephemeral key.

Creates an RTCPeerConnection with STUN/TURN servers for NAT traversal.

Sets up an HTMLAudioElement to play received audio tracks.

Handles incoming audio tracks and data channel messages:

Updates translations in real-time.

Monitors audio levels for debugging.

Fetches the guide's offer, creates an answer, and sends it back.

Exchanges ICE candidates for peer-to-peer connection.

Stores the connection in the connections map.

reconnect Function:

Handles reconnection if the WebRTC connection is lost.

Closes the existing connection and reinitializes WebRTC for the same language and tour.

cleanupWebRTC Function:

Cleans up all WebRTC connections:

Closes RTCPeerConnection.

Clears key refresh timers.

Removes all entries from the connections map.

Key Features
Real-Time Audio Streaming:

Uses WebRTC to stream audio from the guide to attendees.

Automatically plays audio when received (handles autoplay restrictions).

Real-Time Translation Updates:

Uses a WebRTC data channel to send incremental and complete translation updates.

Updates the UI with new translations via the setTranslation callback.

Ephemeral Key Refresh:

Periodically refreshes the ephemeral key to maintain secure communication.

Uses a timer to fetch a new key every 45 seconds.

Connection Management:

Monitors WebRTC connection state (e.g., iceConnectionState, connectionState).

Automatically reconnects if the connection is lost.

Error Handling:

Logs errors for failed API calls, WebRTC initialization, and data channel issues.

Provides fallback mechanisms (e.g., reconnection, key refresh retries).

Workflow
Initialization:

Fetch ephemeral key.

Set up WebRTC connection with STUN/TURN servers.

Set up audio and data channel handlers.

Offer/Answer Exchange:

Fetch the guide's offer.

Create and send an answer.

Exchange ICE candidates.

Real-Time Communication:

Stream audio from the guide.

Send/receive translation updates via the data channel.

Reconnection:

If the connection is lost, close the existing connection and reinitialize WebRTC.

Cleanup:

Close all connections and clear resources when the session ends.

Dependencies
WebRTC:

For real-time audio streaming and data channel communication.

Uses STUN/TURN servers for NAT traversal.

Ephemeral Key Management:

Fetches and refreshes keys from /api/session.

Error Handling:

Logs errors and provides fallback mechanisms.

Key Functions
initWebRTC:

Initializes WebRTC for a language and tour.

Handles offer/answer exchange, ICE candidates, and real-time communication.

reconnect:

Reinitializes WebRTC if the connection is lost.

cleanupWebRTC:

Cleans up all WebRTC resources.

Comparison to Guide Code
Feature	Attendee Code	Guide Code
Role	Attendee (receives audio/translations).	Guide (sends audio/translations).
Connections	Single WebRTC connection per language.	Multiple WebRTC connections (OpenAI + attendees).
Translation Source	Receives translations from the guide.	Sends translations to attendees via OpenAI.
Audio Handling	Plays received audio tracks.	Streams audio from the guide to attendees.
Data Channel	Receives translation updates.	Sends translation updates to attendees.
Ephemeral Key Refresh	Yes, refreshes every 45 seconds.	Yes, refreshes every 45 seconds.
Error Handling	Reconnects if the connection is lost.	Reconnects and retries failed operations.
Cleanup	Cleans up WebRTC connections.	Cleans up WebRTC connections and intervals.
Conclusion
This code is a robust WebRTC implementation for attendees in a tour guide application, enabling real-time audio streaming, translation updates, and secure communication. It shares similarities with the guide code (e.g., ephemeral key refresh, error handling) but focuses on receiving data rather than sending it. Both codes work together to provide a seamless real-time experience for guides and attendees.


#############
/components/GuideWebRTCManager.tsx:

This code defines a React component (GuideWebRTCManager.tsx) that manages WebRTC connections for a tour guide. It integrates with the initGuideWebRTC and cleanupGuideWebRTC functions to handle real-time communication with attendees. The component also tracks and displays attendee information, grouped by language.

Key Components
State Management:

attendees: Tracks the list of attendee IDs.

hasAttendees: A boolean indicating whether there are any attendees.

attendeesByLanguage: Groups attendees by their selected language.

WebRTC Initialization and Cleanup:

The useEffect hook initializes WebRTC when the component mounts using initGuideWebRTC.

It also cleans up WebRTC resources when the component unmounts using cleanupGuideWebRTC.

Attendee State Update:

The updateAttendeeState function updates the component's state with the latest attendee information.

It groups attendees by language and logs updates to the console.

UI Rendering:

Displays the list of attendees using the AttendeeList component.

Conditionally renders a message if attendees are present.

Renders a list of attendees grouped by language.

Workflow
Component Mount:

Calls initGuideWebRTC to set up WebRTC connections for the specified tourId and language.

Passes setTranslation and setAttendees as callbacks to handle translation updates and attendee list updates.

Attendee List Update:

When the attendee list changes, updateAttendeeState is called to:

Update the attendees state.

Set hasAttendees based on whether there are any attendees.

Group attendees by language and update attendeesByLanguage.

UI Rendering:

Renders the AttendeeList component with the current list of attendees.

Conditionally displays a message if attendees are present.

Displays attendees grouped by language.

Component Unmount:

Calls cleanupGuideWebRTC to clean up WebRTC resources.

Key Features
Real-Time Attendee Tracking:

Tracks attendees in real-time using WebRTC.

Groups attendees by their selected language.

WebRTC Integration:

Initializes and cleans up WebRTC connections.

Handles translation updates and attendee list updates via callbacks.

Dynamic UI Updates:

Updates the UI dynamically as attendees join or leave the tour.

Displays attendee information in a structured format.

Error Handling:

Logs updates and errors to the console for debugging.

Dependencies
React:

Manages component state and lifecycle.

WebRTC:

Handles real-time communication with attendees.

AttendeeList Component:

Displays the list of attendees.

initGuideWebRTC and cleanupGuideWebRTC:

Functions for managing WebRTC connections.

Key Functions
updateAttendeeState:

Updates the component's state with the latest attendee information.

Groups attendees by language.

useEffect:

Initializes WebRTC on component mount.

Cleans up WebRTC on component unmount.

Comparison to Attendee Code
Feature	GuideWebRTCManager.tsx	Attendee Code
Role	Guide (manages WebRTC connections).	Attendee (receives audio/translations).
State Management	Tracks attendees and groups them by language.	Tracks WebRTC connections and translation state.
WebRTC Integration	Initializes and cleans up WebRTC connections.	Initializes WebRTC for receiving audio/data.
UI Rendering	Displays attendee list and grouped attendees.	Plays audio and displays translations.
Error Handling	Logs updates and errors to the console.	Logs errors and handles reconnection.
Conclusion
This component (GuideWebRTCManager.tsx) is a React-based UI manager for a tour guide's WebRTC connections. It integrates with WebRTC to track attendees, group them by language, and dynamically update the UI. Unlike the attendee code, which focuses on receiving data, this component focuses on managing and displaying attendee information in real-time.



