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
      // Check for repository implementation
      if ((window as any).initGuideWebRTC) {
        diagnostics.deploymentVersion = 'repository';
        diagnostics.hasProperAudioHandlers = true;
      }
      
      // Check for legacy implementation (what the logs suggest is running)
      if ((window as any).guideSessionManager || (window as any).guideTranslationManager) {
        diagnostics.deploymentVersion = 'legacy';
        diagnostics.requiredFixes.push('Legacy implementation detected - missing audio handlers');
      }
      
      // Check for connection maps
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

  // Determine required fixes
  if (!diagnostics.hasProperAudioHandlers) {
    diagnostics.requiredFixes.push('Missing OpenAI ontrack audio handlers');
  }
  
  if (diagnostics.deploymentVersion === 'legacy') {
    diagnostics.requiredFixes.push('Legacy deployment needs audio handler injection');
  }

  return diagnostics;
}

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
      
      if (diagnostics.hasProperAudioHandlers && diagnostics.deploymentVersion === 'repository') {
        console.log(`${langContext} ✅ Proper implementation detected, no fix needed`);
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
        
        // If no direct connection found, try to detect any RTCPeerConnection
        if (typeof window !== 'undefined') {
          // Hook into RTCPeerConnection creation
          const originalRTCPeerConnection = (window as any).RTCPeerConnection;
          
          (window as any).RTCPeerConnection = function(...args: any[]) {
            const pc = new originalRTCPeerConnection(...args);
            
            console.log(`${langContext} 🔍 New RTCPeerConnection detected, checking for OpenAI...`);
            
            // If this connection starts receiving data channels, it might be OpenAI
            pc.ondatachannel = (event: RTCDataChannelEvent) => {
              const channel = event.channel;
              console.log(`${langContext} 📡 Data channel received: ${channel.label}`);
              
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
    const connection = openAIConnectionsByLanguage.get(normalizedLanguage);
    
    if (connection && connection.audioStream) {
      audioReceivedCount++;
      console.log(`${langContext} ✅ Audio stream confirmed (check #${audioReceivedCount})`);
      
      if (audioReceivedCount >= 3) {
        console.log(`${langContext} ✅ Audio monitoring successful - system working correctly`);
        clearInterval(monitoringInterval);
        return;
      }
    } else {
      console.log(`${langContext} ⚠️ No audio stream detected - may need emergency fix`);
      
      // Trigger emergency fix if no audio after 30 seconds
      if (audioReceivedCount === 0) {
        console.log(`${langContext} 🚨 No audio detected after monitoring period - triggering emergency fix`);
        injectEmergencyAudioFix(normalizedLanguage);
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
  const normalizedLanguage = normalizeLanguageForStorage(language);
  const langContext = `[${normalizedLanguage}]`;
  
  console.log(`${langContext} 🚀 Initializing emergency audio system...`);
  
  // Run diagnostics
  const diagnostics = diagnoseAudioSystem();
  console.log(`${langContext} 📊 Initial diagnostics:`, diagnostics);
  
  // Start monitoring
  startAudioMonitoring(normalizedLanguage);
  
  // Inject fix if needed
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