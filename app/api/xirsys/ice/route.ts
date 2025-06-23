/**
 * Xirsys ICE Server API Endpoint
 * Secure server-side integration with Xirsys TURN/STUN services
 */

import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

// Cache for ICE servers to avoid API rate limits
interface CachedICEResponse {
  iceServers: any[];
  timestamp: number;
  expiresAt: number;
  tourId?: string;
  serverInstance?: string; // Track specific server instance (turn7, turn8, etc)
}

let serverCache: CachedICEResponse | null = null;
// Tour-specific server cache to ensure same instance per tour
const tourServerCache = new Map<string, CachedICEResponse>();

/**
 * GET /api/xirsys/ice
 * Fetches ICE servers from Xirsys API with authentication and caching
 */
export async function GET(request: NextRequest) {
  console.log('[XIRSYS-API] ICE server request received');

  // EXPERT FIX: Get tour session info for guaranteed server instance consistency
  const { searchParams } = new URL(request.url);
  const tourId = searchParams.get('tourId');
  const forceRefresh = searchParams.get('forceRefresh') === 'true';

  try {
    // Check environment variables
    const channel = process.env.XIRSYS_CHANNEL;
    const username = process.env.XIRSYS_USERNAME;
    const apiKey = process.env.XIRSYS_API_KEY;
    const endpoint = process.env.XIRSYS_ENDPOINT;

    if (!channel || !username || !apiKey || !endpoint) {
      console.error('[XIRSYS-API] Missing required environment variables');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Xirsys configuration incomplete',
          iceServers: [] 
        },
        { status: 500 }
      );
    }

    const cacheDuration = parseInt(process.env.XIRSYS_CACHE_DURATION || '3600000'); // 1 hour
    
    // CRITICAL FIX: Tour-specific server consistency check
    if (tourId && !forceRefresh) {
      const tourCache = tourServerCache.get(tourId);
      
      if (tourCache && Date.now() < tourCache.expiresAt) {
        console.log(`[XIRSYS-API] ✅ Returning tour-cached ICE servers for ${tourId} (server: ${tourCache.serverInstance})`);
        return NextResponse.json({
          success: true,
          iceServers: tourCache.iceServers,
          cached: true,
          tourSpecific: true,
          expiresIn: tourCache.expiresAt - Date.now(),
          tourId: tourId,
          serverInstance: tourCache.serverInstance
        });
      }
      
      // Extended cache for tour consistency (6 hours instead of 1 hour)
      if (tourCache && Date.now() < (tourCache.expiresAt + 21600000)) {
        console.log(`[XIRSYS-API] ⚡ Using EXTENDED tour cache for consistency: ${tourId} (server: ${tourCache.serverInstance})`);
        return NextResponse.json({
          success: true,
          iceServers: tourCache.iceServers,
          cached: true,
          extended: true,
          tourSpecific: true,
          tourId: tourId,
          serverInstance: tourCache.serverInstance
        });
      }
    }

    // Fallback to global cache for non-tour requests
    if (!tourId && serverCache && Date.now() < serverCache.expiresAt && !forceRefresh) {
      console.log('[XIRSYS-API] Returning global cached ICE servers');
      return NextResponse.json({
        success: true,
        iceServers: serverCache.iceServers,
        cached: true,
        expiresIn: serverCache.expiresAt - Date.now(),
        tourId: 'global'
      });
    }

    // Fetch from Xirsys API using the exact code provided
    console.log(`[XIRSYS-API] Fetching fresh ICE servers from Xirsys... ${tourId ? `(for tour: ${tourId})` : '(global)'}`);
    
    const iceServers = await fetchXirsysICEServers(channel, username, apiKey, endpoint);
    
    // EXPERT FIX: Extract server instance for consistency tracking
    const serverInstance = extractServerInstance(iceServers);
    console.log(`[XIRSYS-API] 🎯 Detected server instance: ${serverInstance}`);
    
    const cacheEntry = {
      iceServers,
      timestamp: Date.now(),
      expiresAt: Date.now() + cacheDuration,
      tourId: tourId || undefined,
      serverInstance
    };
    
    // Store in appropriate cache
    if (tourId) {
      // Tour-specific cache with extended lifetime for consistency
      tourServerCache.set(tourId, {
        ...cacheEntry,
        expiresAt: Date.now() + (cacheDuration * 6) // 6x longer for tours
      });
      console.log(`[XIRSYS-API] 🔒 Cached servers for tour ${tourId} (instance: ${serverInstance}) - expires in ${(cacheDuration * 6) / 1000 / 60} minutes`);
    } else {
      // Global cache
      serverCache = cacheEntry;
      console.log(`[XIRSYS-API] 📦 Cached servers globally (instance: ${serverInstance})`);
    }

    console.log(`[XIRSYS-API] ✅ Successfully fetched ${iceServers.length} ICE servers`);

    return NextResponse.json({
      success: true,
      iceServers,
      cached: false,
      timestamp: Date.now(),
      tourId: tourId || 'global',
      serverInstance,
      message: tourId ? `Server locked for tour ${tourId}` : 'Global server assignment'
    });

  } catch (error) {
    console.error('[XIRSYS-API] ❌ Error fetching ICE servers:', error);

    // Try tour-specific cache first if available
    if (tourId) {
      const tourCache = tourServerCache.get(tourId);
      if (tourCache) {
        console.warn(`[XIRSYS-API] Returning tour-cached data for ${tourId} due to error (server: ${tourCache.serverInstance})`);
        return NextResponse.json({
          success: true,
          iceServers: tourCache.iceServers,
          cached: true,
          expired: true,
          tourSpecific: true,
          serverInstance: tourCache.serverInstance,
          error: 'Using tour-cached data due to API error'
        });
      }
    }

    // Fallback to global cache
    if (serverCache) {
      console.warn('[XIRSYS-API] Returning global cached data due to error');
      return NextResponse.json({
        success: true,
        iceServers: serverCache.iceServers,
        cached: true,
        expired: true,
        error: 'Using cached data due to API error'
      });
    }

    // Return error response
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        iceServers: []
      },
      { status: 500 }
    );
  }
}

/**
 * EXPERT FIX: Extracts server instance identifier from ICE server URLs
 * This ensures we can track which Xirsys server instance we're using
 */
function extractServerInstance(iceServers: any[]): string {
  if (!iceServers || iceServers.length === 0) {
    return 'unknown';
  }

  try {
    // Look for TURN server URLs which contain the instance identifier
    for (const server of iceServers) {
      if (server.urls) {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        
        for (const url of urls) {
          if (typeof url === 'string' && url.includes('turn:')) {
            // Extract server instance from URL like "turn:fr-turn7.xirsys.com:80"
            const match = url.match(/turn:.*?-turn(\d+)\.xirsys\.com/);
            if (match && match[1]) {
              return `turn${match[1]}`;
            }
            
            // Fallback: extract hostname
            const hostnameMatch = url.match(/turn:([^:]+)/);
            if (hostnameMatch && hostnameMatch[1]) {
              return hostnameMatch[1];
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[XIRSYS-API] Error extracting server instance:', error);
  }

  return 'unknown';
}

/**
 * Fetches ICE servers from Xirsys API using the exact provided code
 */
async function fetchXirsysICEServers(
  channel: string, 
  username: string, 
  apiKey: string, 
  endpoint: string
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    // Request body as specified in the provided code
    const requestBody = {
      format: "urls"
    };

    const bodyString = JSON.stringify(requestBody);
    
    // Create authorization header
    const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
    
    // HTTPS request options exactly as provided
    const options = {
      host: endpoint,
      path: `/_turn/${channel}`,
      method: "PUT",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
        "Content-Length": bodyString.length
      },
      timeout: parseInt(process.env.XIRSYS_API_TIMEOUT || '30000'),
      // Add DNS resolution options for WSL/Windows environment
      family: 4, // Force IPv4 to avoid IPv6 issues in WSL
      lookup: require('dns').lookup
    };

    console.log(`[XIRSYS-API] Making request to https://${endpoint}/_turn/${channel}`);

    const httpreq = https.request(options, function(httpres) {
      let responseData = "";
      
      httpres.on("data", function(data) { 
        responseData += data; 
      });
      
      httpres.on("error", function(e) { 
        console.error('[XIRSYS-API] Response error:', e);
        reject(e);
      });
      
      httpres.on("end", function() { 
        try {
          console.log('[XIRSYS-API] Raw response:', responseData);
          
          const parsedResponse = JSON.parse(responseData);
          console.log('[XIRSYS-API] Parsed response object:', JSON.stringify(parsedResponse, null, 2));
          
          // Xirsys API returns data in 'v' field
          if (parsedResponse.s === 'ok' && parsedResponse.v) {
            console.log('[XIRSYS-API] ✅ Successfully parsed Xirsys response');
            console.log('[XIRSYS-API] Response v field:', JSON.stringify(parsedResponse.v, null, 2));
            
            let iceServers: any[] = [];
            
            // Handle different Xirsys response formats
            if (Array.isArray(parsedResponse.v)) {
              // Format 1: Direct array of ICE servers
              iceServers = parsedResponse.v;
              console.log('[XIRSYS-API] Using direct array format');
            } else if (parsedResponse.v.iceServers) {
              // Format 2: ICE servers in nested object
              const iceServerData = parsedResponse.v.iceServers;
              if (Array.isArray(iceServerData)) {
                iceServers = iceServerData;
                console.log('[XIRSYS-API] Using nested array format');
              } else if (iceServerData.urls) {
                // Format 3: Single ICE server object with multiple URLs
                iceServers = [{
                  urls: iceServerData.urls,
                  username: iceServerData.username,
                  credential: iceServerData.credential
                }];
                console.log('[XIRSYS-API] Using single object format, converted to array');
              }
            }
            
            console.log(`[XIRSYS-API] Found ${iceServers.length} ICE servers in response`);
            if (iceServers.length === 0) {
              console.warn('[XIRSYS-API] ⚠️ Xirsys returned empty ICE servers array');
            } else {
              console.log('[XIRSYS-API] ICE servers preview:', iceServers.map(s => ({ urls: Array.isArray(s.urls) ? s.urls[0] : s.urls, hasCredentials: !!(s.username && s.credential) })));
            }
            resolve(iceServers);
          } else {
            console.error('[XIRSYS-API] Invalid response format:', parsedResponse);
            console.error('[XIRSYS-API] Response status (s):', parsedResponse.s);
            console.error('[XIRSYS-API] Response data (v):', parsedResponse.v);
            reject(new Error(`Xirsys API error: ${parsedResponse.s || 'Unknown error'}`));
          }
        } catch (parseError) {
          console.error('[XIRSYS-API] Failed to parse response:', parseError);
          console.error('[XIRSYS-API] Raw response that failed to parse:', responseData);
          reject(new Error('Failed to parse Xirsys response'));
        }
      });
    });

    httpreq.on("error", function(e) { 
      console.error('[XIRSYS-API] Request error:', e);
      reject(e);
    });

    httpreq.on("timeout", function() {
      console.error('[XIRSYS-API] Request timeout');
      httpreq.destroy();
      reject(new Error('Xirsys API request timeout'));
    });

    // Send the request
    httpreq.write(bodyString);
    httpreq.end();
  });
}

/**
 * POST /api/xirsys/ice/clear-cache
 * Clears the server-side cache (for testing/debugging)
 */
export async function POST(request: NextRequest) {
  console.log('[XIRSYS-API] Cache clear request received');
  
  const { searchParams } = new URL(request.url);
  const tourId = searchParams.get('tourId');
  
  if (tourId) {
    // Clear specific tour cache
    const hadCache = tourServerCache.delete(tourId);
    console.log(`[XIRSYS-API] ${hadCache ? 'Cleared' : 'No cache found for'} tour ${tourId}`);
    
    return NextResponse.json({
      success: true,
      message: `Tour cache cleared for ${tourId}`,
      tourId
    });
  } else {
    // Clear all caches
    const tourCount = tourServerCache.size;
    serverCache = null;
    tourServerCache.clear();
    
    console.log(`[XIRSYS-API] Cleared global cache and ${tourCount} tour caches`);
    
    return NextResponse.json({
      success: true,
      message: `All caches cleared (global + ${tourCount} tours)`,
      clearedTours: tourCount
    });
  }
}
