# WebRTC Implementation Guide

## Architecture Overview

The WebRTC implementation consists of several key components:

1. **Guide WebRTC Module** (`lib/guideWebRTC.ts`): Manages the guide's WebRTC connections to OpenAI and stores SDP offers in Redis
2. **Attendee WebRTC Module** (`lib/webrtc.ts`): Handles attendee connections to guides using the stored SDP offers
3. **API Endpoints**: Manage offer/answer exchange, tour management, and connection verification
4. **Redis**: Stores tour data, WebRTC offers, and attendee information
5. **UI Components**: Provide user interfaces for guides and attendees

## Key Improvements for Placeholder Handling

### 1. Enhanced Placeholder Detection

We now detect placeholder offers using multiple patterns:

```javascript
const isPlaceholder = 
  (offer.status === 'pending') || 
  (offer.offer && typeof offer.offer === 'string' && 
   offer.offer.includes('Initialized offer for')) ||
  (offer.sdp && typeof offer.sdp === 'string' && 
   !offer.sdp.includes('v='));
```

### 2. SDP Validation Function

```javascript
function validateSdpOffer(offer: any): { isValid: boolean; error?: string } {
  // Check if offer is an object
  if (!offer || typeof offer !== 'object') {
    return { isValid: false, error: 'Offer is not an object' };
  }

  // Check if it has type and sdp properties
  if (!offer.type || !offer.sdp) {
    return { isValid: false, error: 'Offer missing type or sdp properties' };
  }

  // Check if type is valid
  if (offer.type !== 'offer' && offer.type !== 'answer') {
    return { isValid: false, error: `Invalid offer type: ${offer.type}` };
  }

  // Check if sdp is a string
  if (typeof offer.sdp !== 'string') {
    return { isValid: false, error: 'SDP is not a string' };
  }

  // Check if sdp contains v= marker (required for valid SDP)
  if (!offer.sdp.includes('v=')) {
    return { isValid: false, error: 'SDP missing v= marker' };
  }

  return { isValid: true };
}
```

### 3. Exponential Backoff Implementation

```javascript
// Enhanced polling for a real offer with exponential backoff
let attempts = 0;
const maxAttempts = 15;
let pollInterval = 500; // Start with 500ms
const maxPollInterval = 5000; // Cap at 5 seconds
const backoffFactor = 1.5; // Exponential backoff factor

while (attempts < maxAttempts) {
  attempts++;
  console.log(`Polling attempt ${attempts}/${maxAttempts} (interval: ${pollInterval}ms)...`);

  // Wait before trying again with current interval
  await new Promise(resolve => setTimeout(resolve, pollInterval));

  // Increase interval for next attempt (with exponential backoff)
  pollInterval = Math.min(pollInterval * backoffFactor, maxPollInterval);

  // Try to get a fresh offer
  // ...
}
```

### 4. Connection Quality Monitoring

```javascript
function setupConnectionQualityMonitoring(language: string, setTranslation: (text: string) => void) {
  const connection = connections.get(language);
  if (!connection) return;
  
  const { pc } = connection;
  
  // Set up periodic stats collection
  const statsInterval = setInterval(async () => {
    if (!pc || pc.connectionState === 'closed') {
      clearInterval(statsInterval);
      return;
    }
    
    try {
      const stats = await pc.getStats();
      let hasActiveAudio = false;
      let packetsLost = 0;
      let packetsReceived = 0;
      
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsReceived = report.packetsReceived || 0;
          packetsLost = report.packetsLost || 0;
          hasActiveAudio = packetsReceived > 0;
          
          // Calculate packet loss percentage
          const totalPackets = packetsReceived + packetsLost;
          const lossRate = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
          
          if (lossRate > 15) {
            console.warn(`High packet loss detected (${lossRate.toFixed(2)}%)`);
          }
        }
      });
      
      // Check for audio activity
      if (!hasActiveAudio && pc.connectionState === 'connected') {
        console.warn(`No audio packets received despite connected state`);
        
        // If we've been connected for a while but have no audio, try reconnecting
        const connectionTime = Date.now() - (connection.connectionStartTime || Date.now());
        if (connectionTime > 10000) { // 10 seconds
          reconnect(setTranslation, language);
        }
      }
    } catch (error) {
      console.error(`Error collecting connection stats:`, error);
    }
  }, 5000); // Check every 5 seconds
}
```

## API Endpoints

### 1. Clear Placeholder Endpoint

```typescript
// POST /api/tour/clear-placeholder
export async function POST(request: Request) {
  try {
    // Authenticate the guide
    const user = getUserFromHeaders();
    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const { language, tourId } = body;
    if (!language || !tourId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Check if there's a placeholder offer
    const offerKey = `tour:${tourId}:offer:${language}`;
    const existingOffer = await redis.get(offerKey);
    if (!existingOffer) {
      return NextResponse.json({ message: "No offer to clear" });
    }
    
    try {
      const parsedOffer = JSON.parse(existingOffer);
      
      // Enhanced check for placeholder offers
      const isPlaceholder = 
        (parsedOffer.status === 'pending') || 
        (parsedOffer.offer && typeof parsedOffer.offer === 'string' && 
         parsedOffer.offer.includes('Initialized offer for')) ||
        (parsedOffer.sdp && typeof parsedOffer.sdp === 'string' && 
         !parsedOffer.sdp.includes('v='));
      
      if (isPlaceholder) {
        await redis.del(offerKey);
        return NextResponse.json({ 
          message: "Placeholder offer cleared successfully",
          status: "cleared"
        });
      } else {
        return NextResponse.json({ 
          message: "No placeholder offer found", 
          status: "not_placeholder"
        });
      }
    } catch (error) {
      return NextResponse.json({ 
        error: "Failed to parse existing offer",
        message: error instanceof Error ? error.message : String(error)
      }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to clear placeholder offer",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
```

### 2. Verify Offer Endpoint

```typescript
// GET /api/tour/verify-offer
export async function GET(request: Request) {
  try {
    // Authenticate the guide
    const user = getUserFromHeaders();
    if (!user || user.role !== "guide") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract and validate parameters
    const { searchParams } = new URL(request.url);
    const language = searchParams.get("language");
    const tourId = searchParams.get("tourId");

    if (!language || !tourId) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Get Redis client
    const redis = await getRedisClient();

    // Retrieve the offer from Redis
    const offerKey = `tour:${tourId}:offer:${language}`;
    const offerJson = await redis.get(offerKey);
    if (!offerJson) {
      return NextResponse.json({ 
        error: "Offer not found",
        status: "missing" 
      }, { status: 404 });
    }

    try {
      // Parse the offer JSON
      const parsedOffer = JSON.parse(offerJson);

      // Check if it's a placeholder offer
      if (parsedOffer.status === 'pending' || 
          (parsedOffer.offer && typeof parsedOffer.offer === 'string' && 
           parsedOffer.offer.includes('Initialized offer for'))) {
        return NextResponse.json({ 
          error: "Found placeholder offer",
          status: "placeholder" 
        }, { status: 400 });
      }

      // Validate the SDP offer
      const validation = validateSdpOffer(parsedOffer);
      if (!validation.isValid) {
        return NextResponse.json({ 
          error: `Invalid SDP offer: ${validation.error}`,
          status: "invalid" 
        }, { status: 400 });
      }

      // Offer is valid
      return NextResponse.json({ 
        message: "Offer verified successfully",
        status: "valid",
        offerType: parsedOffer.type
      });
    } catch (error) {
      return NextResponse.json({ 
        error: "Invalid offer format",
        message: error instanceof Error ? error.message : String(error),
        status: "parse_error"
      }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to verify offer",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
```

## UI Implementation

### Connection State Management

```typescript
// Define connection states
type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed' | 'waiting' | 'guide_not_ready';

// Connection status UI
<div className="flex items-center justify-center mb-6">
  <div className={`h-4 w-4 rounded-full mr-3 ${
    connectionState === 'connected' ? 'bg-green-500' :
    connectionState === 'connecting' ? 'bg-yellow-500 animate-pulse' :
    connectionState === 'waiting' ? 'bg-blue-500 animate-pulse' :
    connectionState === 'guide_not_ready' ? 'bg-orange-500' :
    connectionState === 'failed' ? 'bg-red-500' :
    'bg-gray-500'
  }`} />
  <span className="text-sm font-medium">
    {connectionState === 'connected' ? 'Live Translation Active' :
     connectionState === 'connecting' ? 'Connecting...' :
     connectionState === 'waiting' ? 'Waiting for guide to start broadcasting...' :
     connectionState === 'guide_not_ready' ? 'Guide has not started broadcasting yet' :
     connectionState === 'failed' ? 'Connection failed' :
     'Disconnected'}
  </span>
</div>
```

### Placeholder Offer Handling in Client

```typescript
// Handle specific error types
if (error instanceof Error) {
  if (error.message === 'PLACEHOLDER_OFFER_RECEIVED') {
    console.log(`Placeholder offer received for ${language}, will retry later`);
    setConnectionState('waiting');
    setTranslation('Waiting for the guide to start broadcasting...');
    
    // Retry with longer delay for placeholder offers
    if (attempt < 5) { // Increased max attempts for placeholder offers
      const delay = 3000 * (attempt + 1); // Longer delays for placeholder retries
      console.log(`Will retry in ${delay/1000} seconds (attempt ${attempt + 1})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return connectToGuide(tourCode, selectedLanguage, attendeeName, attempt + 1);
    }
    
    setConnectionState('guide_not_ready');
    return; // Don't throw, just show waiting state
  }
}
```

## Best Practices

1. **Always validate SDP content** before storing or using it
2. **Use exponential backoff** for retries to avoid overwhelming the server
3. **Provide clear user feedback** about connection status
4. **Log detailed information** for debugging
5. **Clean up resources** when connections are no longer needed
6. **Monitor connection quality** to detect and recover from issues
7. **Handle errors gracefully** with user-friendly messages

## Common Issues and Solutions

| Issue | Possible Causes | Solutions |
|-------|----------------|-----------|
| Placeholder offers not being replaced | Guide WebRTC connection failed | Check guide console for errors, retry connection |
| Invalid SDP content | Serialization issues, network problems | Validate SDP before storing, implement retry logic |
| Connection failures after initial success | Network instability, server issues | Implement connection quality monitoring, auto-reconnect |
| High packet loss | Network congestion, poor connectivity | Monitor packet loss, adjust audio quality, reconnect if needed |
| Audio not playing despite connected state | Browser autoplay restrictions | Implement user interaction requirement, monitor audio activity |

## Testing Recommendations

1. **Unit Tests**: Test SDP validation, placeholder detection, and error handling
2. **Integration Tests**: Test the full connection flow between guides and attendees
3. **Load Tests**: Test with multiple attendees connecting simultaneously
4. **Network Condition Tests**: Test with various network conditions (latency, packet loss)
5. **Browser Compatibility Tests**: Test across different browsers and devices
