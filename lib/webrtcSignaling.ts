import { io, Socket } from 'socket.io-client';

interface SignalingMessage {
  type: 'ice-candidate' | 'offer' | 'answer' | 'reconnect-request';
  data: any;
  tourId: string;
  language: string;
  attendeeId?: string;
  sender: 'guide' | 'attendee';
  timestamp: number;
}

interface ICECandidate {
  candidate: string;
  sdpMLineIndex: number;
  sdpMid: string;
}

class WebRTCSignalingClient {
  private socket: Socket | null = null;
  private tourId: string = '';
  private language: string = '';
  private role: 'guide' | 'attendee' = 'guide';
  private attendeeId?: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private baseReconnectDelay: number = 1000; // 1 second base delay
  private isConnected: boolean = false;
  
  // Candidate batching for improved delivery reliability
  private candidateBuffer: SignalingMessage[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 5; // Batch size for candidate delivery
  private readonly BATCH_TIMEOUT = 200; // 200ms batch timeout for real-time delivery
  
  // Connection health monitoring
  private healthTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastPingTime: number = 0;
  private latencyHistory: number[] = [];
  private connectionQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical' = 'good';
  private healthMetrics = {
    messagesReceived: 0,
    messagesSent: 0,
    reconnections: 0,
    avgLatency: 0,
    packetLoss: 0,
    uptime: 0,
    startTime: Date.now()
  };
  
  // Event handlers
  private onIceCandidateHandler?: (candidate: ICECandidate, fromAttendeeId?: string) => void;
  private onOfferHandler?: (offer: RTCSessionDescriptionInit, fromAttendeeId?: string) => void;
  private onAnswerHandler?: (answer: RTCSessionDescriptionInit, fromAttendeeId?: string) => void;
  private onConnectionStateHandler?: (connected: boolean) => void;

  constructor() {
    this.setupEventHandlers();
  }

  /**
   * Initialize WebSocket connection for signaling
   */
  async connect(tourId: string, language: string, role: 'guide' | 'attendee', attendeeId?: string): Promise<boolean> {
    this.tourId = tourId;
    this.language = language;
    this.role = role;
    this.attendeeId = attendeeId;

    try {
      console.log(`[${this.language}] 🔗 Initializing WebSocket signaling as ${this.role}...`);
      console.log(`[${this.language}] 🔗 Connecting to Socket.IO at /socket.io/ with auth:`, {
        tourId: this.tourId,
        language: this.language,
        role: this.role,
        attendeeId: this.attendeeId
      });
      
      // Create socket connection with authentication
      this.socket = io({
        path: '/socket.io/',  // Match server.js configuration
        transports: ['websocket', 'polling'],
        timeout: 5000,
        forceNew: true,  // Force new connection
        auth: {
          tourId: this.tourId,
          language: this.language,
          role: this.role,
          attendeeId: this.attendeeId
        }
      });

      this.setupSocketEventHandlers();
      
      // Wait for connection
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        this.socket!.on('connect', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          // Only reset attempts on initial connection, not during reconnection
          if (this.reconnectAttempts === 0) {
            console.log(`[${this.language}] ✅ WebSocket signaling connected (initial connection)`);
          } else {
            console.log(`[${this.language}] ✅ WebSocket signaling reconnected after ${this.reconnectAttempts} attempts`);
            this.reconnectAttempts = 0;  // Reset only after successful reconnection
          }
          this.onConnectionStateHandler?.(true);
          resolve(true);
        });

        this.socket!.on('connect_error', (error) => {
          clearTimeout(timeout);
          console.error(`[${this.language}] ❌ WebSocket connection failed:`, error);
          reject(error);
        });
      });

    } catch (error) {
      console.error(`[${this.language}] Error initializing WebSocket signaling:`, error);
      return false;
    }
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('disconnect', (reason) => {
      console.log(`[${this.language}] WebSocket disconnected:`, reason);
      this.isConnected = false;
      this.onConnectionStateHandler?.(false);
      
      // Attempt reconnection with exponential backoff
      if (reason === 'io server disconnect') {
        // Server initiated disconnect - don't reconnect automatically
        console.log(`[${this.language}] Server disconnected client - not reconnecting`);
      } else {
        this.attemptReconnect();
      }
    });

    this.socket.on('ice-candidate', (message: SignalingMessage) => {
      console.log(`[${this.language}] Received ICE candidate from ${message.sender}${message.attendeeId ? ` (${message.attendeeId})` : ''}`);
      this.onIceCandidateHandler?.(message.data as ICECandidate, message.attendeeId);
    });

    // Enhanced: Handle batched ICE candidates for improved delivery reliability
    this.socket.on('ice-candidate-batch', (batchMessage: { candidates: SignalingMessage[]; fromAttendeeId?: string }) => {
      console.log(`[${this.language}] 📦 Received batch of ${batchMessage.candidates.length} ICE candidates${batchMessage.fromAttendeeId ? ` from ${batchMessage.fromAttendeeId}` : ''}`);
      
      // Process each candidate in the batch
      let processedCount = 0;
      let errorCount = 0;
      
      for (const candidateMessage of batchMessage.candidates) {
        try {
          this.onIceCandidateHandler?.(candidateMessage.data as ICECandidate, candidateMessage.attendeeId || batchMessage.fromAttendeeId);
          processedCount++;
        } catch (error) {
          console.error(`[${this.language}] Error processing batched candidate:`, error);
          errorCount++;
        }
      }
      
      console.log(`[${this.language}] ✅ Batch processing complete: ${processedCount} successful, ${errorCount} errors`);
      
      // Send batch acknowledgment to server for delivery confirmation
      if (this.socket && this.isConnected) {
        this.socket.emit('batch-ack', {
          batchId: batchMessage.fromAttendeeId || 'unknown',
          processedCount,
          errorCount,
          timestamp: Date.now()
        });
      }
    });

    this.socket.on('offer', (message: SignalingMessage) => {
      console.log(`[${this.language}] Received offer from ${message.sender}${message.attendeeId ? ` (${message.attendeeId})` : ''}`);
      this.onOfferHandler?.(message.data as RTCSessionDescriptionInit, message.attendeeId);
    });

    this.socket.on('answer', (message: SignalingMessage) => {
      console.log(`[${this.language}] Received answer from ${message.sender}${message.attendeeId ? ` (${message.attendeeId})` : ''}`);
      this.onAnswerHandler?.(message.data as RTCSessionDescriptionInit, message.attendeeId);
    });

    this.socket.on('error', (error) => {
      console.error(`[${this.language}] WebSocket error:`, error);
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`[${this.language}] Socket.IO automatic reconnection succeeded after ${attemptNumber} attempts`);
      this.isConnected = true;
      this.healthMetrics.reconnections++;
      // Counter is now managed in the connect handler
      this.onConnectionStateHandler?.(true);
    });

    // Health monitoring event handlers
    this.socket.on('pong', () => {
      if (this.lastPingTime > 0) {
        const latency = Date.now() - this.lastPingTime;
        this.updateLatencyMetrics(latency);
        console.log(`[${this.language}] 🏓 Pong received - latency: ${latency}ms, quality: ${this.connectionQuality}`);
      }
    });

    this.socket.on('connection-confirmed', (data) => {
      console.log(`[${this.language}] ✅ Connection confirmed with features:`, data.features);
      this.startHealthMonitoring();
    });

    // Track all received messages for health metrics
    const originalOnevent = this.socket.onevent;
    this.socket.onevent = (packet) => {
      this.healthMetrics.messagesReceived++;
      this.updateConnectionQuality();
      return originalOnevent.call(this.socket, packet);
    };
  }

  /**
   * Attempt reconnection with exponential backoff and proper error handling
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[${this.language}] ❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached - giving up`);
      this.onConnectionStateHandler?.(false);
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with maximum delay cap of 30 seconds
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );
    
    console.log(`[${this.language}] 🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(async () => {
      if (!this.isConnected) {
        try {
          // Try to reconnect using the existing socket first
          if (this.socket && this.socket.disconnected) {
            console.log(`[${this.language}] Attempting to reconnect existing socket...`);
            this.socket.connect();
          } else {
            // If socket is null or in bad state, create new connection
            console.log(`[${this.language}] Creating new socket connection for reconnect attempt ${this.reconnectAttempts}`);
            await this.connect(this.tourId, this.language, this.role, this.attendeeId);
          }
        } catch (error) {
          console.error(`[${this.language}] Reconnection attempt ${this.reconnectAttempts} failed:`, error);
          // Continue to next attempt unless max reached
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          }
        }
      } else {
        console.log(`[${this.language}] ✅ Already reconnected, canceling scheduled attempt ${this.reconnectAttempts}`);
      }
    }, delay);
  }

  /**
   * Send ICE candidate to remote peer with batching support
   */
  async sendIceCandidate(candidate: ICECandidate, targetAttendeeId?: string, forceBatch: boolean = true): Promise<boolean> {
    if (!this.socket || !this.isConnected) {
      console.warn(`[${this.language}] Cannot send ICE candidate - not connected`);
      return false;
    }

    try {
      const message: SignalingMessage = {
        type: 'ice-candidate',
        data: candidate,
        tourId: this.tourId,
        language: this.language,
        attendeeId: targetAttendeeId || this.attendeeId,
        sender: this.role,
        timestamp: Date.now()
      };

      // Use batching for improved delivery reliability
      if (forceBatch) {
        this.addToCandidateBuffer(message);
        console.log(`[${this.language}] 📦 ICE candidate added to batch (buffer size: ${this.candidateBuffer.length})`);
        return true;
      } else {
        // Send immediately for urgent candidates
        this.socket.emit('ice-candidate', message);
        console.log(`[${this.language}] ⚡ ICE candidate sent immediately${targetAttendeeId ? ` to ${targetAttendeeId}` : ''}`);
        return true;
      }
    } catch (error) {
      console.error(`[${this.language}] Error sending ICE candidate:`, error);
      return false;
    }
  }

  /**
   * Add candidate to buffer and manage batching
   */
  private addToCandidateBuffer(message: SignalingMessage): void {
    this.candidateBuffer.push(message);

    // Send batch if we reach the batch size limit
    if (this.candidateBuffer.length >= this.BATCH_SIZE) {
      this.flushCandidateBuffer();
      return;
    }

    // Set/reset timer for batch timeout
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.flushCandidateBuffer();
    }, this.BATCH_TIMEOUT);
  }

  /**
   * Flush the candidate buffer and send batch
   */
  private flushCandidateBuffer(): void {
    if (this.candidateBuffer.length === 0) return;

    if (!this.socket || !this.isConnected) {
      console.warn(`[${this.language}] Cannot flush candidate buffer - not connected`);
      return;
    }

    try {
      console.log(`[${this.language}] 📤 Flushing candidate buffer with ${this.candidateBuffer.length} candidates`);
      
      // Send batch to server
      this.socket.emit('ice-candidate-batch', {
        candidates: [...this.candidateBuffer],
        fromRole: this.role,
        timestamp: Date.now()
      });

      // Clear buffer and timer
      this.candidateBuffer = [];
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }

      console.log(`[${this.language}] ✅ Candidate batch sent successfully`);
    } catch (error) {
      console.error(`[${this.language}] Error flushing candidate buffer:`, error);
    }
  }

  /**
   * Force flush candidate buffer (used before disconnect or critical events)
   */
  forceFlushCandidates(): void {
    if (this.candidateBuffer.length > 0) {
      console.log(`[${this.language}] 🚨 Force flushing ${this.candidateBuffer.length} pending candidates`);
      this.flushCandidateBuffer();
    }
  }

  /**
   * Start health monitoring system
   */
  private startHealthMonitoring(): void {
    console.log(`[${this.language}] 💓 Starting connection health monitoring...`);
    
    // Start periodic ping
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, 10000); // Ping every 10 seconds

    // Start periodic health reporting
    this.healthTimer = setInterval(() => {
      this.reportHealthMetrics();
    }, 30000); // Report every 30 seconds
  }

  /**
   * Send ping for latency measurement
   */
  private sendPing(): void {
    if (this.socket && this.isConnected) {
      this.lastPingTime = Date.now();
      this.socket.emit('ping');
    }
  }

  /**
   * Update latency metrics
   */
  private updateLatencyMetrics(latency: number): void {
    this.latencyHistory.push(latency);
    
    // Keep only last 10 measurements
    if (this.latencyHistory.length > 10) {
      this.latencyHistory.shift();
    }
    
    // Calculate average latency
    this.healthMetrics.avgLatency = this.latencyHistory.reduce((sum, lat) => sum + lat, 0) / this.latencyHistory.length;
    
    // Update connection quality based on latency
    this.assessConnectionQuality();
  }

  /**
   * Assess connection quality based on metrics
   */
  private assessConnectionQuality(): void {
    const { avgLatency, reconnections } = this.healthMetrics;
    
    if (avgLatency < 50 && reconnections === 0) {
      this.connectionQuality = 'excellent';
    } else if (avgLatency < 100 && reconnections <= 1) {
      this.connectionQuality = 'good';
    } else if (avgLatency < 200 && reconnections <= 2) {
      this.connectionQuality = 'fair';
    } else if (avgLatency < 500 && reconnections <= 3) {
      this.connectionQuality = 'poor';
    } else {
      this.connectionQuality = 'critical';
    }
  }

  /**
   * Update connection quality metrics
   */
  private updateConnectionQuality(): void {
    this.healthMetrics.uptime = Date.now() - this.healthMetrics.startTime;
    this.assessConnectionQuality();
  }

  /**
   * Report health metrics
   */
  private reportHealthMetrics(): void {
    const metrics = {
      ...this.healthMetrics,
      uptime: Date.now() - this.healthMetrics.startTime,
      quality: this.connectionQuality,
      latencyHistory: [...this.latencyHistory]
    };
    
    console.log(`[${this.language}] 📊 Health Report:`, {
      quality: metrics.quality,
      avgLatency: Math.round(metrics.avgLatency),
      uptime: Math.round(metrics.uptime / 1000) + 's',
      messagesReceived: metrics.messagesReceived,
      messagesSent: metrics.messagesSent,
      reconnections: metrics.reconnections
    });

    // Send health report to server for monitoring
    if (this.socket && this.isConnected) {
      this.socket.emit('health-report', metrics);
    }

    // Alert if connection quality is poor
    if (this.connectionQuality === 'poor' || this.connectionQuality === 'critical') {
      console.warn(`[${this.language}] ⚠️ Poor connection quality detected: ${this.connectionQuality}`);
      console.warn(`[${this.language}] 📈 Avg latency: ${Math.round(metrics.avgLatency)}ms, Reconnections: ${metrics.reconnections}`);
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus(): {
    quality: string;
    latency: number;
    uptime: number;
    connected: boolean;
    metrics: typeof this.healthMetrics;
  } {
    return {
      quality: this.connectionQuality,
      latency: this.healthMetrics.avgLatency,
      uptime: Date.now() - this.healthMetrics.startTime,
      connected: this.isConnected,
      metrics: { ...this.healthMetrics }
    };
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    
    console.log(`[${this.language}] 💓 Health monitoring stopped`);
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    console.log(`[${this.language}] 🔌 Disconnecting WebSocket signaling...`);
    
    // Force flush any pending candidates before disconnect
    this.forceFlushCandidates();
    
    // Stop health monitoring
    this.stopHealthMonitoring();
    
    // Cleanup candidate batching timers
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Clear candidate buffer
    this.candidateBuffer = [];
    
    // Disconnect socket
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    this.isConnected = false;
    console.log(`[${this.language}] ✅ WebSocket signaling disconnected and cleaned up`);
  }

  /**
   * Send WebRTC offer
   */
  async sendOffer(offer: RTCSessionDescriptionInit, targetAttendeeId?: string): Promise<boolean> {
    if (!this.socket || !this.isConnected) {
      console.warn(`[${this.language}] Cannot send offer - not connected`);
      return false;
    }

    try {
      const message: SignalingMessage = {
        type: 'offer',
        data: offer,
        tourId: this.tourId,
        language: this.language,
        attendeeId: targetAttendeeId || this.attendeeId,
        sender: this.role,
        timestamp: Date.now()
      };

      this.socket.emit('offer', message);
      console.log(`[${this.language}] ✅ Offer sent via WebSocket${targetAttendeeId ? ` to ${targetAttendeeId}` : ''}`);
      return true;
    } catch (error) {
      console.error(`[${this.language}] Error sending offer:`, error);
      return false;
    }
  }

  /**
   * Send WebRTC answer
   */
  async sendAnswer(answer: RTCSessionDescriptionInit, attendeeId?: string): Promise<boolean> {
    if (!this.socket || !this.isConnected) {
      console.warn(`[${this.language}] Cannot send answer - not connected`);
      return false;
    }

    try {
      const message: SignalingMessage = {
        type: 'answer',
        data: answer,
        tourId: this.tourId,
        language: this.language,
        attendeeId: attendeeId || this.attendeeId,
        sender: this.role,
        timestamp: Date.now()
      };

      this.socket.emit('answer', message);
      console.log(`[${this.language}] ✅ Answer sent via WebSocket`);
      return true;
    } catch (error) {
      console.error(`[${this.language}] Error sending answer:`, error);
      return false;
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Event handlers will be set via public methods
  }

  /**
   * Set ICE candidate handler
   */
  onIceCandidate(handler: (candidate: ICECandidate, fromAttendeeId?: string) => void): void {
    this.onIceCandidateHandler = handler;
  }

  /**
   * Set offer handler
   */
  onOffer(handler: (offer: RTCSessionDescriptionInit, fromAttendeeId?: string) => void): void {
    this.onOfferHandler = handler;
  }

  /**
   * Set answer handler
   */
  onAnswer(handler: (answer: RTCSessionDescriptionInit, fromAttendeeId?: string) => void): void {
    this.onAnswerHandler = handler;
  }

  /**
   * Set connection state handler
   */
  onConnectionState(handler: (connected: boolean) => void): void {
    this.onConnectionStateHandler = handler;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): { connected: boolean; attempts: number } {
    return {
      connected: this.isConnected,
      attempts: this.reconnectAttempts
    };
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.socket) {
      console.log(`[${this.language}] Disconnecting WebSocket signaling`);
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.reconnectAttempts = 0;
    }
  }
}

// Singleton instance for the application
let signalingClient: WebRTCSignalingClient | null = null;

/**
 * Get or create signaling client instance
 */
export function getSignalingClient(): WebRTCSignalingClient {
  if (!signalingClient) {
    signalingClient = new WebRTCSignalingClient();
  }
  return signalingClient;
}

/**
 * Initialize signaling for a tour session
 */
export async function initializeSignaling(
  tourId: string, 
  language: string, 
  role: 'guide' | 'attendee',
  attendeeId?: string
): Promise<WebRTCSignalingClient | null> {
  try {
    const client = getSignalingClient();
    const success = await client.connect(tourId, language, role, attendeeId);
    
    if (success) {
      console.log(`[${language}] Signaling initialized successfully for ${role}`);
      return client;
    } else {
      console.error(`[${language}] Failed to initialize signaling for ${role}`);
      return null;
    }
  } catch (error) {
    console.error(`[${language}] Error initializing signaling:`, error);
    return null;
  }
}

/**
 * Cleanup signaling on component unmount
 */
export function cleanupSignaling(): void {
  if (signalingClient) {
    signalingClient.disconnect();
    signalingClient = null;
  }
}

export default WebRTCSignalingClient;