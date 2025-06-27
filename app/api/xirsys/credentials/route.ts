import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Use the provided Xirsys API credentials
    const ident = "virtualaiworkforce";
    const secret = "535f2cee-3fa6-11f0-8df0-0242ac130002";
    const channel = "TourTranslator";

    if (!ident || !secret) {
      console.error('[XIRSYS-API] Missing credentials in environment');
      return NextResponse.json({ 
        error: "Server configuration error" 
      }, { status: 500 });
    }

    // Create authorization header
    const auth = Buffer.from(`${ident}:${secret}`).toString('base64');
    
    // Request body for ICE servers
    const requestBody = {
      format: "urls"
    };

    const options = {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    };

    console.log(`[XIRSYS-API] Fetching fresh TURN credentials from channel: ${channel}`);
    
    const response = await fetch(`https://global.xirsys.net/_turn/${channel}`, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[XIRSYS-API] Error ${response.status}: ${errorText}`);
      throw new Error(`Xirsys API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('[XIRSYS-API] Raw response:', data);

    // Parse Xirsys response format
    if (data.s !== "ok") {
      console.error('[XIRSYS-API] Xirsys returned error status:', data);
      throw new Error(`Xirsys error: ${data.e || 'Unknown error'}`);
    }

    // Extract ICE servers from response
    let iceServers;
    if (typeof data.v === 'string') {
      iceServers = JSON.parse(data.v);
    } else {
      iceServers = data.v;
    }

    if (!iceServers || !iceServers.iceServers) {
      console.error('[XIRSYS-API] Invalid response format:', data);
      throw new Error('Invalid response format from Xirsys');
    }

    const servers = iceServers.iceServers;
    console.log(`[XIRSYS-API] ✅ Successfully fetched ${servers.length} ICE servers`);
    
    // Log TURN servers found
    const turnServers = servers.filter((server: any) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url: string) => url.startsWith('turn:') || url.startsWith('turns:'));
    });
    
    console.log(`[XIRSYS-API] Found ${turnServers.length} TURN servers with credentials`);

    return NextResponse.json({
      success: true,
      iceServers: servers,
      timestamp: Date.now(),
      ttl: 3600000, // 1 hour TTL
      serverCount: servers.length,
      turnServerCount: turnServers.length
    });

  } catch (error) {
    console.error('[XIRSYS-API] Failed to fetch credentials:', error);
    
    return NextResponse.json({
      error: "Failed to fetch TURN credentials",
      message: error instanceof Error ? error.message : String(error),
      fallbackRecommended: true
    }, { status: 500 });
  }
}