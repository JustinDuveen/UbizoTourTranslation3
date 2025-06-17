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
}

let serverCache: CachedICEResponse | null = null;

/**
 * GET /api/xirsys/ice
 * Fetches ICE servers from Xirsys API with authentication and caching
 */
export async function GET(request: NextRequest) {
  console.log('[XIRSYS-API] ICE server request received');

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

    // Check cache first
    const cacheDuration = parseInt(process.env.XIRSYS_CACHE_DURATION || '3600000'); // 1 hour
    if (serverCache && Date.now() < serverCache.expiresAt) {
      console.log('[XIRSYS-API] Returning cached ICE servers');
      return NextResponse.json({
        success: true,
        iceServers: serverCache.iceServers,
        cached: true,
        expiresIn: serverCache.expiresAt - Date.now()
      });
    }

    // Fetch from Xirsys API using the exact code provided
    console.log('[XIRSYS-API] Fetching fresh ICE servers from Xirsys...');
    
    const iceServers = await fetchXirsysICEServers(channel, username, apiKey, endpoint);
    
    // Cache the response
    serverCache = {
      iceServers,
      timestamp: Date.now(),
      expiresAt: Date.now() + cacheDuration
    };

    console.log(`[XIRSYS-API] ✅ Successfully fetched ${iceServers.length} ICE servers`);

    return NextResponse.json({
      success: true,
      iceServers,
      cached: false,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('[XIRSYS-API] ❌ Error fetching ICE servers:', error);

    // Return cached data if available (even if expired)
    if (serverCache) {
      console.warn('[XIRSYS-API] Returning expired cached data due to error');
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
  
  serverCache = null;
  
  return NextResponse.json({
    success: true,
    message: 'Cache cleared successfully'
  });
}
