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

  // EMERGENCY: Simplified ontrack handler aligned with main system
  const audioTrackHandler = (e: RTCTrackEvent) => {
    console.log(`${langContext} 🎵 EMERGENCY FIX: AUDIO TRACK RECEIVED from OpenAI 🎵`);
    
    if (e.track.kind === 'audio') {
      console.log(`${langContext} ✅ EMERGENCY FIX: OpenAI audio track received`);
      
      // Get the stream - OpenAI pattern
      const stream = e.streams[0];
      
      // Store in connection immediately
      let connection = openAIConnectionsByLanguage.get(normalizedLanguage);
      
      if (!connection) {
        console.log(`${langContext} 🔄 EMERGENCY FIX: Creating connection for audio storage`);
        const audioElement = document.createElement('audio');
        audioElement.autoplay = true;
        
        connection = {
          pc: openaiPC,
          dc: openaiDC,
          audioStream: stream,
          microphoneTracks: [],
          audioElement: audioElement
        };
        
        openAIConnectionsByLanguage.set(normalizedLanguage, connection);
        console.log(`${langContext} ✅ EMERGENCY FIX: Connection created with audio stream`);
      } else {
        connection.audioStream = stream;
        console.log(`${langContext} ✅ EMERGENCY FIX: Audio stream stored`);
      }
      
      // Set audio element source - OpenAI pattern
      if (connection.audioElement) {
        connection.audioElement.srcObject = stream;
        console.log(`${langContext} ✅ EMERGENCY FIX: Audio stream connected to audio element`);
      }

      // Forward to attendees immediately
      forwardAudioToAttendees(normalizedLanguage, stream);
      
      console.log(`${langContext} ✅ EMERGENCY FIX: Audio stream stored and forwarded`);
    } else {
      console.log(`${langContext} Received non-audio track: ${e.track.kind}`);
    }
  };

  // Set the emergency audio handler - simplified pattern
  openaiPC.ontrack = audioTrackHandler;
  console.log(`${langContext} ✅ EMERGENCY FIX: Simplified OpenAI audio handler installed`);
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