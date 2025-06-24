/**
 * AUDIO DEBUG CONSOLE - Senior WebRTC Developer Tools
 * Immediate diagnostic and fix tools for browser console use
 */

import { openAIConnectionsByLanguage, attendeeConnectionsByLanguage } from './audioHandlerFix';
import { initializeEmergencyAudioSystem, diagnoseAudioSystem } from './emergencyAudioFix';
import { normalizeLanguageForStorage } from './languageUtils';

// Browser console debugging interface
export interface AudioDebugConsole {
  // Diagnostic functions
  diagnose: () => any;
  checkConnections: () => any;
  checkAudioStreams: () => any;
  listLanguages: () => string[];
  
  // Fix functions
  emergencyFix: (language: string) => Promise<boolean>;
  forceAudioCheck: (language: string) => void;
  injectAudioHandler: (language: string) => void;
  
  // Testing functions
  testAudioFlow: (language: string) => void;
  simulateAudioTrack: (language: string) => void;
  
  // Monitoring functions
  startMonitoring: (language: string) => void;
  stopMonitoring: () => void;
  
  // Connection inspection
  inspectPeerConnections: () => any;
  inspectReceivers: (language: string) => any;
}

/**
 * Create comprehensive audio diagnostics for browser console
 */
function createAudioDiagnostics(): any {
  return {
    // System-wide diagnostics
    systemDiagnostics: diagnoseAudioSystem(),
    
    // Connection status
    connections: {
      openAI: Array.from(openAIConnectionsByLanguage.entries()).map(([lang, conn]: [string, any]) => ({
        language: lang,
        hasConnection: !!conn,
        hasPeerConnection: !!conn?.pc,
        hasDataChannel: !!conn?.dc,
        hasAudioStream: !!conn?.audioStream,
        connectionState: conn?.pc?.connectionState,
        iceConnectionState: conn?.pc?.iceConnectionState,
        audioStreamDetails: conn?.audioStream ? {
          id: conn.audioStream.id,
          active: conn.audioStream.active,
          trackCount: conn.audioStream.getTracks().length,
          audioTracks: conn.audioStream.getAudioTracks().length
        } : null
      })),
      
      attendees: Array.from(attendeeConnectionsByLanguage.entries()).map(([lang, attendees]: [string, any]) => ({
        language: lang,
        attendeeCount: attendees.size,
        attendees: Array.from(attendees.entries()).map((entry: unknown) => {
          const [id, conn] = entry as [string, any];
          return {
            id,
            connectionState: conn?.pc?.connectionState,
            iceConnectionState: conn?.pc?.iceConnectionState
          };
        })
      }))
    },
    
    // Browser WebRTC status
    browserSupport: {
      hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
      hasRTCPeerConnection: !!window.RTCPeerConnection,
      hasWebSocket: !!window.WebSocket
    }
  };
}

/**
 * Check specific language audio flow
 */
function checkAudioFlow(language: string): any {
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const connection = openAIConnectionsByLanguage.get(normalizedLanguage);
  
  if (!connection) {
    return {
      status: 'ERROR',
      message: `No OpenAI connection found for language: ${normalizedLanguage}`,
      availableLanguages: Array.from(openAIConnectionsByLanguage.keys())
    };
  }
  
  const result = {
    language: normalizedLanguage,
    openAIConnection: {
      exists: !!connection,
      peerConnectionState: connection.pc?.connectionState,
      iceConnectionState: connection.pc?.iceConnectionState,
      hasAudioStream: !!connection.audioStream,
      receivers: connection.pc?.getReceivers()?.length || 0,
      senders: connection.pc?.getSenders()?.length || 0
    },
    audioStream: null as any,
    attendeeConnections: {
      count: attendeeConnectionsByLanguage.get(normalizedLanguage)?.size || 0,
      details: [] as Array<{
        id: string;
        connectionState: string;
        iceConnectionState: string;
        senders: number;
      }>
    }
  };
  
  // Audio stream details
  if (connection.audioStream) {
    const stream = connection.audioStream;
    result.audioStream = {
      id: stream.id,
      active: stream.active,
      totalTracks: stream.getTracks().length,
      audioTracks: stream.getAudioTracks().length,
      trackDetails: stream.getTracks().map((track: MediaStreamTrack) => ({
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      }))
    };
  }
  
  // Attendee connections
  const attendees = attendeeConnectionsByLanguage.get(normalizedLanguage);
  if (attendees) {
    result.attendeeConnections.details = Array.from(attendees.entries()).map(([id, conn]: [string, any]) => ({
      id,
      connectionState: conn.pc?.connectionState || 'unknown',
      iceConnectionState: conn.pc?.iceConnectionState || 'unknown',
      senders: conn.pc?.getSenders()?.length || 0
    }));
  }
  
  return result;
}

/**
 * Force audio check and repair attempt
 */
function forceAudioCheck(language: string): void {
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const connection = openAIConnectionsByLanguage.get(normalizedLanguage);
  
  console.log(`🔍 FORCE AUDIO CHECK for ${normalizedLanguage}:`);
  
  if (!connection) {
    console.error(`❌ No connection found for ${normalizedLanguage}`);
    return;
  }
  
  // Check receivers for existing audio tracks
  const receivers = connection.pc.getReceivers();
  console.log(`📡 Found ${receivers.length} receivers`);
  
  receivers.forEach((receiver: RTCRtpReceiver, index: number) => {
    if (receiver.track) {
      console.log(`🎵 Receiver ${index}:`, {
        kind: receiver.track.kind,
        id: receiver.track.id,
        enabled: receiver.track.enabled,
        muted: receiver.track.muted,
        readyState: receiver.track.readyState
      });
      
      if (receiver.track.kind === 'audio' && !connection.audioStream) {
        console.log(`🔧 MANUAL FIX: Creating audio stream from receiver ${index}`);
        const stream = new MediaStream([receiver.track]);
        connection.audioStream = stream;
        console.log(`✅ Audio stream manually created and stored`);
      }
    }
  });
}

/**
 * Test audio forwarding to attendees
 */
function testAudioForwarding(language: string): void {
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const openAIConnection = openAIConnectionsByLanguage.get(normalizedLanguage);
  const attendeeConnections = attendeeConnectionsByLanguage.get(normalizedLanguage);
  
  console.log(`🧪 TESTING AUDIO FORWARDING for ${normalizedLanguage}:`);
  
  if (!openAIConnection?.audioStream) {
    console.error(`❌ No audio stream available for ${normalizedLanguage}`);
    return;
  }
  
  if (!attendeeConnections || attendeeConnections.size === 0) {
    console.warn(`⚠️ No attendees connected for ${normalizedLanguage}`);
    return;
  }
  
  console.log(`🔄 Forwarding audio to ${attendeeConnections.size} attendees...`);
  
  const audioTracks = openAIConnection.audioStream.getAudioTracks();
  console.log(`🎵 Audio tracks to forward: ${audioTracks.length}`);
  
  Array.from(attendeeConnections.entries()).forEach(([attendeeId, attendeeConnection]) => {
    try {
      audioTracks.forEach((track: MediaStreamTrack, trackIndex: number) => {
        attendeeConnection.pc.addTrack(track, openAIConnection.audioStream);
        console.log(`✅ Track ${trackIndex} added to attendee ${attendeeId}`);
      });
    } catch (error) {
      console.log(`⚠️ Error with attendee ${attendeeId}:`, error);
    }
  });
}

/**
 * Create the complete audio debug console
 */
export function createAudioDebugConsole(): AudioDebugConsole {
  return {
    // Diagnostic functions
    diagnose: createAudioDiagnostics,
    checkConnections: () => ({
      openAI: openAIConnectionsByLanguage.size,
      attendees: attendeeConnectionsByLanguage.size,
      languages: Array.from(openAIConnectionsByLanguage.keys())
    }),
    checkAudioStreams: () => {
      const result: any = {};
      Array.from(openAIConnectionsByLanguage.entries()).forEach(([lang, conn]) => {
        result[lang] = {
          hasStream: !!conn.audioStream,
          streamActive: conn.audioStream?.active,
          trackCount: conn.audioStream?.getTracks().length || 0
        };
      });
      return result;
    },
    listLanguages: () => Array.from(openAIConnectionsByLanguage.keys()),
    
    // Fix functions
    emergencyFix: initializeEmergencyAudioSystem,
    forceAudioCheck,
    injectAudioHandler: (language: string) => {
      console.log(`🔧 Injecting audio handler for ${language}...`);
      initializeEmergencyAudioSystem(language);
    },
    
    // Testing functions
    testAudioFlow: checkAudioFlow,
    simulateAudioTrack: (language: string) => {
      console.log(`🎭 Simulating audio track for ${language}...`);
      // Create a mock audio track for testing
      const canvas = document.createElement('canvas');
      const stream = (canvas as any).captureStream();
      const audioTrack = stream.getAudioTracks()[0];
      
      if (audioTrack) {
        console.log(`✅ Mock audio track created`);
        // Trigger the audio handler manually
        const connection = openAIConnectionsByLanguage.get(normalizeLanguageForStorage(language));
        if (connection && connection.pc.ontrack) {
          const mockEvent = {
            track: audioTrack,
            streams: [stream]
          } as unknown as RTCTrackEvent;
          connection.pc.ontrack(mockEvent);
        }
      }
    },
    
    // Monitoring functions
    startMonitoring: (language: string) => {
      console.log(`🔍 Starting monitoring for ${language}...`);
      const interval = setInterval(() => {
        const status = checkAudioFlow(language);
        console.log(`📊 ${language} status:`, status);
      }, 5000);
      
      (window as any).audioMonitoringInterval = interval;
    },
    stopMonitoring: () => {
      if ((window as any).audioMonitoringInterval) {
        clearInterval((window as any).audioMonitoringInterval);
        console.log(`⏹️ Audio monitoring stopped`);
      }
    },
    
    // Connection inspection
    inspectPeerConnections: () => {
      const connections: any = {};
      Array.from(openAIConnectionsByLanguage.entries()).forEach(([lang, conn]) => {
        if (conn.pc) {
          connections[lang] = {
            connectionState: conn.pc.connectionState,
            iceConnectionState: conn.pc.iceConnectionState,
            iceGatheringState: conn.pc.iceGatheringState,
            signalingState: conn.pc.signalingState,
            receivers: conn.pc.getReceivers().length,
            senders: conn.pc.getSenders().length
          };
        }
      });
      return connections;
    },
    inspectReceivers: (language: string) => {
      const connection = openAIConnectionsByLanguage.get(normalizeLanguageForStorage(language));
      if (!connection?.pc) return null;
      
      return connection.pc.getReceivers().map((receiver: RTCRtpReceiver, index: number) => ({
        index,
        hasTrack: !!receiver.track,
        track: receiver.track ? {
          kind: receiver.track.kind,
          id: receiver.track.id,
          enabled: receiver.track.enabled,
          muted: receiver.track.muted,
          readyState: receiver.track.readyState
        } : null
      }));
    }
  };
}

// Auto-inject debug console into browser
if (typeof window !== 'undefined') {
  (window as any).audioDebug = createAudioDebugConsole();
  console.log('🛠️ AUDIO DEBUG CONSOLE READY');
  console.log('📝 Available commands:');
  console.log('  • audioDebug.diagnose() - Complete system diagnosis');
  console.log('  • audioDebug.checkAudioFlow("language") - Check specific language');
  console.log('  • audioDebug.emergencyFix("language") - Emergency fix for language');
  console.log('  • audioDebug.forceAudioCheck("language") - Force check receivers');
  console.log('  • audioDebug.testAudioForwarding("language") - Test forwarding');
  console.log('  • audioDebug.startMonitoring("language") - Start monitoring');
  console.log('✅ Use audioDebug.[command] in console');
}