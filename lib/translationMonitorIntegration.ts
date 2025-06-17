/**
 * Translation Monitor Integration
 *
 * This file provides helper functions to integrate the translation monitor
 * with the existing guideWebRTC.ts code with minimal changes.
 *
 * IMPORTANT: This is a development/debugging tool and should be removed in production.
 */

import { TranslationMonitor } from './translationMonitor';

/**
 * Initialize the translation monitor if in development mode
 */
export function initializeMonitor(): void {
  // Only initialize if not in production and explicitly enabled
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR === 'true') {
    console.log('[MonitorIntegration] Initializing translation monitor (NODE_ENV !== "production" && NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR === "true")');

    // Check if the browser supports the monitor
    if (TranslationMonitor.isSupported()) {
      console.log('[MonitorIntegration] Browser supports translation monitor, initializing...');
      TranslationMonitor.initialize();
      console.log('[MonitorIntegration] Translation monitor initialized successfully');

      // Add global click handler to resume audio contexts
      document.addEventListener('click', function resumeAudioContexts() {
        console.log('[MonitorIntegration] User interaction detected, resuming audio contexts');

        // Resume the translation monitor's audio context
        if (TranslationMonitor.resumeAudioContext) {
          TranslationMonitor.resumeAudioContext();
        }

        // Audio elements are now handled automatically without debug classes

        // Only need this once
        document.removeEventListener('click', resumeAudioContexts);
      }, { once: true });

      // Add a system volume check reminder
      const volumeReminder = document.createElement('div');
      volumeReminder.textContent = '🔊 Please ensure your system volume is turned up';
      volumeReminder.style.position = 'fixed';
      volumeReminder.style.bottom = '10px';
      volumeReminder.style.left = '10px';
      volumeReminder.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      volumeReminder.style.color = 'white';
      volumeReminder.style.padding = '10px';
      volumeReminder.style.borderRadius = '5px';
      volumeReminder.style.zIndex = '9999';
      volumeReminder.style.fontSize = '14px';
      volumeReminder.style.fontWeight = 'bold';

      // Add a close button
      const closeButton = document.createElement('span');
      closeButton.textContent = '✕';
      closeButton.style.marginLeft = '10px';
      closeButton.style.cursor = 'pointer';
      closeButton.onclick = () => volumeReminder.remove();
      volumeReminder.appendChild(closeButton);

      // Add to document after a short delay
      setTimeout(() => {
        document.body.appendChild(volumeReminder);
        // Auto-remove after 10 seconds
        setTimeout(() => volumeReminder.remove(), 10000);
      }, 2000);
    } else {
      console.warn('[MonitorIntegration] Translation monitor not supported in this browser (when enabled)');
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      console.log('[MonitorIntegration] Skipping monitor initialization: Production mode.');
    } else {
      console.log('[MonitorIntegration] Skipping monitor initialization: NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR is not "true".');
    }
  }
}

/**
 * Enhance an existing ontrack handler with monitoring capabilities
 *
 * @param originalHandler The original ontrack handler
 * @param language The language being translated
 * @returns A new handler that includes monitoring
 */
export function enhanceOnTrackHandler(
  originalHandler: ((event: RTCTrackEvent) => void) | null,
  language: string
): (event: RTCTrackEvent) => void {
  console.log(`[MonitorIntegration] Creating enhanced track handler for language: ${language}`);

  return (event: RTCTrackEvent) => {
    console.log(`[MonitorIntegration] ontrack event received for language: ${language}, track kind: ${event.track.kind}`);

    // Call the original handler first
    if (originalHandler) {
      console.log(`[MonitorIntegration] Calling original handler for language: ${language}`);
      originalHandler(event);
    }

    // Then add monitoring if in development mode, explicitly enabled, and track is audio
    if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR === 'true' && event.track.kind === 'audio') {
      console.log(`[MonitorIntegration] Monitoring track for language: ${language} (NODE_ENV !== "production" && NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR === "true")`);

      // Small delay to ensure the original handler has completed its setup
      setTimeout(() => {
        console.log(`[MonitorIntegration] Setting up monitor for language: ${language}`);
        TranslationMonitor.monitorTrack(event.track, language);
      }, 500);
    }
  };
}

/**
 * Clean up the monitor when the guide WebRTC connection is closed
 */
export function cleanupMonitor(): void {
  // Only cleanup if it was potentially initialized (not in production and explicitly enabled)
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR === 'true') {
    console.log('[MonitorIntegration] Cleaning up translation monitor (NODE_ENV !== "production" && NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR === "true")');
    TranslationMonitor.cleanup();
    console.log('[MonitorIntegration] Translation monitor cleaned up successfully');
  } else {
    // No cleanup needed if not initialized under these conditions
    if (process.env.NODE_ENV === 'production') {
        console.log('[MonitorIntegration] Skipping monitor cleanup: Production mode.');
    } else {
        console.log('[MonitorIntegration] Skipping monitor cleanup: NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR is not "true".');
    }
  }
}

/**
 * Add a monitor button to the guide's UI
 *
 * @param container The container element to add the button to
 */
export function addMonitorButton(container: HTMLElement): void {
  // Only add button if in development mode and explicitly enabled
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR === 'true') {
    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex space-x-2 mt-2';

    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Toggle Monitor';
    toggleButton.className = 'bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded';
    toggleButton.onclick = () => {
      if (!TranslationMonitor.isInitialized) {
        TranslationMonitor.initialize();
      } else {
        TranslationMonitor.toggleMonitor();
      }
    };
    buttonContainer.appendChild(toggleButton);

    // Create minimize button
    const minimizeButton = document.createElement('button');
    minimizeButton.textContent = 'Minimize Monitor';
    minimizeButton.className = 'bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded';
    minimizeButton.onclick = () => {
      if (TranslationMonitor.isInitialized) {
        TranslationMonitor.toggleMinimize();
        minimizeButton.textContent = TranslationMonitor.isMinimized ? 'Expand Monitor' : 'Minimize Monitor';
      }
    };
    buttonContainer.appendChild(minimizeButton);

    container.appendChild(buttonContainer);
  }
}
