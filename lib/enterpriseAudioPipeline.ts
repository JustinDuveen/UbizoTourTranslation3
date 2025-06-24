/**
 * Enterprise Audio Pipeline Manager
 * 
 * Centralized audio processing system that replaces fragmented audio handlers
 * with a single, consistent, and enterprise-grade audio management solution.
 * 
 * @author Senior WebRTC Developer
 * @version 1.0.0
 */

export interface AudioTrackInfo {
  track: MediaStreamTrack;
  connectionId: string;
  role: 'guide' | 'attendee';
  language: string;
  createdAt: number;
  lastActivity: number;
  isActive: boolean;
}

export interface AudioProcessingConfig {
  enableNoiseSupression: boolean;
  enableEchoCancellation: boolean;
  enableAutoGainControl: boolean;
  sampleRate: number;
  channelCount: number;
  bufferSize: number;
}

export interface AudioForwardingRule {
  sourceLanguage: string;
  targetLanguages: string[];
  connectionIds: string[];
}

/**
 * Audio Processing Chain for enterprise-grade audio handling
 */
class AudioProcessingChain {
  private audioContext: AudioContext;
  private sourceNode!: MediaStreamAudioSourceNode;
  private gainNode!: GainNode;
  private outputDestination!: MediaStreamAudioDestinationNode;
  private isActive: boolean = false;

  constructor(
    private inputTrack: MediaStreamTrack,
    private config: AudioProcessingConfig
  ) {
    this.audioContext = new AudioContext({
      sampleRate: config.sampleRate,
      latencyHint: 'interactive' // Optimize for low latency
    });

    this.initializeProcessingChain();
  }

  private initializeProcessingChain(): void {
    try {
      // Create source from input track
      const inputStream = new MediaStream([this.inputTrack]);
      this.sourceNode = this.audioContext.createMediaStreamSource(inputStream);

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0;

      // Create output destination
      this.outputDestination = this.audioContext.createMediaStreamDestination();

      // Connect the processing chain
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.outputDestination);

      this.isActive = true;
      console.log('Audio processing chain initialized successfully');
    } catch (error) {
      console.error('Failed to initialize audio processing chain:', error);
      throw error;
    }
  }

  getOutputStream(): MediaStream {
    if (!this.isActive) {
      throw new Error('Audio processing chain is not active');
    }
    return this.outputDestination.stream;
  }

  setGain(gain: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(2, gain)); // Clamp between 0 and 2
    }
  }

  async resumeIfSuspended(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      console.log('Audio context resumed');
    }
  }

  cleanup(): void {
    try {
      if (this.sourceNode) {
        this.sourceNode.disconnect();
      }
      if (this.gainNode) {
        this.gainNode.disconnect();
      }
      if (this.outputDestination) {
        this.outputDestination.disconnect();
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close();
      }
      this.isActive = false;
      console.log('Audio processing chain cleaned up');
    } catch (error) {
      console.error('Error during audio processing chain cleanup:', error);
    }
  }
}

/**
 * Enterprise Audio Pipeline Manager
 * Singleton pattern for centralized audio management
 */
export class EnterpriseAudioPipeline {
  private static instance: EnterpriseAudioPipeline;
  private trackRegistry: Map<string, AudioTrackInfo> = new Map();
  private processingChains: Map<string, AudioProcessingChain> = new Map();
  private forwardingRules: Map<string, AudioForwardingRule> = new Map();
  private attendeeConnections: Map<string, Map<string, any>> = new Map(); // language -> connectionId -> connection
  private cleanupInterval!: NodeJS.Timeout;

  private readonly DEFAULT_CONFIG: AudioProcessingConfig = {
    enableNoiseSupression: true,
    enableEchoCancellation: true,
    enableAutoGainControl: true,
    sampleRate: 48000, // High quality for Opus
    channelCount: 1, // Mono for speech
    bufferSize: 1024
  };

  private constructor() {
    this.startCleanupTimer();
    console.log('Enterprise Audio Pipeline initialized');
  }

  static getInstance(): EnterpriseAudioPipeline {
    if (!EnterpriseAudioPipeline.instance) {
      EnterpriseAudioPipeline.instance = new EnterpriseAudioPipeline();
    }
    return EnterpriseAudioPipeline.instance;
  }

  /**
   * Process incoming audio track with enterprise-grade handling
   */
  async processIncomingTrack(
    track: MediaStreamTrack,
    connectionId: string,
    role: 'guide' | 'attendee',
    language: string = 'en',
    config: Partial<AudioProcessingConfig> = {}
  ): Promise<MediaStream> {
    const trackInfo: AudioTrackInfo = {
      track,
      connectionId,
      role,
      language,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isActive: true
    };

    // Register track for lifecycle management
    this.registerTrack(trackInfo);

    // Create processing chain with merged config
    const processingConfig = { ...this.DEFAULT_CONFIG, ...config };
    const processingChain = new AudioProcessingChain(track, processingConfig);

    // Store processing chain
    this.processingChains.set(connectionId, processingChain);

    // Resume audio context if needed (for user interaction requirements)
    await processingChain.resumeIfSuspended();

    // Set up track event handlers
    this.setupTrackEventHandlers(track, connectionId);

    console.log(`Audio track processed for ${role} connection ${connectionId} (${language})`);

    return processingChain.getOutputStream();
  }

  /**
   * Forward audio from guide to attendees efficiently
   */
  forwardAudioToAttendees(
    sourceConnectionId: string,
    targetLanguage: string
  ): void {
    const sourceChain = this.processingChains.get(sourceConnectionId);
    if (!sourceChain) {
      console.warn(`No processing chain found for source connection ${sourceConnectionId}`);
      return;
    }

    const attendeeConnections = this.attendeeConnections.get(targetLanguage);
    if (!attendeeConnections || attendeeConnections.size === 0) {
      console.log(`No attendees connected for language ${targetLanguage}`);
      return;
    }

    const audioStream = sourceChain.getOutputStream();
    const audioTracks = audioStream.getAudioTracks();

    if (audioTracks.length === 0) {
      console.warn(`No audio tracks available in source stream for ${sourceConnectionId}`);
      return;
    }

    console.log(`Forwarding audio to ${attendeeConnections.size} attendees for language ${targetLanguage}`);

    // Forward to each attendee connection
    attendeeConnections.forEach((connection, attendeeId) => {
      try {
        audioTracks.forEach((track, index) => {
          try {
            // Check if track is already added to avoid duplicates
            const senders = connection.pc.getSenders();
            const trackAlreadyAdded = senders.some((sender: RTCRtpSender) => sender.track === track);

            if (!trackAlreadyAdded) {
              connection.pc.addTrack(track, audioStream);
              console.log(`Audio track ${index} added to attendee ${attendeeId}`);
            } else {
              console.log(`Audio track ${index} already added to attendee ${attendeeId}`);
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === 'InvalidAccessError') {
              console.log(`Track ${index} already added to attendee ${attendeeId}`);
            } else {
              console.error(`Error adding track ${index} to attendee ${attendeeId}:`, error);
            }
          }
        });
      } catch (error) {
        console.error(`Error forwarding audio to attendee ${attendeeId}:`, error);
      }
    });
  }

  /**
   * Register attendee connection for audio forwarding
   */
  registerAttendeeConnection(
    language: string,
    attendeeId: string,
    connection: any
  ): void {
    if (!this.attendeeConnections.has(language)) {
      this.attendeeConnections.set(language, new Map());
    }

    const languageConnections = this.attendeeConnections.get(language)!;
    languageConnections.set(attendeeId, connection);

    console.log(`Registered attendee ${attendeeId} for language ${language}`);
  }

  /**
   * Unregister attendee connection
   */
  unregisterAttendeeConnection(language: string, attendeeId: string): void {
    const languageConnections = this.attendeeConnections.get(language);
    if (languageConnections) {
      languageConnections.delete(attendeeId);
      console.log(`Unregistered attendee ${attendeeId} from language ${language}`);

      // Clean up empty language maps
      if (languageConnections.size === 0) {
        this.attendeeConnections.delete(language);
      }
    }
  }

  /**
   * Get attendee connections for a specific language
   */
  getAttendeeConnections(language: string): Map<string, any> {
    return this.attendeeConnections.get(language) || new Map();
  }

  /**
   * Register track for lifecycle management
   */
  private registerTrack(trackInfo: AudioTrackInfo): void {
    this.trackRegistry.set(trackInfo.connectionId, trackInfo);

    // Update last activity on track events
    trackInfo.track.addEventListener('ended', () => {
      console.log(`Track ended for connection ${trackInfo.connectionId}`);
      this.cleanup(trackInfo.connectionId);
    });
  }

  /**
   * Set up track event handlers
   */
  private setupTrackEventHandlers(track: MediaStreamTrack, connectionId: string): void {
    track.addEventListener('mute', () => {
      console.log(`Track muted for connection ${connectionId}`);
      this.updateTrackActivity(connectionId);
    });

    track.addEventListener('unmute', () => {
      console.log(`Track unmuted for connection ${connectionId}`);
      this.updateTrackActivity(connectionId);
    });

    track.addEventListener('ended', () => {
      console.log(`Track ended for connection ${connectionId}`);
      this.cleanup(connectionId);
    });
  }

  /**
   * Update track activity timestamp
   */
  private updateTrackActivity(connectionId: string): void {
    const trackInfo = this.trackRegistry.get(connectionId);
    if (trackInfo) {
      trackInfo.lastActivity = Date.now();
    }
  }

  /**
   * Cleanup resources for a specific connection
   */
  cleanup(connectionId: string): void {
    console.log(`Cleaning up audio resources for connection ${connectionId}`);

    // Clean up track registry
    const trackInfo = this.trackRegistry.get(connectionId);
    if (trackInfo) {
      if (trackInfo.track.readyState !== 'ended') {
        trackInfo.track.stop();
      }
      this.trackRegistry.delete(connectionId);
    }

    // Clean up processing chain
    const processingChain = this.processingChains.get(connectionId);
    if (processingChain) {
      processingChain.cleanup();
      this.processingChains.delete(connectionId);
    }

    // Remove from attendee connections if present
    this.attendeeConnections.forEach((languageConnections, language) => {
      if (languageConnections.has(connectionId)) {
        languageConnections.delete(connectionId);
        console.log(`Removed connection ${connectionId} from language ${language}`);
      }
    });

    console.log(`Audio cleanup completed for connection ${connectionId}`);
  }

  /**
   * Start cleanup timer for inactive tracks
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveTracks();
    }, 60000); // Check every minute
  }

  /**
   * Clean up inactive tracks (older than 5 minutes with no activity)
   */
  private cleanupInactiveTracks(): void {
    const now = Date.now();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

    this.trackRegistry.forEach((trackInfo, connectionId) => {
      if (now - trackInfo.lastActivity > inactiveThreshold) {
        console.log(`Cleaning up inactive track for connection ${connectionId}`);
        this.cleanup(connectionId);
      }
    });
  }

  /**
   * Get current pipeline status
   */
  getStatus(): {
    activeConnections: number;
    processingChains: number;
    attendeeConnections: number;
    languages: string[];
  } {
    return {
      activeConnections: this.trackRegistry.size,
      processingChains: this.processingChains.size,
      attendeeConnections: Array.from(this.attendeeConnections.values())
        .reduce((total, connections) => total + connections.size, 0),
      languages: Array.from(this.attendeeConnections.keys())
    };
  }

  /**
   * Shutdown the entire pipeline
   */
  shutdown(): void {
    console.log('Shutting down Enterprise Audio Pipeline');

    // Clear cleanup timer
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cleanup all connections
    Array.from(this.trackRegistry.keys()).forEach(connectionId => {
      this.cleanup(connectionId);
    });

    // Clear all maps
    this.trackRegistry.clear();
    this.processingChains.clear();
    this.attendeeConnections.clear();
    this.forwardingRules.clear();

    console.log('Enterprise Audio Pipeline shutdown complete');
  }
}

// Export singleton instance
export const enterpriseAudio = EnterpriseAudioPipeline.getInstance();
