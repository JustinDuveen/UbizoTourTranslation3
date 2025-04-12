# WebRTC Placeholder Offer Handling

## Overview

This document describes the improved handling of WebRTC placeholder offers in the tour translation system. Placeholder offers are temporary entries created when a guide starts a tour but hasn't yet established a WebRTC connection with OpenAI for a specific language. These improvements ensure a more robust connection process between guides and attendees.

## Guide Experience

### Starting a Tour

When a guide starts a tour:

1. The system creates placeholder offers for each supported language with status "pending"
2. As the guide establishes WebRTC connections for each language, the placeholders are replaced with real SDP offers
3. The system now validates SDP offers before storing them to ensure they contain valid WebRTC data
4. If validation fails, the system will retry with exponential backoff

### Troubleshooting Guide Connections

If attendees report they cannot connect:

1. Check the guide console for any errors related to storing SDP offers
2. Verify that the WebRTC connection with OpenAI is established for the specific language
3. Try refreshing the guide interface to re-establish connections
4. Check network connectivity and firewall settings that might block WebRTC traffic

## Attendee Experience

### Joining a Tour

When an attendee joins a tour:

1. The system checks if a valid SDP offer exists for the requested language
2. If only a placeholder offer is found, the UI will show "Waiting for guide to start broadcasting..."
3. The system will automatically retry connecting with exponential backoff
4. After multiple failed attempts, the UI will show "Guide has not started broadcasting yet" with a manual retry button

### Connection States

The attendee interface now shows more detailed connection states:

- **Idle**: Initial state before attempting to connect
- **Connecting**: Actively establishing a WebRTC connection
- **Connected**: Successfully connected and receiving translations
- **Waiting**: Found a placeholder offer, waiting for the guide to start broadcasting
- **Guide Not Ready**: After multiple retries, the guide still hasn't started broadcasting
- **Failed**: Connection failed due to network or other technical issues

### Troubleshooting Attendee Connections

If an attendee cannot connect:

1. Check if the guide has started broadcasting in the selected language
2. Use the "Try Again" button if the "Guide Not Broadcasting" message appears
3. Try refreshing the page
4. Try a different browser or device
5. Check network connectivity and firewall settings

## Technical Details

### Placeholder Detection

The system now detects placeholder offers using multiple patterns:

```javascript
const isPlaceholder = 
  (offer.status === 'pending') || 
  (offer.offer && typeof offer.offer === 'string' && 
   offer.offer.includes('Initialized offer for')) ||
  (offer.sdp && typeof offer.sdp === 'string' && 
   !offer.sdp.includes('v='));
```

### SDP Validation

Valid SDP offers must:

1. Be a proper object with `type` and `sdp` properties
2. Have a valid `type` value ('offer' or 'answer')
3. Have an `sdp` property that is a string
4. Include the 'v=' marker required for valid SDP content

### Polling Mechanism

Both the guide and attendee sides implement polling with exponential backoff:

1. Start with a short initial delay (500ms)
2. Increase the delay by a factor (1.5) after each attempt
3. Cap the maximum delay (3-5 seconds)
4. Limit the total number of attempts (8-15)

### Redis Key Management

The system uses consistent Redis key patterns:

- Offer storage: `tour:{tourId}:offer:{language}`
- Language attendees: `tour:{tourId}:language:{language}:attendees`
- Supported languages: `tour:{tourId}:supported_languages`

## API Endpoints

### `/api/tour/clear-placeholder`

- **Method**: POST
- **Purpose**: Clears placeholder offers before storing real offers
- **Authentication**: Guide only
- **Parameters**: `tourId`, `language`

### `/api/tour/verify-offer`

- **Method**: GET
- **Purpose**: Verifies that offers are stored correctly
- **Authentication**: Guide only
- **Parameters**: `tourId`, `language`

### `/api/tour/offer`

- **Method**: GET/POST
- **Purpose**: Retrieves/stores WebRTC offers
- **Authentication**: Attendee (GET), Guide (POST)
- **Parameters**: `tourCode`, `language`, `attendeeName` (GET), `tourId`, `language`, `offer` (POST)

### `/api/tour/join`

- **Method**: GET
- **Purpose**: Joins a tour and retrieves the WebRTC offer
- **Authentication**: Attendee
- **Parameters**: `tourCode`, `language`

## Error Handling

The system now handles errors more gracefully:

1. **Placeholder Offers**: Detected and handled with automatic retries
2. **Invalid SDP**: Validated and rejected with clear error messages
3. **Network Errors**: Handled with retry logic and exponential backoff
4. **User Feedback**: Clear UI states and messages for different error conditions

## Monitoring

To monitor the system:

1. Check Redis for placeholder vs. real offers
2. Monitor WebRTC connection success rates
3. Track error rates and types in the browser console and server logs
4. Watch for patterns of failed connections by language or device type

## Future Improvements

Potential future enhancements:

1. Real-time status dashboard for guides to see which languages are broadcasting
2. Automatic recovery for failed OpenAI connections
3. More detailed diagnostics for WebRTC connection issues
4. Fallback mechanisms for environments where WebRTC is blocked
