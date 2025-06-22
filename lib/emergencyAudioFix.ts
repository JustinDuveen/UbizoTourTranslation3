/**
 * EMERGENCY AUDIO FIX - DEPLOYMENT DETECTION & AUTO-REPAIR
 * Senior WebRTC Developer Solution for Architecture Mismatch
 * 
 * This file detects and automatically fixes the audio reception issue
 * by ensuring proper OpenAI audio handlers are always present.
 */

import { createOpenAIAudioHandler, openAIConnectionsByLanguage, attendeeConnectionsByLanguage } from './audioHandlerFix';
import { normalizeLanguageForStorage } from './languageUtils';

interface AudioFixDiagnostics {
  hasProperAudioHandlers: boolean;
  hasOpenAIConnections: boolean;
  hasAttendeeConnections: boolean;
  deploymentVersion: 'repository' | 'legacy' | 'unknown';
  requiredFixes: string[];
}

/**
 * Diagnose the current audio handling state
 */
export function diagnoseAudioSystem(): AudioFixDiagnostics {
  const diagnostics: AudioFixDiagnostics = {
    hasProperAudioHandlers: false,
    hasOpenAIConnections: false,
    hasAttendeeConnections: false,
    deploymentVersion: 'unknown',
    requiredFixes: []
  };

  // Check if proper implementation is loaded
  try {
    if (typeof window !== 'undefined') {
      // EXPERT FIX: Check for main system by looking for initGuideWebRTC function
      // This indicates the repository implementation is loaded and working
      if ((window as any).initGuideWebRTC) {
        diagnostics.deploymentVersion = 'repository';
        diagnostics.hasProperAudioHandlers = true;
        diagnostics.hasOpenAIConnections = true; // Assume working if function exists
        return diagnostics; // Early return - main system is present
      }
      
      // EXPERT FIX: Also check for evidence of successful audio track reception
      // Look for console log evidence or audio elements with streams
      const allElements = document.querySelectorAll('audio[autoplay]');
      if (allElements.length > 0) {
        Array.from(allElements).forEach(element => {
          const audio = element as HTMLAudioElement;
          if (audio.srcObject && audio.srcObject instanceof MediaStream) {
            const audioTracks = audio.srcObject.getAudioTracks();
            if (audioTracks.length > 0) {
              diagnostics.hasOpenAIConnections = true;
              diagnostics.hasProperAudioHandlers = true;
              diagnostics.deploymentVersion = 'repository';
            }
          }
        });
      }
      
      // Check for legacy implementation only if repository not found
      if (diagnostics.deploymentVersion === 'unknown') {
        if ((window as any).guideSessionManager || (window as any).guideTranslationManager) {
          diagnostics.deploymentVersion = 'legacy';
          diagnostics.requiredFixes.push('Legacy implementation detected - missing audio handlers');
        }
      }
      
      // Check for connection maps in emergency system (fallback check)
      if (openAIConnectionsByLanguage.size > 0) {
        diagnostics.hasOpenAIConnections = true;
      }
      
      if (attendeeConnectionsByLanguage.size > 0) {
        diagnostics.hasAttendeeConnections = true;
      }
    }
  } catch (error) {
    console.error('Error diagnosing audio system:', error);
    diagnostics.requiredFixes.push('System diagnosis failed');
  }

  // EXPERT FIX: Only suggest fixes if repository implementation not found AND no working connections
  if (diagnostics.deploymentVersion !== 'repository' && !diagnostics.hasProperAudioHandlers && !diagnostics.hasOpenAIConnections) {
    diagnostics.requiredFixes.push('Missing OpenAI ontrack audio handlers');
  }

  return diagnostics;
}

// Track if RTCPeerConnection hook has been installed to prevent multiple installations
let rtcHookInstalled = false;

/**
 * Emergency fix injection - patches missing audio handlers
 */
export function injectEmergencyAudioFix(language: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const normalizedLanguage = normalizeLanguageForStorage(language);
      const langContext = `[${normalizedLanguage}]`;
      
      console.log(`${langContext} 🚨 EMERGENCY AUDIO FIX: Starting injection...`);
      
      // Diagnostic check
      const diagnostics = diagnoseAudioSystem();
      console.log(`${langContext} 📊 System diagnostics:`, diagnostics);
      
      // EXPERT FIX: Check if repository implementation is present - if so, abort immediately
      if (diagnostics.deploymentVersion === 'repository') {
        console.log(`${langContext} ✅ Repository implementation detected, emergency fix not needed`);
        resolve(true);
        return;
      }
      
      // EXPERT FIX: Check if main system is working before attempting emergency fix
      if (diagnostics.hasProperAudioHandlers || diagnostics.hasOpenAIConnections) {
        console.log(`${langContext} ✅ Main system working properly, emergency fix not needed`);
        resolve(true);
        return;
      }
      
      // Emergency fix for missing audio handlers
      console.log(`${langContext} 🔧 Injecting emergency audio handlers...`);
      
      // Wait for OpenAI connection to be available
      const checkForConnection = () => {
        // Check for stored OpenAI connection
        const connections = openAIConnectionsByLanguage.get(normalizedLanguage);
        
        // If we have a connection, inject the audio handler
        if (connections && connections.pc) {
          console.log(`${langContext} ✅ Found OpenAI connection, injecting audio handler`);
          createOpenAIAudioHandler(normalizedLanguage, connections.pc, connections.dc);
          resolve(true);
          return;
        }
        
        // EXPERT FIX: Only install RTCPeerConnection hook once and only if absolutely necessary
        if (typeof window !== 'undefined' && !rtcHookInstalled) {
          rtcHookInstalled = true;
          
          // Hook into RTCPeerConnection creation
          const originalRTCPeerConnection = (window as any).RTCPeerConnection;
          
          (window as any).RTCPeerConnection = function(...args: any[]) {
            const pc = new originalRTCPeerConnection(...args);
            
            // EXPERT FIX: Only log for OpenAI-specific connections to reduce spam
            pc.ondatachannel = (event: RTCDataChannelEvent) => {
              const channel = event.channel;
              
              if (channel.label === 'oai-events' || channel.label.includes('oai')) {
                console.log(`${langContext} 🎯 OpenAI data channel detected! Injecting audio handler...`);
                createOpenAIAudioHandler(normalizedLanguage, pc, channel);
              }
            };
            
            return pc;
          };
          
          // Copy static methods
          Object.setPrototypeOf((window as any).RTCPeerConnection, originalRTCPeerConnection);
          (window as any).RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
        }
        
        // Keep checking
        setTimeout(checkForConnection, 1000);
      };
      
      checkForConnection();
      
      // Timeout after 10 seconds
      setTimeout(() => {
        console.warn(`${langContext} ⚠️ Emergency fix timeout - could not detect OpenAI connection`);
        resolve(false);
      }, 10000);
      
    } catch (error) {
      console.error(`Emergency audio fix failed:`, error);
      resolve(false);
    }
  });
}

/**
 * Monitor for missing audio and auto-repair
 */
export function startAudioMonitoring(language: string) {
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const langContext = `[${normalizedLanguage}]`;
  
  let audioReceivedCount = 0;
  let monitoringInterval: NodeJS.Timeout;
  
  console.log(`${langContext} 🔍 Starting audio monitoring...`);
  
  const monitorAudioReception = () => {
    // EXPERT FIX: Check if repository implementation is present first
    const diagnostics = diagnoseAudioSystem();
    if (diagnostics.deploymentVersion === 'repository') {
      console.log(`${langContext} ✅ Repository implementation confirmed - stopping emergency monitoring`);
      clearInterval(monitoringInterval);
      return;
    }
    
    // EXPERT FIX: Also check for working audio elements as evidence of main system
    const audioElements = document.querySelectorAll('audio[autoplay]');
    let foundWorkingAudio = false;
    
    audioElements.forEach(element => {
      const audio = element as HTMLAudioElement;
      if (audio.srcObject && audio.srcObject instanceof MediaStream) {
        const audioTracks = audio.srcObject.getAudioTracks();
        if (audioTracks.length > 0) {
          foundWorkingAudio = true;
        }
      }
    });
    
    if (foundWorkingAudio) {
      audioReceivedCount++;
      console.log(`${langContext} ✅ Main system audio confirmed (check #${audioReceivedCount})`);
      
      if (audioReceivedCount >= 3) {
        console.log(`${langContext} ✅ Audio monitoring successful - main system working correctly`);
        clearInterval(monitoringInterval);
        return;
      }
    } else {
      // Check emergency system connections as fallback
      const connection = openAIConnectionsByLanguage.get(normalizedLanguage);
      
      if (connection && connection.audioStream) {
        audioReceivedCount++;
        console.log(`${langContext} ✅ Emergency system audio confirmed (check #${audioReceivedCount})`);
        
        if (audioReceivedCount >= 3) {
          console.log(`${langContext} ✅ Audio monitoring successful - emergency system working`);
          clearInterval(monitoringInterval);
          return;
        }
      } else {
        console.log(`${langContext} ⚠️ No audio stream detected - may need emergency fix`);
        
        // EXPERT FIX: Trigger emergency fix if no audio detected (we already confirmed no repository implementation above)
        if (audioReceivedCount === 0) {
          console.log(`${langContext} 🚨 No audio detected after monitoring period - triggering emergency fix`);
          injectEmergencyAudioFix(normalizedLanguage);
        }
      }
    }
  };
  
  // Check every 10 seconds
  monitoringInterval = setInterval(monitorAudioReception, 10000);
  
  // Stop monitoring after 2 minutes
  setTimeout(() => {
    clearInterval(monitoringInterval);
    console.log(`${langContext} 🔍 Audio monitoring period ended`);
  }, 120000);
}

/**
 * Complete emergency audio system initialization
 */
export async function initializeEmergencyAudioSystem(language: string): Promise<boolean> {
  // EXPERT FIX: Double-check environment variable - emergency system disabled by default
  if (typeof window !== 'undefined' && (window as any).process?.env?.NEXT_PUBLIC_ENABLE_EMERGENCY_AUDIO !== 'true') {
    console.log('🚫 Emergency audio system disabled by environment variable');
    return true;
  }
  
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const langContext = `[${normalizedLanguage}]`;
  
  console.log(`${langContext} 🚀 Initializing emergency audio system...`);
  
  // Run diagnostics
  const diagnostics = diagnoseAudioSystem();
  console.log(`${langContext} 📊 Initial diagnostics:`, diagnostics);
  
  // EXPERT FIX: If repository implementation detected, don't run emergency system at all
  if (diagnostics.deploymentVersion === 'repository') {
    console.log(`${langContext} ✅ Repository implementation detected - emergency system not needed`);
    return true;
  }
  
  // EXPERT FIX: Check if main system is working first
  if (diagnostics.hasProperAudioHandlers || diagnostics.hasOpenAIConnections) {
    console.log(`${langContext} ✅ Main audio system working properly, emergency system standing by`);
    // Still start monitoring for safety, but don't inject fixes
    startAudioMonitoring(normalizedLanguage);
    return true;
  }
  
  // Start monitoring
  startAudioMonitoring(normalizedLanguage);
  
  // Only inject fix if actually needed
  if (diagnostics.requiredFixes.length > 0) {
    console.log(`${langContext} 🔧 Required fixes detected:`, diagnostics.requiredFixes);
    const fixSuccess = await injectEmergencyAudioFix(normalizedLanguage);
    
    if (fixSuccess) {
      console.log(`${langContext} ✅ Emergency audio fix successfully injected`);
      return true;
    } else {
      console.error(`${langContext} ❌ Emergency audio fix failed`);
      return false;
    }
  }
  
  console.log(`${langContext} ✅ Audio system appears healthy, monitoring will continue`);
  return true;
}

// Auto-initialize when module loads
if (typeof window !== 'undefined') {
  console.log('🚨 EMERGENCY AUDIO SYSTEM: Module loaded and ready');
  
  // Make emergency functions globally available
  (window as any).emergencyAudioSystem = {
    diagnoseAudioSystem,
    injectEmergencyAudioFix,
    startAudioMonitoring,
    initializeEmergencyAudioSystem
  };
  
  console.log('✅ Emergency audio functions available at window.emergencyAudioSystem');
}