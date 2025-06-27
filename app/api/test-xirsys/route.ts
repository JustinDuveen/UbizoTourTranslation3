import { NextResponse } from "next/server";

export async function GET() {
  try {
    console.log('[TEST-XIRSYS] Testing Xirsys credential configuration...');
    
    // Test the dynamic credentials endpoint
    const response = await fetch('/api/xirsys/credentials', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TEST-XIRSYS] Dynamic credentials failed:', errorText);
      return NextResponse.json({
        error: "Dynamic credentials test failed",
        details: errorText,
        status: response.status
      }, { status: 500 });
    }

    const data = await response.json();
    
    if (!data.success) {
      console.error('[TEST-XIRSYS] Invalid response:', data);
      return NextResponse.json({
        error: "Invalid response from credentials API",
        details: data
      }, { status: 500 });
    }

    // Analyze the ICE servers
    const analysis = {
      totalServers: data.serverCount || 0,
      turnServers: data.turnServerCount || 0,
      hasCredentials: false,
      serverDetails: [] as Array<{
        index: number;
        type: string;
        urlCount: number;
        turnUrls: number;
        stunUrls: number;
        hasCredentials: boolean;
        username: string | null;
      }>
    };

    // Check each server
    if (data.iceServers && Array.isArray(data.iceServers)) {
      data.iceServers.forEach((server: any, index: number) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const hasAuth = !!(server.username && server.credential);
        
        if (hasAuth) {
          analysis.hasCredentials = true;
        }
        
        const turnUrls = urls.filter((url: string) => url.startsWith('turn:') || url.startsWith('turns:'));
        const stunUrls = urls.filter((url: string) => url.startsWith('stun:'));
        
        analysis.serverDetails.push({
          index: index + 1,
          type: turnUrls.length > 0 ? 'TURN' : 'STUN',
          urlCount: urls.length,
          turnUrls: turnUrls.length,
          stunUrls: stunUrls.length,
          hasCredentials: hasAuth,
          username: hasAuth ? server.username.substring(0, 20) + '...' : null
        });
      });
    }

    console.log('[TEST-XIRSYS] ✅ Credential test successful');
    console.log('[TEST-XIRSYS] Analysis:', analysis);

    return NextResponse.json({
      success: true,
      message: "Xirsys credentials working correctly",
      timestamp: new Date().toISOString(),
      analysis,
      recommendation: analysis.turnServers > 0 && analysis.hasCredentials 
        ? "Configuration looks good for WebRTC connectivity" 
        : "⚠️ Missing TURN servers or credentials - check configuration"
    });

  } catch (error) {
    console.error('[TEST-XIRSYS] Test failed:', error);
    
    return NextResponse.json({
      error: "Xirsys test failed",
      message: error instanceof Error ? error.message : String(error),
      recommendation: "Check server logs and Xirsys API credentials"
    }, { status: 500 });
  }
}