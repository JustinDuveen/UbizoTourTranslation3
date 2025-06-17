/**
 * Xirsys TURN/STUN Server Configuration Module
 * Expert WebRTC integration for production-grade connectivity
 */

// Cache for ICE servers to avoid API rate limits
interface CachedICEServers {
  servers: RTCIceServer[];
  timestamp: number;
  expiresAt: number;
}

let cachedServers: CachedICEServers | null = null;

/**
 * Fetches ICE servers from Xirsys API with caching and fallback
 * @returns Promise<RTCIceServer[]> Array of ICE servers
 */
export async function getXirsysICEServers(): Promise<RTCIceServer[]> {
  console.log('[XIRSYS] Fetching ICE servers...');

  // Check cache first
  if (cachedServers && Date.now() < cachedServers.expiresAt) {
    console.log('[XIRSYS] Using cached ICE servers');
    return cachedServers.servers;
  }

  try {
    // Fetch from our secure API endpoint
    console.log('[XIRSYS] Making request to /api/xirsys/ice...');
    const response = await fetch('/api/xirsys/ice', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(parseInt(process.env.XIRSYS_API_TIMEOUT || '10000'))
    });

    console.log(`[XIRSYS] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[XIRSYS] API error response: ${errorText}`);
      throw new Error(`Xirsys API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[XIRSYS] API response data:', data);
    
    if (!data.success || !data.iceServers || !Array.isArray(data.iceServers)) {
      console.error('[XIRSYS] Invalid response format:', data);
      throw new Error('Invalid response format from Xirsys API');
    }

    const iceServers = data.iceServers as RTCIceServer[];
    console.log(`[XIRSYS] ✅ Fetched ${iceServers.length} ICE servers from API`);

    // Validate ICE server format
    const validatedServers = validateICEServers(iceServers);
    
    // Cache the results
    const cacheDuration = parseInt(process.env.XIRSYS_CACHE_DURATION || '3600000'); // 1 hour default
    cachedServers = {
      servers: validatedServers,
      timestamp: Date.now(),
      expiresAt: Date.now() + cacheDuration
    };

    return validatedServers;

  } catch (error) {
    console.error('[XIRSYS] ❌ Failed to fetch ICE servers:', error);
    
    // Return cached servers if available (even if expired)
    if (cachedServers) {
      console.warn('[XIRSYS] Using expired cached servers as fallback');
      return cachedServers.servers;
    }

    // Final fallback to public servers
    console.warn('[XIRSYS] Using public STUN servers as final fallback');
    return getFallbackICEServers();
  }
}

/**
 * Validates ICE server configuration format
 * @param servers Raw ICE servers from API
 * @returns Validated RTCIceServer array
 */
function validateICEServers(servers: any[]): RTCIceServer[] {
  const validated: RTCIceServer[] = [];
  
  // Ensure we have both STUN and TURN servers
  let hasTurn = false;
  
  servers.forEach(server => {
    // Validate server format
    if (server && (typeof server.urls === 'string' || Array.isArray(server.urls))) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      
      // Check for TURN servers
      if (urls.some((url: string) => url.toLowerCase().startsWith('turn:'))) {
        hasTurn = true;
        console.log('[XIRSYS] ✅ Found TURN server in configuration');
      }
      
      validated.push(server);
      
      // Log each validated server
      urls.forEach((url: string) => {
        console.log(`[XIRSYS] ✅ Validated server: ${url}`);
      });
    }
  });
  
  // Warning if no TURN servers found
  if (!hasTurn) {
    console.warn('[XIRSYS] ⚠️ No TURN servers found in configuration - this may cause connectivity issues');
  }
  
  return validated;
}

/**
 * Fallback ICE servers when Xirsys is unavailable
 * @returns RTCIceServer[] Public STUN/TURN servers
 */
function getFallbackICEServers(): RTCIceServer[] {
  console.log('[XIRSYS] Using fallback public servers');
  
  return [
    // Multiple Google STUN servers for redundancy
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },

    // Additional public STUN servers
    { urls: "stun:global.stun.twilio.com:3478" },
    { urls: "stun:stun.cloudflare.com:3478" },

    // Public TURN servers as last resort
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject", 
      credential: "openrelayproject"
    }
  ];
}

/**
 * Clears the ICE server cache (useful for testing or forced refresh)
 */
export function clearXirsysCache(): void {
  console.log('[XIRSYS] Clearing ICE server cache');
  cachedServers = null;
}

/**
 * Gets cache status for debugging
 * @returns Cache information
 */
export function getXirsysCacheStatus(): { 
  cached: boolean; 
  expiresIn?: number; 
  serverCount?: number; 
} {
  if (!cachedServers) {
    return { cached: false };
  }

  const expiresIn = cachedServers.expiresAt - Date.now();
  return {
    cached: true,
    expiresIn: Math.max(0, expiresIn),
    serverCount: cachedServers.servers.length
  };
}

/**
 * Expert WebRTC configuration optimized for Xirsys infrastructure
 * @param iceServers ICE servers from Xirsys
 * @returns RTCConfiguration object
 */
export function createXirsysRTCConfiguration(iceServers: RTCIceServer[], forceRelay: boolean = false): RTCConfiguration {
  return {
    iceServers,
    // Enhanced WebRTC configuration for reliable connectivity
    iceCandidatePoolSize: 15, // Always generate more candidates for better connectivity
    bundlePolicy: 'max-bundle',       // Bundle all media on single transport
    rtcpMuxPolicy: 'require',         // Multiplex RTP and RTCP for efficiency
    iceTransportPolicy: forceRelay ? 'relay' : 'all' // Force TURN if needed
  };
}





