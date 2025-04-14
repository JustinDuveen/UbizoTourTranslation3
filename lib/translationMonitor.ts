/**
 * Translation Monitor Module
 *
 * A diagnostic tool for monitoring WebRTC audio translation in real-time.
 * This module allows guides to hear their own voice after it has been
 * translated by OpenAI, helping to diagnose audio capture and translation issues.
 *
 * IMPORTANT: This is a development/debugging tool and should be removed in production.
 */

// Types for better type safety
interface MonitorElements {
  container: HTMLDivElement | null;
  audioElement: HTMLAudioElement | null;
  levelIndicator: HTMLDivElement | null;
  levelBar: HTMLDivElement | null;
  toggleButton: HTMLButtonElement | null;
  statusText: HTMLDivElement | null;
  languageIndicator: HTMLDivElement | null;
}

interface MonitorState {
  isInitialized: boolean;
  isEnabled: boolean;
  isMinimized: boolean;
  currentLanguage: string | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  mediaStream: MediaStream | null;
  audioSource: MediaStreamAudioSourceNode | null;
  monitorInterval: number | null;
}

// Module state
const elements: MonitorElements = {
  container: null,
  audioElement: null,
  levelIndicator: null,
  levelBar: null,
  toggleButton: null,
  statusText: null,
  languageIndicator: null
};

const state: MonitorState = {
  isInitialized: false,
  isEnabled: true, // Start enabled by default
  isMinimized: false, // Start expanded by default
  currentLanguage: null,
  audioContext: null,
  analyser: null,
  mediaStream: null,
  audioSource: null,
  monitorInterval: null
};

/**
 * Initialize the translation monitor
 * Creates UI elements and sets up the audio context
 */
function initialize(): void {
  if (state.isInitialized) {
    console.log('[TranslationMonitor] Already initialized');
    return;
  }

  if (typeof window === 'undefined') {
    console.log('[TranslationMonitor] Cannot initialize in server-side environment');
    return;
  }

  console.log('[TranslationMonitor] Initializing translation monitor');

  // Create container for all monitor elements
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '20px';
  container.style.right = '20px';
  container.style.zIndex = '9999';
  container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  container.style.padding = '10px';
  container.style.borderRadius = '5px';
  container.style.color = 'white';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.width = '250px';
  container.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
  container.style.transition = 'transform 0.3s ease';
  elements.container = container;

  // Create title bar with controls
  const titleBar = document.createElement('div');
  titleBar.style.display = 'flex';
  titleBar.style.justifyContent = 'space-between';
  titleBar.style.alignItems = 'center';
  titleBar.style.marginBottom = '10px';
  titleBar.style.borderBottom = '1px solid #555';
  titleBar.style.paddingBottom = '5px';
  container.appendChild(titleBar);

  // Create title
  const title = document.createElement('div');
  title.textContent = 'Translation Monitor (Debug)';
  title.style.fontWeight = 'bold';
  titleBar.appendChild(title);

  // Create controls container
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '5px';
  titleBar.appendChild(controls);

  // Create minimize button
  const minimizeButton = document.createElement('button');
  minimizeButton.textContent = '−';
  minimizeButton.title = 'Minimize';
  minimizeButton.style.width = '24px';
  minimizeButton.style.height = '24px';
  minimizeButton.style.padding = '0';
  minimizeButton.style.backgroundColor = '#555';
  minimizeButton.style.color = 'white';
  minimizeButton.style.border = 'none';
  minimizeButton.style.borderRadius = '3px';
  minimizeButton.style.cursor = 'pointer';
  minimizeButton.style.fontSize = '16px';
  minimizeButton.style.lineHeight = '1';
  minimizeButton.onclick = toggleMinimize;
  controls.appendChild(minimizeButton);

  // Create content container for minimizable content
  const contentContainer = document.createElement('div');
  contentContainer.id = 'monitor-content';
  contentContainer.style.transition = 'height 0.3s ease, opacity 0.3s ease';
  container.appendChild(contentContainer);

  // Create language indicator
  const languageIndicator = document.createElement('div');
  languageIndicator.textContent = 'Language: None';
  languageIndicator.style.marginBottom = '5px';
  languageIndicator.style.fontSize = '12px';
  elements.languageIndicator = languageIndicator;
  contentContainer.appendChild(languageIndicator);

  // Create status text
  const statusText = document.createElement('div');
  statusText.textContent = 'Waiting for audio...';
  statusText.style.marginBottom = '5px';
  statusText.style.fontSize = '12px';
  elements.statusText = statusText;
  contentContainer.appendChild(statusText);

  // Create audio level indicator
  const levelIndicator = document.createElement('div');
  levelIndicator.style.width = '100%';
  levelIndicator.style.height = '20px';
  levelIndicator.style.backgroundColor = '#333';
  levelIndicator.style.marginBottom = '10px';
  levelIndicator.style.position = 'relative';
  elements.levelIndicator = levelIndicator;

  const levelBar = document.createElement('div');
  levelBar.style.width = '0%';
  levelBar.style.height = '100%';
  levelBar.style.backgroundColor = '#4CAF50';
  levelBar.style.transition = 'width 0.1s';
  elements.levelBar = levelBar;
  levelIndicator.appendChild(levelBar);
  contentContainer.appendChild(levelIndicator);

  // Create audio element with controls
  const audioElement = document.createElement('audio');
  audioElement.autoplay = true;
  audioElement.muted = false;
  audioElement.volume = 0.8; // Higher volume for better audibility
  audioElement.controls = true; // Add controls for manual playback
  audioElement.style.width = '100%';
  audioElement.style.marginBottom = '10px';
  audioElement.style.display = 'block'; // Make the audio element visible
  elements.audioElement = audioElement;
  contentContainer.appendChild(audioElement);

  // Add a label for the audio element
  const audioLabel = document.createElement('div');
  audioLabel.textContent = 'Translation Audio:';
  audioLabel.style.fontSize = '12px';
  audioLabel.style.marginBottom = '5px';
  audioLabel.style.fontWeight = 'bold';
  contentContainer.insertBefore(audioLabel, audioElement);

  // Create volume control
  const volumeContainer = document.createElement('div');
  volumeContainer.style.display = 'flex';
  volumeContainer.style.alignItems = 'center';
  volumeContainer.style.marginBottom = '10px';

  const volumeLabel = document.createElement('div');
  volumeLabel.textContent = 'Volume:';
  volumeLabel.style.marginRight = '10px';
  volumeLabel.style.fontSize = '12px';
  volumeContainer.appendChild(volumeLabel);

  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.min = '0';
  volumeSlider.max = '100';
  volumeSlider.value = '50'; // 50% volume
  volumeSlider.style.flex = '1';
  volumeSlider.addEventListener('input', () => {
    if (elements.audioElement) {
      elements.audioElement.volume = parseInt(volumeSlider.value) / 100;
    }
  });
  volumeContainer.appendChild(volumeSlider);
  contentContainer.appendChild(volumeContainer);

  // Create toggle button
  const toggleButton = document.createElement('button');
  toggleButton.textContent = state.isEnabled ? 'Disable Monitor' : 'Enable Monitor';
  toggleButton.style.width = '100%';
  toggleButton.style.padding = '5px';
  toggleButton.style.backgroundColor = state.isEnabled ? '#f44336' : '#4CAF50';
  toggleButton.style.color = 'white';
  toggleButton.style.border = 'none';
  toggleButton.style.borderRadius = '3px';
  toggleButton.style.cursor = 'pointer';
  toggleButton.onclick = toggleMonitor;
  elements.toggleButton = toggleButton;
  contentContainer.appendChild(toggleButton);

  // Add close button
  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close Monitor';
  closeButton.style.width = '100%';
  closeButton.style.padding = '5px';
  closeButton.style.backgroundColor = '#555';
  closeButton.style.color = 'white';
  closeButton.style.border = 'none';
  closeButton.style.borderRadius = '3px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.marginTop = '5px';
  closeButton.onclick = cleanup;
  contentContainer.appendChild(closeButton);

  // Add to document
  document.body.appendChild(container);

  // Initialize audio context if supported
  try {
    if (window.AudioContext || (window as any).webkitAudioContext) {
      state.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('[TranslationMonitor] AudioContext created');
    } else {
      console.warn('[TranslationMonitor] AudioContext not supported in this browser');
    }
  } catch (e) {
    console.error('[TranslationMonitor] Error creating AudioContext:', e);
  }

  state.isInitialized = true;
  console.log('[TranslationMonitor] Initialization complete');
}

/**
 * Toggle the monitor on/off
 */
function toggleMonitor(): void {
  if (!state.isInitialized) {
    console.warn('[TranslationMonitor] Cannot toggle: Monitor not initialized');
    return;
  }

  state.isEnabled = !state.isEnabled;

  if (elements.toggleButton) {
    elements.toggleButton.textContent = state.isEnabled ? 'Disable Monitor' : 'Enable Monitor';
    elements.toggleButton.style.backgroundColor = state.isEnabled ? '#f44336' : '#4CAF50';
  }

  if (elements.audioElement) {
    elements.audioElement.muted = !state.isEnabled;
  }

  console.log(`[TranslationMonitor] Monitor ${state.isEnabled ? 'enabled' : 'disabled'}`);

  // Update status text
  if (elements.statusText) {
    elements.statusText.textContent = state.isEnabled
      ? 'Monitoring active...'
      : 'Monitoring paused';
  }

  // Stop/start audio level monitoring
  if (!state.isEnabled && state.monitorInterval) {
    clearInterval(state.monitorInterval);
    state.monitorInterval = null;
    if (elements.levelBar) {
      elements.levelBar.style.width = '0%';
    }
  } else if (state.isEnabled && state.analyser) {
    startLevelMonitoring();
  }
}

/**
 * Monitor an audio track
 * @param track The MediaStreamTrack to monitor
 * @param language The language being translated
 */
function monitorTrack(track: MediaStreamTrack, language: string): void {
  console.log(`[TranslationMonitor] monitorTrack called for language: ${language}, track ID: ${track.id}`);
  console.log(`[TranslationMonitor] Track details: kind=${track.kind}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);

  if (!state.isInitialized) {
    console.warn('[TranslationMonitor] Cannot monitor track: Monitor not initialized');
    console.log('[TranslationMonitor] Attempting to initialize monitor now...');
    initialize();
  }

  if (!state.isEnabled) {
    console.log('[TranslationMonitor] Monitor is disabled, not connecting track');
    return;
  }

  console.log(`[TranslationMonitor] Monitoring track for language: ${language}`);
  state.currentLanguage = language;

  // Update language indicator
  if (elements.languageIndicator) {
    elements.languageIndicator.textContent = `Language: ${language}`;
    console.log('[TranslationMonitor] Updated language indicator in UI');
  } else {
    console.warn('[TranslationMonitor] Language indicator element not found in UI');
  }

  // Clean up any existing monitoring
  console.log('[TranslationMonitor] Cleaning up any existing monitoring');
  stopMonitoring();

  // Create a new MediaStream with this track
  try {
    // Clone the track to avoid interference with the main connection
    console.log('[TranslationMonitor] Cloning track...');
    const clonedTrack = track.clone();
    console.log(`[TranslationMonitor] Track cloned successfully, new ID: ${clonedTrack.id}`);

    state.mediaStream = new MediaStream([clonedTrack]);
    console.log('[TranslationMonitor] Created new MediaStream with cloned track');

    // Connect to audio element
    if (elements.audioElement) {
      console.log('[TranslationMonitor] Connecting MediaStream to audio element');
      elements.audioElement.srcObject = state.mediaStream;

      // Try to play (handle autoplay restrictions)
      console.log('[TranslationMonitor] Attempting to play audio...');
      elements.audioElement.play().then(() => {
        console.log('[TranslationMonitor] Audio playback started successfully');
        if (elements.statusText) {
          elements.statusText.textContent = 'Audio playing ✓';
          elements.statusText.style.color = '#4CAF50';
        }
      }).catch(e => {
        console.warn('[TranslationMonitor] Autoplay prevented:', e);

        // Create a prominent play button
        const playButton = document.createElement('button');
        playButton.textContent = '▶️ Click to Enable Translation Audio';
        playButton.style.width = '100%';
        playButton.style.padding = '10px';
        playButton.style.backgroundColor = '#4CAF50';
        playButton.style.color = 'white';
        playButton.style.border = 'none';
        playButton.style.borderRadius = '4px';
        playButton.style.cursor = 'pointer';
        playButton.style.marginBottom = '10px';
        playButton.style.fontWeight = 'bold';
        playButton.style.fontSize = '14px';

        // Show a message about autoplay being blocked
        if (elements.statusText) {
          elements.statusText.textContent = '⚠️ Audio blocked - Click button below';
          elements.statusText.style.color = '#ff9800';
          console.log('[TranslationMonitor] Updated status text to indicate autoplay blocked');
        }

        // Add the button to the container
        if (elements.container) {
          // Insert the button after the status text
          const contentContainer = elements.container?.querySelector('#monitor-content');
          if (elements.statusText && contentContainer) {
            contentContainer.insertBefore(playButton, elements.statusText.nextSibling);
          } else if (contentContainer) {
            contentContainer.appendChild(playButton);
          } else {
            elements.container?.appendChild(playButton);
          }

          // Add click handler to the button
          playButton.onclick = () => {
            console.log('[TranslationMonitor] Play button clicked, attempting to play audio...');

            // Try to resume AudioContext if it's suspended
            if (state.audioContext && state.audioContext.state === 'suspended') {
              state.audioContext.resume().then(() => {
                console.log('[TranslationMonitor] AudioContext resumed successfully');
              }).catch(err => {
                console.error('[TranslationMonitor] Failed to resume AudioContext:', err);
              });
            }

            // Try to play the audio
            elements.audioElement?.play().then(() => {
              console.log('[TranslationMonitor] Audio playback started after button click');
              if (elements.statusText) {
                elements.statusText.textContent = 'Audio playing ✓';
                elements.statusText.style.color = '#4CAF50';
              }
              playButton.remove();
            }).catch(err => {
              console.error('[TranslationMonitor] Failed to play audio after button click:', err);
              playButton.textContent = 'Try Again - Audio Failed to Play';
              playButton.style.backgroundColor = '#f44336';
            });
          };

          console.log('[TranslationMonitor] Added play button to container');
        } else {
          console.warn('[TranslationMonitor] Container element not found, cannot add play button');
        }
      });
    } else {
      console.warn('[TranslationMonitor] Audio element not found, cannot connect MediaStream');
    }

    // Set up audio analysis if AudioContext is available
    if (state.audioContext) {
      console.log('[TranslationMonitor] Setting up audio analysis...');
      setupAudioAnalysis();
    } else {
      console.warn('[TranslationMonitor] AudioContext not available, cannot set up audio analysis');
    }

    console.log('[TranslationMonitor] Track connected successfully');
  } catch (e) {
    console.error('[TranslationMonitor] Error connecting track:', e);
    if (elements.statusText) {
      elements.statusText.textContent = 'Error connecting audio';
      elements.statusText.style.color = '#f44336';
      console.log('[TranslationMonitor] Updated status text to indicate error');
    }
  }
}

/**
 * Set up audio analysis for level monitoring
 */
function setupAudioAnalysis(): void {
  console.log('[TranslationMonitor] Setting up audio analysis...');

  if (!state.audioContext) {
    console.warn('[TranslationMonitor] Cannot set up audio analysis: Missing AudioContext');
    return;
  }

  if (!state.mediaStream) {
    console.warn('[TranslationMonitor] Cannot set up audio analysis: Missing MediaStream');
    return;
  }

  try {
    // Create analyzer
    console.log('[TranslationMonitor] Creating audio analyzer...');
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    console.log(`[TranslationMonitor] Analyzer created with fftSize: ${state.analyser.fftSize}`);

    // Create source from media stream
    console.log('[TranslationMonitor] Creating media stream source...');
    state.audioSource = state.audioContext.createMediaStreamSource(state.mediaStream);
    console.log('[TranslationMonitor] Connecting source to analyzer...');
    state.audioSource.connect(state.analyser);

    // Start monitoring audio levels
    console.log('[TranslationMonitor] Starting level monitoring...');
    startLevelMonitoring();

    console.log('[TranslationMonitor] Audio analysis set up successfully');
  } catch (e) {
    console.error('[TranslationMonitor] Error setting up audio analysis:', e);
  }
}

/**
 * Start monitoring audio levels
 */
function startLevelMonitoring(): void {
  console.log('[TranslationMonitor] Starting level monitoring...');

  if (!state.analyser) {
    console.warn('[TranslationMonitor] Cannot start level monitoring: Missing analyser');
    return;
  }

  if (!elements.levelBar) {
    console.warn('[TranslationMonitor] Cannot start level monitoring: Missing level bar element');
    return;
  }

  // Clear any existing interval
  if (state.monitorInterval) {
    console.log('[TranslationMonitor] Clearing existing monitor interval');
    clearInterval(state.monitorInterval);
  }

  console.log(`[TranslationMonitor] Creating data array with size: ${state.analyser.frequencyBinCount}`);
  const dataArray = new Uint8Array(state.analyser.frequencyBinCount);

  // Update level bar every 100ms
  console.log('[TranslationMonitor] Setting up monitoring interval (100ms)');
  state.monitorInterval = window.setInterval(() => {
    if (!state.analyser) {
      console.warn('[TranslationMonitor] Analyser no longer available, stopping monitoring');
      if (state.monitorInterval) clearInterval(state.monitorInterval);
      return;
    }

    state.analyser.getByteFrequencyData(dataArray);

    // Calculate average level
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const level = Math.min(100, average * 2); // Scale to percentage, max 100%

    // Only log significant level changes to avoid console spam
    if (level > 20) {
      console.log(`[TranslationMonitor] Audio level: ${Math.round(level)}%`);
    }

    // Update level bar
    if (elements.levelBar) {
      elements.levelBar.style.width = `${level}%`;

      // Change color based on level
      if (level > 50) {
        elements.levelBar.style.backgroundColor = '#4CAF50'; // Green
      } else if (level > 10) {
        elements.levelBar.style.backgroundColor = '#FFC107'; // Yellow
      } else {
        elements.levelBar.style.backgroundColor = '#F44336'; // Red
      }
    }

    // Update status text
    if (elements.statusText) {
      if (level > 5) {
        elements.statusText.textContent = `Receiving audio: ${Math.round(level)}% level`;
        elements.statusText.style.color = '#4CAF50';
      } else {
        elements.statusText.textContent = 'No audio detected';
        elements.statusText.style.color = '#F44336';
      }
    }
  }, 100);

  console.log('[TranslationMonitor] Level monitoring started successfully');
}

/**
 * Stop monitoring the current track
 */
function stopMonitoring(): void {
  console.log('[TranslationMonitor] Stopping monitoring...');

  // Stop interval
  if (state.monitorInterval) {
    console.log('[TranslationMonitor] Clearing monitor interval');
    clearInterval(state.monitorInterval);
    state.monitorInterval = null;
  } else {
    console.log('[TranslationMonitor] No monitor interval to clear');
  }

  // Disconnect audio source
  if (state.audioSource) {
    console.log('[TranslationMonitor] Disconnecting audio source');
    state.audioSource.disconnect();
    state.audioSource = null;
  } else {
    console.log('[TranslationMonitor] No audio source to disconnect');
  }

  // Stop all tracks in the media stream
  if (state.mediaStream) {
    const trackCount = state.mediaStream.getTracks().length;
    console.log(`[TranslationMonitor] Stopping ${trackCount} media stream tracks`);

    state.mediaStream.getTracks().forEach(track => {
      console.log(`[TranslationMonitor] Stopping track: ${track.id}, kind: ${track.kind}`);
      track.stop();
    });
    state.mediaStream = null;
  } else {
    console.log('[TranslationMonitor] No media stream to stop');
  }

  // Clear audio element
  if (elements.audioElement) {
    console.log('[TranslationMonitor] Clearing audio element source');
    elements.audioElement.srcObject = null;
  } else {
    console.log('[TranslationMonitor] No audio element to clear');
  }

  // Reset level bar
  if (elements.levelBar) {
    console.log('[TranslationMonitor] Resetting level bar');
    elements.levelBar.style.width = '0%';
  } else {
    console.log('[TranslationMonitor] No level bar to reset');
  }

  // Reset status
  if (elements.statusText) {
    console.log('[TranslationMonitor] Resetting status text');
    elements.statusText.textContent = 'Waiting for audio...';
    elements.statusText.style.color = 'white';
  } else {
    console.log('[TranslationMonitor] No status text to reset');
  }

  console.log('[TranslationMonitor] Monitoring stopped successfully');
}

/**
 * Clean up all resources and remove UI elements
 */
function cleanup(): void {
  console.log('[TranslationMonitor] Cleanup called');

  if (!state.isInitialized) {
    console.log('[TranslationMonitor] Monitor not initialized, nothing to clean up');
    return;
  }

  console.log('[TranslationMonitor] Cleaning up translation monitor');

  // Stop monitoring
  console.log('[TranslationMonitor] Stopping monitoring as part of cleanup');
  stopMonitoring();

  // Close audio context
  if (state.audioContext) {
    if (state.audioContext.state !== 'closed') {
      console.log('[TranslationMonitor] Closing AudioContext');
      state.audioContext.close();
    } else {
      console.log('[TranslationMonitor] AudioContext already closed');
    }
    state.audioContext = null;
  } else {
    console.log('[TranslationMonitor] No AudioContext to close');
  }

  // Remove UI elements
  if (elements.container) {
    if (elements.container.parentNode) {
      console.log('[TranslationMonitor] Removing UI container from DOM');
      elements.container.parentNode.removeChild(elements.container);
    } else {
      console.log('[TranslationMonitor] Container not in DOM, nothing to remove');
    }
  } else {
    console.log('[TranslationMonitor] No container element to remove');
  }

  // Reset elements
  console.log('[TranslationMonitor] Resetting all UI elements');
  Object.keys(elements).forEach(key => {
    elements[key as keyof MonitorElements] = null;
  });

  // Reset state
  console.log('[TranslationMonitor] Resetting monitor state');
  state.isInitialized = false;
  state.isEnabled = true;
  state.currentLanguage = null;
  state.analyser = null;

  console.log('[TranslationMonitor] Cleanup complete');
}

/**
 * Check if the browser environment supports the monitor
 */
function isSupported(): boolean {
  if (typeof window === 'undefined') return false;

  const hasAudioContext = !!(window.AudioContext || (window as any).webkitAudioContext);
  const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  return hasAudioContext && hasMediaDevices;
}

/**
 * Toggle the minimized state of the monitor
 */
function toggleMinimize(): void {
  if (!state.isInitialized || !elements.container) {
    console.warn('[TranslationMonitor] Cannot toggle minimize: Monitor not initialized');
    return;
  }

  state.isMinimized = !state.isMinimized;
  const contentContainer = elements.container.querySelector('#monitor-content');

  if (!contentContainer) {
    console.warn('[TranslationMonitor] Content container not found');
    return;
  }

  if (state.isMinimized) {
    // Minimize the monitor
    contentContainer.style.height = '0';
    contentContainer.style.overflow = 'hidden';
    contentContainer.style.opacity = '0';
    contentContainer.style.pointerEvents = 'none';

    // Update minimize button
    const minimizeButton = elements.container.querySelector('button[title="Minimize"]');
    if (minimizeButton) {
      minimizeButton.textContent = '+';
      minimizeButton.title = 'Expand';
    }
  } else {
    // Expand the monitor
    contentContainer.style.height = 'auto';
    contentContainer.style.overflow = 'visible';
    contentContainer.style.opacity = '1';
    contentContainer.style.pointerEvents = 'auto';

    // Update minimize button
    const minimizeButton = elements.container.querySelector('button[title="Expand"]');
    if (minimizeButton) {
      minimizeButton.textContent = '−';
      minimizeButton.title = 'Minimize';
    }
  }

  console.log(`[TranslationMonitor] Monitor ${state.isMinimized ? 'minimized' : 'expanded'}`);
}

// Export the public API
export const TranslationMonitor = {
  initialize,
  monitorTrack,
  toggleMonitor,
  toggleMinimize,
  stopMonitoring,
  cleanup,
  isSupported,

  // Resume the audio context if it's suspended
  resumeAudioContext(): void {
    if (state.audioContext && state.audioContext.state === 'suspended') {
      console.log('[TranslationMonitor] Resuming suspended AudioContext');
      state.audioContext.resume().then(() => {
        console.log('[TranslationMonitor] AudioContext resumed successfully');
      }).catch(err => {
        console.error('[TranslationMonitor] Failed to resume AudioContext:', err);
      });
    } else {
      console.log('[TranslationMonitor] AudioContext already running or not available');
    }
  },

  // Getter for state
  get isInitialized(): boolean {
    return state.isInitialized;
  },

  get isEnabled(): boolean {
    return state.isEnabled;
  },

  get isMinimized(): boolean {
    return state.isMinimized;
  }
};
