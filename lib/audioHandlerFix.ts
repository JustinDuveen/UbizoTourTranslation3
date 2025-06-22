/**
 * EMERGENCY AUDIO HANDLER FIX
 * Critical architectural fix for OpenAI audio reception
 * This file provides a direct solution for the missing ontrack handlers
 */

import { normalizeLanguageForStorage } from './languageUtils';

// Global connection tracking (matching repository implementation)
export const openAIConnectionsByLanguage = new Map<string, any>();
export const attendeeConnectionsByLanguage = new Map<string, Map<string, any>>();

/**
 * Critical OpenAI Audio Handler - Missing from deployed implementation
 * This is the core component that receives audio from OpenAI
 */
export function createOpenAIAudioHandler(
  language: string, 
  openaiPC: RTCPeerConnection, 
  openaiDC: RTCDataChannel
) {
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const langContext = `[${normalizedLanguage}]`;

  // CRITICAL: The ontrack handler that's missing from deployment
  const audioTrackHandler = (e: RTCTrackEvent) => {
    try {
      console.log(`${langContext} 🎵 EMERGENCY FIX: AUDIO TRACK RECEIVED from OpenAI 🎵`);
      
      if (e.track.kind === 'audio') {
        console.log(`${langContext} ✅ EMERGENCY FIX: OpenAI audio track successfully received!`);
        console.log(`${langContext} Track details:`, {
          id: e.track.id,
          enabled: e.track.enabled,
          muted: e.track.muted,
          readyState: e.track.readyState,
          label: e.track.label
        });

        const stream = e.streams[0];
        console.log(`${langContext} Stream details:`, {
          id: stream.id,
          active: stream.active,
          trackCount: stream.getTracks().length
        });

        // Store the stream for attendee forwarding
        let connection = openAIConnectionsByLanguage.get(normalizedLanguage);
        
        if (!connection) {
          console.log(`${langContext} 🔄 EMERGENCY FIX: Creating connection for audio storage`);
          connection = {
            pc: openaiPC,
            dc: openaiDC,
            audioStream: stream,
            microphoneTracks: [],
            audioElement: document.createElement('audio')
          };
          
          openAIConnectionsByLanguage.set(normalizedLanguage, connection);
          console.log(`${langContext} ✅ EMERGENCY FIX: Connection created and audio stored`);
        } else {
          connection.audioStream = stream;
          console.log(`${langContext} ✅ EMERGENCY FIX: Audio stream stored in existing connection`);
        }

        // Immediately forward to any connected attendees
        forwardAudioToAttendees(normalizedLanguage, stream);
        
      } else {
        console.log(`${langContext} Received non-audio track: ${e.track.kind}`);
      }
    } catch (error) {
      console.error(`${langContext} ❌ EMERGENCY FIX: Error in audio handler:`, error);
    }
  };

  // Set the critical audio handler
  openaiPC.ontrack = audioTrackHandler;
  console.log(`${langContext} ✅ EMERGENCY FIX: OpenAI audio handler installed`);

  // Fallback: Check for existing receivers in case ontrack already fired
  setTimeout(() => {
    const receivers = openaiPC.getReceivers();
    console.log(`${langContext} 🔍 EMERGENCY FIX: Checking ${receivers.length} existing receivers`);
    
    receivers.forEach((receiver, index) => {
      if (receiver.track && receiver.track.kind === 'audio') {
        console.log(`${langContext} 🎵 EMERGENCY FIX: Found existing audio track in receiver ${index}`);
        const stream = new MediaStream([receiver.track]);
        
        // Manually trigger storage
        let connection = openAIConnectionsByLanguage.get(normalizedLanguage);
        if (!connection) {
          connection = {
            pc: openaiPC,
            dc: openaiDC,
            audioStream: stream,
            microphoneTracks: [],
            audioElement: document.createElement('audio')
          };
          openAIConnectionsByLanguage.set(normalizedLanguage, connection);
        } else {
          connection.audioStream = stream;
        }
        
        console.log(`${langContext} ✅ EMERGENCY FIX: Existing audio track recovered and stored`);
        forwardAudioToAttendees(normalizedLanguage, stream);
      }
    });
  }, 1000);
}

/**
 * Forward audio to attendees - Core forwarding logic
 */
export function forwardAudioToAttendees(language: string, audioStream: MediaStream) {
  const langContext = `[${language}]`;
  const attendeeConnections = attendeeConnectionsByLanguage.get(language);
  
  if (!attendeeConnections || attendeeConnections.size === 0) {
    console.log(`${langContext} ⚠️ EMERGENCY FIX: No attendees connected for audio forwarding`);
    return;
  }

  console.log(`${langContext} 🔄 EMERGENCY FIX: Forwarding audio to ${attendeeConnections.size} attendees`);
  
  const audioTracks = audioStream.getTracks().filter(track => track.kind === 'audio');
  
  Array.from(attendeeConnections.entries()).forEach(([attendeeId, attendeeConnection]) => {
    try {
      audioTracks.forEach((track, index) => {
        try {
          attendeeConnection.pc.addTrack(track, audioStream);
          console.log(`${langContext} ✅ EMERGENCY FIX: Audio track ${index} added to attendee ${attendeeId}`);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'InvalidAccessError') {
            console.log(`${langContext} ⚠️ Track ${index} already added to attendee ${attendeeId}`);
          } else {
            console.error(`${langContext} ❌ Error adding track to attendee ${attendeeId}:`, error);
          }
        }
      });
    } catch (error) {
      console.error(`${langContext} ❌ EMERGENCY FIX: Error forwarding to attendee ${attendeeId}:`, error);
    }
  });
}

/**
 * Emergency patch function to inject audio handling into existing system
 */
export function emergencyAudioPatch() {
  console.log('🚨 EMERGENCY AUDIO PATCH: Injecting proper audio handlers');
  
  // Make functions globally available for emergency use
  (window as any).emergencyAudioFix = {
    createOpenAIAudioHandler,
    forwardAudioToAttendees,
    openAIConnectionsByLanguage,
    attendeeConnectionsByLanguage
  };
  
  console.log('✅ EMERGENCY AUDIO PATCH: Functions injected globally');
  console.log('✅ Use window.emergencyAudioFix to access emergency functions');
}

// Auto-inject on module load
if (typeof window !== 'undefined') {
  emergencyAudioPatch();
}