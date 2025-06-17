/**
 * Production-Grade WebRTC Connection Manager
 * Implements robust state management, ICE candidate buffering, and recovery mechanisms
 */

export enum ConnectionState {
  INITIALIZING = 'initializing',
  SIGNALING = 'signaling',
  ICE_GATHERING = 'ice_gathering',
  ICE_EXCHANGE = 'ice_exchange',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed',
  CLOSED = 'closed'
}

export enum ConnectionRole {
  GUIDE = 'guide',
  ATTENDEE = 'attendee'
}

export interface ICECandidateBuffer {
  candidate: RTCIceCandidate;
  timestamp: number;
  sequenceNumber: number;
  priority: number;
}

export interface RetryConfiguration {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitterFactor: number;
}

export interface ConnectionQualityMetrics {
  rtt: number;
  packetsLost: number;
  packetsReceived: number;
  bytesReceived: number;
  jitter: number;
  audioLevel: number;
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
  lastUpdated: number;
}

export interface SignalingState {
  localDescriptionSet: boolean;
  remoteDescriptionSet: boolean;
  iceGatheringComplete: boolean;
  readyForICEExchange: boolean;
  lastHeartbeat: number;
  peerId: string;
}

export interface ConnectionManagerConfig {
  role: ConnectionRole;
  language: string;
  tourId: string;
  peerId: string;
  retryConfig: RetryConfiguration;
  iceBufferSize: number;
  heartbeatInterval: number;
  connectionTimeout: number;
}

export class WebRTCConnectionManager {
  private state: ConnectionState = ConnectionState.INITIALIZING;
  private pc: RTCPeerConnection | null = null;
  private config: ConnectionManagerConfig;
  private iceBuffer: ICECandidateBuffer[] = [];
  private signalingState: SignalingState;
  private qualityMetrics: ConnectionQualityMetrics;
  private retryAttempt: number = 0;
  private stateListeners: Map<ConnectionState, (() => void)[]> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private qualityMonitorTimer: NodeJS.Timeout | null = null;
  private connectionTimeoutTimer: NodeJS.Timeout | null = null;
  private sequenceCounter: number = 0;

  constructor(config: ConnectionManagerConfig) {
    this.config = config;
    this.signalingState = {
      localDescriptionSet: false,
      remoteDescriptionSet: false,
      iceGatheringComplete: false,
      readyForICEExchange: false,
      lastHeartbeat: Date.now(),
      peerId: config.peerId
    };
    this.qualityMetrics = {
      rtt: 0,
      packetsLost: 0,
      packetsReceived: 0,
      bytesReceived: 0,
      jitter: 0,
      audioLevel: 0,
      connectionQuality: 'poor',
      lastUpdated: Date.now()
    };

    this.initializeStateListeners();
    this.startHeartbeat();
  }

  // State Management
  public setState(newState: ConnectionState, reason?: string): void {
    const prevState = this.state;
    this.state = newState;
    
    const context = `[${this.config.role}:${this.config.language}]`;
    console.log(`${context} State transition: ${prevState} → ${newState}${reason ? ` (${reason})` : ''}`);
    
    // Execute state-specific logic
    this.handleStateTransition(prevState, newState);
    
    // Notify listeners
    const listeners = this.stateListeners.get(newState) || [];
    listeners.forEach(listener => listener());
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public onStateChange(state: ConnectionState, callback: () => void): void {
    if (!this.stateListeners.has(state)) {
      this.stateListeners.set(state, []);
    }
    this.stateListeners.get(state)!.push(callback);
  }

  // Peer Connection Management
  public setPeerConnection(pc: RTCPeerConnection): void {
    this.pc = pc;
    this.setupPeerConnectionListeners();
    this.setState(ConnectionState.SIGNALING);
  }

  public getPeerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  // ICE Candidate Buffering
  public bufferICECandidate(candidate: RTCIceCandidate, priority: number = 1): void {
    if (this.iceBuffer.length >= this.config.iceBufferSize) {
      // Remove lowest priority candidate
      const lowestPriorityIndex = this.iceBuffer.reduce((minIndex, curr, index, arr) => 
        curr.priority < arr[minIndex].priority ? index : minIndex, 0);
      this.iceBuffer.splice(lowestPriorityIndex, 1);
    }

    const bufferedCandidate: ICECandidateBuffer = {
      candidate,
      timestamp: Date.now(),
      sequenceNumber: ++this.sequenceCounter,
      priority
    };

    this.iceBuffer.push(bufferedCandidate);
    this.iceBuffer.sort((a, b) => b.priority - a.priority);

    const context = `[${this.config.role}:${this.config.language}]`;
    console.log(`${context} Buffered ICE candidate #${bufferedCandidate.sequenceNumber}, buffer size: ${this.iceBuffer.length}`);
  }

  public async flushICEBuffer(): Promise<void> {
    if (!this.pc || this.iceBuffer.length === 0) {
      return;
    }

    const context = `[${this.config.role}:${this.config.language}]`;
    console.log(`${context} Flushing ${this.iceBuffer.length} buffered ICE candidates`);

    // Sort by sequence number to maintain order
    const sortedCandidates = [...this.iceBuffer].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    for (const bufferedCandidate of sortedCandidates) {
      try {
        await this.pc.addIceCandidate(bufferedCandidate.candidate);
        console.log(`${context} ✅ Added buffered ICE candidate #${bufferedCandidate.sequenceNumber}`);
      } catch (error) {
        console.error(`${context} ❌ Failed to add buffered ICE candidate #${bufferedCandidate.sequenceNumber}:`, error);
      }
    }

    this.iceBuffer = [];
  }

  public getBufferedCandidateCount(): number {
    return this.iceBuffer.length;
  }

  // Signaling State Management
  public setLocalDescriptionComplete(): void {
    this.signalingState.localDescriptionSet = true;
    this.checkReadyForICEExchange();
  }

  public setRemoteDescriptionComplete(): void {
    this.signalingState.remoteDescriptionSet = true;
    this.checkReadyForICEExchange();
  }

  public setICEGatheringComplete(): void {
    this.signalingState.iceGatheringComplete = true;
    this.setState(ConnectionState.ICE_EXCHANGE);
    this.checkReadyForICEExchange();
  }

  private checkReadyForICEExchange(): void {
    const ready = this.signalingState.localDescriptionSet && 
                  this.signalingState.remoteDescriptionSet;

    if (ready && !this.signalingState.readyForICEExchange) {
      this.signalingState.readyForICEExchange = true;
      const context = `[${this.config.role}:${this.config.language}]`;
      console.log(`${context} ✅ Ready for ICE exchange - flushing buffer`);
      this.flushICEBuffer();
    }
  }

  public isReadyForICEExchange(): boolean {
    return this.signalingState.readyForICEExchange;
  }

  // Connection Recovery
  public async attemptRecovery(): Promise<boolean> {
    if (this.retryAttempt >= this.config.retryConfig.maxAttempts) {
      this.setState(ConnectionState.FAILED, 'Max retry attempts exceeded');
      return false;
    }

    this.retryAttempt++;
    this.setState(ConnectionState.RECONNECTING, `Attempt ${this.retryAttempt}/${this.config.retryConfig.maxAttempts}`);

    const delay = this.calculateBackoff();
    const context = `[${this.config.role}:${this.config.language}]`;
    console.log(`${context} Recovery attempt ${this.retryAttempt} in ${delay}ms`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Attempt ICE restart first (fastest recovery)
      if (this.pc && this.pc.connectionState !== 'closed') {
        console.log(`${context} Attempting ICE restart...`);
        this.pc.restartIce();
        
        // Wait for ICE restart to complete
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('ICE restart timeout')), 10000);
          
          const checkConnection = () => {
            if (this.pc?.iceConnectionState === 'connected' || this.pc?.iceConnectionState === 'completed') {
              clearTimeout(timeout);
              resolve(true);
            } else if (this.pc?.iceConnectionState === 'failed') {
              clearTimeout(timeout);
              reject(new Error('ICE restart failed'));
            } else {
              setTimeout(checkConnection, 500);
            }
          };
          
          checkConnection();
        });

        this.setState(ConnectionState.CONNECTED, 'ICE restart successful');
        this.retryAttempt = 0;
        return true;
      }
    } catch (error) {
      console.error(`${context} ICE restart failed:`, error);
    }

    // If ICE restart failed, try full reconnection
    return false;
  }

  private calculateBackoff(): number {
    const { baseDelay, maxDelay, backoffFactor, jitterFactor } = this.config.retryConfig;
    const delay = Math.min(baseDelay * Math.pow(backoffFactor, this.retryAttempt - 1), maxDelay);
    const jitter = delay * jitterFactor * Math.random();
    return Math.floor(delay + jitter);
  }

  // Quality Monitoring
  public async updateQualityMetrics(): Promise<void> {
    if (!this.pc) return;

    try {
      const stats = await this.pc.getStats();
      let hasValidData = false;

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          this.qualityMetrics.rtt = report.currentRoundTripTime || 0;
          hasValidData = true;
        }

        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          this.qualityMetrics.packetsLost = report.packetsLost || 0;
          this.qualityMetrics.packetsReceived = report.packetsReceived || 0;
          this.qualityMetrics.bytesReceived = report.bytesReceived || 0;
          this.qualityMetrics.jitter = report.jitter || 0;
          hasValidData = true;
        }

        if (report.type === 'track' && report.kind === 'audio') {
          this.qualityMetrics.audioLevel = report.audioLevel || 0;
        }
      });

      if (hasValidData) {
        this.qualityMetrics.lastUpdated = Date.now();
        this.qualityMetrics.connectionQuality = this.calculateConnectionQuality();
      }
    } catch (error) {
      console.error(`Error updating quality metrics:`, error);
    }
  }

  private calculateConnectionQuality(): 'excellent' | 'good' | 'fair' | 'poor' {
    const { rtt, packetsLost, packetsReceived } = this.qualityMetrics;
    
    const lossRate = packetsReceived > 0 ? packetsLost / packetsReceived : 0;
    
    if (rtt < 100 && lossRate < 0.01) return 'excellent';
    if (rtt < 200 && lossRate < 0.03) return 'good';
    if (rtt < 400 && lossRate < 0.05) return 'fair';
    return 'poor';
  }

  public getQualityMetrics(): ConnectionQualityMetrics {
    return { ...this.qualityMetrics };
  }

  // Lifecycle Management
  private initializeStateListeners(): void {
    this.onStateChange(ConnectionState.CONNECTING, () => {
      this.startConnectionTimeout();
      this.startQualityMonitoring();
    });

    this.onStateChange(ConnectionState.CONNECTED, () => {
      this.clearConnectionTimeout();
      this.retryAttempt = 0;
    });

    this.onStateChange(ConnectionState.FAILED, () => {
      this.clearAllTimers();
    });

    this.onStateChange(ConnectionState.CLOSED, () => {
      this.clearAllTimers();
    });
  }

  private setupPeerConnectionListeners(): void {
    if (!this.pc) return;

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc!.iceConnectionState;
      const context = `[${this.config.role}:${this.config.language}]`;
      console.log(`${context} ICE connection state: ${state}`);

      switch (state) {
        case 'connected':
        case 'completed':
          this.setState(ConnectionState.CONNECTED);
          break;
        case 'disconnected':
          this.setState(ConnectionState.RECONNECTING, 'ICE disconnected');
          this.attemptRecovery();
          break;
        case 'failed':
          this.setState(ConnectionState.FAILED, 'ICE connection failed');
          this.attemptRecovery();
          break;
        case 'checking':
          this.setState(ConnectionState.CONNECTING);
          break;
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc!.connectionState;
      const context = `[${this.config.role}:${this.config.language}]`;
      console.log(`${context} Connection state: ${state}`);

      switch (state) {
        case 'connected':
          this.setState(ConnectionState.CONNECTED);
          break;
        case 'failed':
          this.setState(ConnectionState.FAILED, 'Connection failed');
          this.attemptRecovery();
          break;
        case 'disconnected':
          this.setState(ConnectionState.RECONNECTING, 'Connection disconnected');
          this.attemptRecovery();
          break;
        case 'closed':
          this.setState(ConnectionState.CLOSED);
          break;
      }
    };

    this.pc.onicegatheringstatechange = () => {
      if (this.pc!.iceGatheringState === 'complete') {
        this.setICEGatheringComplete();
      }
    };
  }

  private handleStateTransition(prevState: ConnectionState, newState: ConnectionState): void {
    // State-specific transition logic
    if (newState === ConnectionState.ICE_EXCHANGE && this.isReadyForICEExchange()) {
      this.flushICEBuffer();
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.signalingState.lastHeartbeat = Date.now();
    }, this.config.heartbeatInterval);
  }

  private startQualityMonitoring(): void {
    this.qualityMonitorTimer = setInterval(() => {
      this.updateQualityMetrics();
    }, 5000);
  }

  private startConnectionTimeout(): void {
    this.connectionTimeoutTimer = setTimeout(() => {
      if (this.state === ConnectionState.CONNECTING) {
        this.setState(ConnectionState.FAILED, 'Connection timeout');
        this.attemptRecovery();
      }
    }, this.config.connectionTimeout);
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
  }

  private clearAllTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.qualityMonitorTimer) {
      clearInterval(this.qualityMonitorTimer);
      this.qualityMonitorTimer = null;
    }
    this.clearConnectionTimeout();
  }

  // Cleanup
  public destroy(): void {
    this.setState(ConnectionState.CLOSED);
    this.clearAllTimers();
    this.iceBuffer = [];
    this.stateListeners.clear();
    
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}

// Factory function for creating connection managers
export function createConnectionManager(config: Partial<ConnectionManagerConfig>): WebRTCConnectionManager {
  const defaultConfig: ConnectionManagerConfig = {
    role: config.role || ConnectionRole.ATTENDEE,
    language: config.language || 'en',
    tourId: config.tourId || '',
    peerId: config.peerId || `peer_${Date.now()}_${Math.random().toString(36).substring(2,7)}`,
    retryConfig: {
      maxAttempts: 5,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitterFactor: 0.1
    },
    iceBufferSize: 50,
    heartbeatInterval: 30000,
    connectionTimeout: 30000,
    ...config
  };

  return new WebRTCConnectionManager(defaultConfig);
}