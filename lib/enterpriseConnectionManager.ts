/**
 * Enterprise Connection Manager
 * 
 * Centralized WebRTC connection management system that provides unified state management,
 * connection pooling, health monitoring, and enterprise-grade reliability.
 * 
 * @author Senior WebRTC Developer
 * @version 1.0.0
 */

import { EnterpriseICEManager } from './enterpriseICEManager';
import { EnterpriseSDPManager } from './enterpriseSDPManager';
import { EnterpriseAudioPipeline } from './enterpriseAudioPipeline';

export enum ConnectionState {
  INITIALIZING = 'initializing',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed',
  CLOSED = 'closed'
}

export interface EnterpriseConnectionConfig {
  id?: string;
  role: 'guide' | 'attendee';
  language: string;
  tourId: string;
  participantId?: string;
  timeout?: number;
}

export interface ConnectionMetrics {
  connectionTime: number;
  lastActivity: number;
  packetsLost: number;
  packetsReceived: number;
  bytesReceived: number;
  bytesSent: number;
  roundTripTime: number;
  jitter: number;
  qualityScore: number;
}

export interface ConnectionEventHandlers {
  onStateChange?: (oldState: ConnectionState, newState: ConnectionState, reason?: string) => void;
  onTrack?: (track: MediaStreamTrack, streams: readonly MediaStream[]) => void;
  onDataChannel?: (channel: RTCDataChannel) => void;
  onError?: (error: Error) => void;
  onMetricsUpdate?: (metrics: ConnectionMetrics) => void;
}

/**
 * Enterprise WebRTC Connection wrapper
 */
export class EnterpriseConnection {
  public readonly id: string;
  public readonly role: 'guide' | 'attendee';
  public readonly language: string;
  public readonly tourId: string;
  public readonly peerConnection: RTCPeerConnection;
  
  private state: ConnectionState = ConnectionState.INITIALIZING;
  private metrics: ConnectionMetrics;
  private eventHandlers: ConnectionEventHandlers = {};
  private statsInterval: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private createdAt: number;

  constructor(config: EnterpriseConnectionConfig & { peerConnection: RTCPeerConnection }) {
    this.id = config.id || this.generateConnectionId();
    this.role = config.role;
    this.language = config.language;
    this.tourId = config.tourId;
    this.peerConnection = config.peerConnection;
    this.createdAt = Date.now();

    this.metrics = {
      connectionTime: 0,
      lastActivity: Date.now(),
      packetsLost: 0,
      packetsReceived: 0,
      bytesReceived: 0,
      bytesSent: 0,
      roundTripTime: 0,
      jitter: 0,
      qualityScore: 1.0
    };

    this.setupPeerConnectionHandlers();
    this.startStatsCollection();
    
    if (config.timeout) {
      this.setConnectionTimeout(config.timeout);
    }

    console.log(`Enterprise connection created: ${this.id} (${this.role}/${this.language})`);
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private setupPeerConnectionHandlers(): void {
    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection.iceConnectionState;
      console.log(`[${this.id}] ICE connection state: ${iceState}`);

      switch (iceState) {
        case 'checking':
          this.setState(ConnectionState.CONNECTING, 'ICE checking');
          break;
        case 'connected':
        case 'completed':
          this.setState(ConnectionState.CONNECTED, 'ICE connected');
          this.metrics.connectionTime = Date.now() - this.createdAt;
          this.clearConnectionTimeout();
          break;
        case 'disconnected':
          this.setState(ConnectionState.RECONNECTING, 'ICE disconnected');
          break;
        case 'failed':
          this.setState(ConnectionState.FAILED, 'ICE connection failed');
          break;
        case 'closed':
          this.setState(ConnectionState.CLOSED, 'ICE connection closed');
          break;
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const connectionState = this.peerConnection.connectionState;
      console.log(`[${this.id}] Connection state: ${connectionState}`);

      switch (connectionState) {
        case 'connected':
          if (this.state !== ConnectionState.CONNECTED) {
            this.setState(ConnectionState.CONNECTED, 'Peer connection established');
          }
          break;
        case 'failed':
          this.setState(ConnectionState.FAILED, 'Peer connection failed');
          break;
        case 'disconnected':
          this.setState(ConnectionState.RECONNECTING, 'Peer connection disconnected');
          break;
        case 'closed':
          this.setState(ConnectionState.CLOSED, 'Peer connection closed');
          break;
      }
    };

    this.peerConnection.ontrack = (event) => {
      console.log(`[${this.id}] Track received: ${event.track.kind}`);
      this.metrics.lastActivity = Date.now();
      
      if (this.eventHandlers.onTrack) {
        this.eventHandlers.onTrack(event.track, event.streams);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      console.log(`[${this.id}] Data channel received: ${event.channel.label}`);
      
      if (this.eventHandlers.onDataChannel) {
        this.eventHandlers.onDataChannel(event.channel);
      }
    };

    this.peerConnection.onicecandidateerror = (event) => {
      console.error(`[${this.id}] ICE candidate error:`, event);
      
      if (this.eventHandlers.onError) {
        this.eventHandlers.onError(new Error(`ICE candidate error: ${event.errorText}`));
      }
    };
  }

  private setState(newState: ConnectionState, reason?: string): void {
    const oldState = this.state;
    this.state = newState;

    console.log(`[${this.id}] State transition: ${oldState} → ${newState}${reason ? ` (${reason})` : ''}`);

    if (this.eventHandlers.onStateChange) {
      this.eventHandlers.onStateChange(oldState, newState, reason);
    }
  }

  private setConnectionTimeout(timeoutMs: number): void {
    this.connectionTimeout = setTimeout(() => {
      if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.INITIALIZING) {
        this.setState(ConnectionState.FAILED, 'Connection timeout');
      }
    }, timeoutMs);
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  private startStatsCollection(): void {
    this.statsInterval = setInterval(async () => {
      await this.collectStats();
    }, 5000); // Collect stats every 5 seconds
  }

  private async collectStats(): Promise<void> {
    try {
      const stats = await this.peerConnection.getStats();
      this.processStats(stats);
    } catch (error) {
      console.error(`[${this.id}] Error collecting stats:`, error);
    }
  }

  private processStats(stats: RTCStatsReport): void {
    stats.forEach((report) => {
      switch (report.type) {
        case 'inbound-rtp':
          if (report.mediaType === 'audio') {
            this.metrics.packetsReceived = report.packetsReceived || 0;
            this.metrics.packetsLost = report.packetsLost || 0;
            this.metrics.bytesReceived = report.bytesReceived || 0;
            this.metrics.jitter = report.jitter || 0;
          }
          break;

        case 'outbound-rtp':
          if (report.mediaType === 'audio') {
            this.metrics.bytesSent = report.bytesSent || 0;
          }
          break;

        case 'candidate-pair':
          if (report.state === 'succeeded') {
            this.metrics.roundTripTime = (report.currentRoundTripTime || 0) * 1000; // Convert to ms
          }
          break;
      }
    });

    // Calculate quality score
    this.metrics.qualityScore = this.calculateQualityScore();
    this.metrics.lastActivity = Date.now();

    if (this.eventHandlers.onMetricsUpdate) {
      this.eventHandlers.onMetricsUpdate({ ...this.metrics });
    }
  }

  private calculateQualityScore(): number {
    let score = 1.0;

    // Penalize for packet loss
    if (this.metrics.packetsReceived > 0) {
      const lossRate = this.metrics.packetsLost / this.metrics.packetsReceived;
      score -= lossRate * 0.5; // Up to 50% penalty for packet loss
    }

    // Penalize for high RTT
    if (this.metrics.roundTripTime > 200) {
      score -= Math.min(0.3, (this.metrics.roundTripTime - 200) / 1000); // Up to 30% penalty for high RTT
    }

    // Penalize for high jitter
    if (this.metrics.jitter > 0.05) {
      score -= Math.min(0.2, this.metrics.jitter * 2); // Up to 20% penalty for jitter
    }

    return Math.max(0, Math.min(1, score));
  }

  // Public methods
  public getState(): ConnectionState {
    return this.state;
  }

  public getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  public setEventHandlers(handlers: ConnectionEventHandlers): void {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.setState(ConnectionState.CONNECTING, 'Creating offer');
    return await EnterpriseSDPManager.createOptimizedOffer(this.peerConnection);
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.setState(ConnectionState.CONNECTING, 'Creating answer');
    return await EnterpriseSDPManager.createOptimizedAnswer(this.peerConnection);
  }

  public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    await this.peerConnection.setLocalDescription(description);
    console.log(`[${this.id}] Local description set: ${description.type}`);
  }

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const validatedSDP = EnterpriseSDPManager.validateAndFormatSDP(description);
    await this.peerConnection.setRemoteDescription(validatedSDP);
    console.log(`[${this.id}] Remote description set: ${description.type}`);
  }

  public addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    console.log(`[${this.id}] Adding track: ${track.kind}`);
    return this.peerConnection.addTrack(track, stream);
  }

  public close(): void {
    console.log(`[${this.id}] Closing connection`);

    this.setState(ConnectionState.CLOSED, 'Connection closed by user');

    // Clear timers
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    this.clearConnectionTimeout();

    // Close peer connection
    this.peerConnection.close();
  }

  public getConnectionDuration(): number {
    return Date.now() - this.createdAt;
  }

  public isHealthy(): boolean {
    return this.state === ConnectionState.CONNECTED && this.metrics.qualityScore > 0.7;
  }
}

/**
 * Connection Pool for managing multiple connections efficiently
 */
class ConnectionPool {
  private connections: Map<string, EnterpriseConnection> = new Map();
  private maxConnections: number;
  private cleanupInterval!: NodeJS.Timeout;

  constructor(maxConnections: number = 100) {
    this.maxConnections = maxConnections;
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 60000); // Cleanup every minute
  }

  addConnection(connection: EnterpriseConnection): boolean {
    if (this.connections.size >= this.maxConnections) {
      console.warn('Connection pool is full, cannot add new connection');
      return false;
    }

    this.connections.set(connection.id, connection);
    console.log(`Connection added to pool: ${connection.id} (${this.connections.size}/${this.maxConnections})`);
    return true;
  }

  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.close();
      this.connections.delete(connectionId);
      console.log(`Connection removed from pool: ${connectionId}`);
    }
  }

  getConnection(connectionId: string): EnterpriseConnection | undefined {
    return this.connections.get(connectionId);
  }

  getAllConnections(): EnterpriseConnection[] {
    return Array.from(this.connections.values());
  }

  getConnectionsByRole(role: 'guide' | 'attendee'): EnterpriseConnection[] {
    return this.getAllConnections().filter(conn => conn.role === role);
  }

  getConnectionsByLanguage(language: string): EnterpriseConnection[] {
    return this.getAllConnections().filter(conn => conn.language === language);
  }

  private cleanupStaleConnections(): void {
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();

    this.connections.forEach((connection, id) => {
      if (connection.getState() === ConnectionState.CLOSED || 
          connection.getState() === ConnectionState.FAILED ||
          (now - connection.getMetrics().lastActivity > staleThreshold)) {
        console.log(`Cleaning up stale connection: ${id}`);
        this.removeConnection(id);
      }
    });
  }

  getStats(): { total: number; connected: number; failed: number; healthy: number } {
    const connections = this.getAllConnections();
    return {
      total: connections.length,
      connected: connections.filter(c => c.getState() === ConnectionState.CONNECTED).length,
      failed: connections.filter(c => c.getState() === ConnectionState.FAILED).length,
      healthy: connections.filter(c => c.isHealthy()).length
    };
  }

  cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.connections.forEach((connection, id) => {
      this.removeConnection(id);
    });

    this.connections.clear();
  }
}

/**
 * Enterprise Connection Manager
 * Main class for managing all WebRTC connections
 */
export class EnterpriseConnectionManager {
  private static instance: EnterpriseConnectionManager;
  private connectionPool: ConnectionPool;
  private iceManager: EnterpriseICEManager;
  private audioPipeline: EnterpriseAudioPipeline;

  private constructor() {
    this.connectionPool = new ConnectionPool(100);
    this.iceManager = EnterpriseICEManager.getInstance();
    this.audioPipeline = EnterpriseAudioPipeline.getInstance();
    
    console.log('Enterprise Connection Manager initialized');
  }

  static getInstance(): EnterpriseConnectionManager {
    if (!EnterpriseConnectionManager.instance) {
      EnterpriseConnectionManager.instance = new EnterpriseConnectionManager();
    }
    return EnterpriseConnectionManager.instance;
  }

  async createConnection(config: EnterpriseConnectionConfig): Promise<EnterpriseConnection> {
    // Get enterprise ICE configuration
    const rtcConfig = this.iceManager.getRTCConfiguration(config.role);
    
    // Create peer connection
    const pc = new RTCPeerConnection(rtcConfig);
    
    // Create enterprise connection wrapper
    const connection = new EnterpriseConnection({
      ...config,
      peerConnection: pc,
      timeout: config.timeout || 30000
    });

    // Set up audio pipeline integration
    connection.setEventHandlers({
      onTrack: (track, streams) => {
        if (track.kind === 'audio') {
          this.audioPipeline.processIncomingTrack(
            track,
            connection.id,
            connection.role,
            connection.language
          );
        }
      },
      onError: (error) => {
        console.error(`Connection ${connection.id} error:`, error);
      }
    });

    // Add to connection pool
    if (!this.connectionPool.addConnection(connection)) {
      connection.close();
      throw new Error('Connection pool is full');
    }

    return connection;
  }

  getConnection(connectionId: string): EnterpriseConnection | undefined {
    return this.connectionPool.getConnection(connectionId);
  }

  closeConnection(connectionId: string): void {
    this.connectionPool.removeConnection(connectionId);
    this.audioPipeline.cleanup(connectionId);
  }

  getConnectionStats(): { total: number; connected: number; failed: number; healthy: number } {
    return this.connectionPool.getStats();
  }

  cleanup(): void {
    console.log('Cleaning up Enterprise Connection Manager');
    this.connectionPool.cleanup();
    this.audioPipeline.shutdown();
  }
}

/**
 * Error Recovery System for Enterprise Connections
 */
export enum ErrorType {
  ICE_FAILURE = 'ice_failure',
  SDP_ERROR = 'sdp_error',
  MEDIA_ERROR = 'media_error',
  NETWORK_ERROR = 'network_error',
  TIMEOUT_ERROR = 'timeout_error',
  UNKNOWN = 'unknown'
}

export interface RecoveryResult {
  success: boolean;
  reason?: string;
  retryAfter?: number;
}

export interface WebRTCError extends Error {
  type?: ErrorType;
  connectionId?: string;
  recoverable?: boolean;
}

/**
 * Circuit Breaker for connection recovery
 */
class CircuitBreaker {
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private maxFailures: number = 5,
    private resetTimeoutMs: number = 60000
  ) {}

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.maxFailures) {
      this.state = 'open';
    }
  }

  isOpen(): boolean {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Enterprise Error Recovery Manager
 */
export class EnterpriseErrorRecovery {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private recoveryAttempts: Map<string, number> = new Map();

  async handleConnectionError(
    connection: EnterpriseConnection,
    error: WebRTCError
  ): Promise<RecoveryResult> {
    const errorType = this.classifyError(error);
    const circuitBreaker = this.getCircuitBreaker(connection.id);

    if (circuitBreaker.isOpen()) {
      return { success: false, reason: 'Circuit breaker open', retryAfter: 60000 };
    }

    console.log(`[${connection.id}] Attempting recovery for ${errorType}: ${error.message}`);

    const result = await this.executeRecovery(connection, errorType, error);

    if (result.success) {
      circuitBreaker.recordSuccess();
      this.recoveryAttempts.delete(connection.id);
    } else {
      circuitBreaker.recordFailure();
      const attempts = (this.recoveryAttempts.get(connection.id) || 0) + 1;
      this.recoveryAttempts.set(connection.id, attempts);
    }

    return result;
  }

  private classifyError(error: WebRTCError): ErrorType {
    const message = error.message.toLowerCase();

    if (message.includes('ice') || message.includes('candidate')) {
      return ErrorType.ICE_FAILURE;
    }
    if (message.includes('sdp') || message.includes('description')) {
      return ErrorType.SDP_ERROR;
    }
    if (message.includes('track') || message.includes('media')) {
      return ErrorType.MEDIA_ERROR;
    }
    if (message.includes('network') || message.includes('timeout')) {
      return ErrorType.NETWORK_ERROR;
    }
    if (message.includes('timeout')) {
      return ErrorType.TIMEOUT_ERROR;
    }

    return ErrorType.UNKNOWN;
  }

  private async executeRecovery(
    connection: EnterpriseConnection,
    errorType: ErrorType,
    error: WebRTCError
  ): Promise<RecoveryResult> {
    const attempts = this.recoveryAttempts.get(connection.id) || 0;
    const maxAttempts = 3;

    if (attempts >= maxAttempts) {
      return { success: false, reason: 'Max recovery attempts exceeded' };
    }

    // Calculate exponential backoff delay
    const delay = Math.min(1000 * Math.pow(2, attempts), 30000);

    if (attempts > 0) {
      await this.sleep(delay);
    }

    try {
      switch (errorType) {
        case ErrorType.ICE_FAILURE:
          return await this.recoverICEFailure(connection);

        case ErrorType.SDP_ERROR:
          return await this.recoverSDPError(connection);

        case ErrorType.MEDIA_ERROR:
          return await this.recoverMediaError(connection);

        case ErrorType.NETWORK_ERROR:
        case ErrorType.TIMEOUT_ERROR:
          return await this.recoverNetworkError(connection);

        default:
          return await this.recoverGenericError(connection);
      }
    } catch (recoveryError) {
      console.error(`Recovery failed for ${connection.id}:`, recoveryError);
      const errorMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      return { success: false, reason: `Recovery exception: ${errorMessage}` };
    }
  }

  private async recoverICEFailure(connection: EnterpriseConnection): Promise<RecoveryResult> {
    console.log(`[${connection.id}] Attempting ICE restart`);

    try {
      // Restart ICE gathering
      await connection.peerConnection.restartIce();

      // Wait for ICE to restart
      await this.waitForICERestart(connection.peerConnection);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, reason: `ICE restart failed: ${errorMessage}` };
    }
  }

  private async recoverSDPError(connection: EnterpriseConnection): Promise<RecoveryResult> {
    console.log(`[${connection.id}] Attempting SDP renegotiation`);

    try {
      // Create new offer/answer with optimized settings
      if (connection.role === 'guide') {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
      } else {
        // For attendee, we need the guide to send a new offer
        // This would typically be coordinated through signaling
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, reason: `SDP renegotiation failed: ${errorMessage}` };
    }
  }

  private async recoverMediaError(connection: EnterpriseConnection): Promise<RecoveryResult> {
    console.log(`[${connection.id}] Attempting media recovery`);

    try {
      // Remove and re-add tracks
      const senders = connection.peerConnection.getSenders();
      for (const sender of senders) {
        if (sender.track) {
          connection.peerConnection.removeTrack(sender);
        }
      }

      // Audio pipeline will handle re-adding tracks
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, reason: `Media recovery failed: ${errorMessage}` };
    }
  }

  private async recoverNetworkError(connection: EnterpriseConnection): Promise<RecoveryResult> {
    console.log(`[${connection.id}] Attempting network recovery`);

    // For network errors, we typically need to wait and retry
    return { success: false, reason: 'Network recovery requires full reconnection', retryAfter: 5000 };
  }

  private async recoverGenericError(connection: EnterpriseConnection): Promise<RecoveryResult> {
    console.log(`[${connection.id}] Attempting generic recovery`);

    // Generic recovery - restart ICE as a safe fallback
    return await this.recoverICEFailure(connection);
  }

  private async waitForICERestart(pc: RTCPeerConnection, timeoutMs: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ICE restart timeout'));
      }, timeoutMs);

      const checkState = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          clearTimeout(timeout);
          resolve();
        } else if (pc.iceConnectionState === 'failed') {
          clearTimeout(timeout);
          reject(new Error('ICE restart failed'));
        }
      };

      pc.addEventListener('iceconnectionstatechange', checkState);
      checkState(); // Check current state
    });
  }

  private getCircuitBreaker(connectionId: string): CircuitBreaker {
    if (!this.circuitBreakers.has(connectionId)) {
      this.circuitBreakers.set(connectionId, new CircuitBreaker());
    }
    return this.circuitBreakers.get(connectionId)!;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  cleanup(connectionId: string): void {
    this.circuitBreakers.delete(connectionId);
    this.recoveryAttempts.delete(connectionId);
  }
}

// Export singleton instance
export const enterpriseConnectionManager = EnterpriseConnectionManager.getInstance();
export const enterpriseErrorRecovery = new EnterpriseErrorRecovery();
