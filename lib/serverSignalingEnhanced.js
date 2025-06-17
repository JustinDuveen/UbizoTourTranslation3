/**
 * Enhanced WebRTC Signaling Server with Candidate Batching
 * 
 * This server implementation fixes ICE candidate delivery issues by:
 * 1. Batching candidates to prevent race conditions
 * 2. Implementing acknowledgment system for delivery confirmation
 * 3. Adding connection health monitoring
 * 4. Providing automatic candidate forwarding with queuing
 */

const { Server } = require('socket.io');

class EnhancedSignalingServer {
  constructor(server, options = {}) {
    this.io = new Server(server, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      cors: {
        origin: "*", // Configure appropriately for production
        methods: ["GET", "POST"]
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      ...options
    });

    // Candidate batching system
    this.candidateBuffers = new Map(); // attendeeId -> candidates[]
    this.batchTimers = new Map(); // attendeeId -> timer
    this.connectionHealth = new Map(); // socketId -> health data
    
    // Configuration
    this.BATCH_SIZE = 5;          // Max candidates per batch
    this.BATCH_TIMEOUT = 100;     // 100ms batch timeout for ultra-low latency
    this.HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

    this.setupEventHandlers();
    this.startHealthMonitoring();
    
    console.log('🚀 Enhanced WebRTC Signaling Server initialized with candidate batching');
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const { tourId, language, role, attendeeId } = socket.handshake.auth;
      const clientInfo = `${language}:${role}${attendeeId ? `:${attendeeId}` : ''}`;
      
      console.log(`[${clientInfo}] 🔗 Client connected (socket: ${socket.id})`);

      // Initialize connection health tracking
      this.connectionHealth.set(socket.id, {
        clientInfo,
        tourId,
        language,
        role,
        attendeeId,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        candidatesSent: 0,
        candidatesReceived: 0,
        batchesSent: 0
      });

      // Join room for language-specific signaling
      const roomId = `${tourId}:${language}`;
      socket.join(roomId);
      console.log(`[${clientInfo}] 📡 Joined signaling room: ${roomId}`);

      // Handle individual ICE candidates (fallback)
      socket.on('ice-candidate', (message) => {
        this.handleIceCandidate(socket, message, clientInfo, roomId);
      });

      // Handle batched ICE candidates (preferred method)
      socket.on('ice-candidate-batch', (batchData) => {
        this.handleIceCandidateBatch(socket, batchData, clientInfo, roomId);
      });

      // Handle batch acknowledgments
      socket.on('batch-ack', (ackData) => {
        this.handleBatchAcknowledgment(socket, ackData, clientInfo);
      });

      // Handle offers and answers
      socket.on('offer', (message) => {
        this.handleOffer(socket, message, clientInfo, roomId);
      });

      socket.on('answer', (message) => {
        this.handleAnswer(socket, message, clientInfo, roomId);
      });

      // Connection health monitoring
      socket.on('ping', () => {
        socket.emit('pong');
        this.updateHealthMetrics(socket.id, 'ping');
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.handleDisconnection(socket, reason, clientInfo);
      });

      // Send initial connection confirmation
      socket.emit('connection-confirmed', {
        clientInfo,
        roomId,
        timestamp: Date.now(),
        features: ['candidate-batching', 'health-monitoring', 'auto-flush']
      });
    });
  }

  /**
   * Handle individual ICE candidate
   */
  handleIceCandidate(socket, message, clientInfo, roomId) {
    const health = this.connectionHealth.get(socket.id);
    if (health) {
      health.candidatesReceived++;
      health.lastActivity = Date.now();
    }

    console.log(`[${clientInfo}] 📤 Forwarding ICE candidate to room ${roomId}`);
    
    // Forward to all other clients in the same room
    socket.to(roomId).emit('ice-candidate', {
      ...message,
      forwardedBy: socket.id,
      timestamp: Date.now()
    });

    this.updateHealthMetrics(socket.id, 'candidate');
  }

  /**
   * Enhanced batch candidate handling
   */
  handleIceCandidateBatch(socket, batchData, clientInfo, roomId) {
    const { candidates, fromRole } = batchData;
    const candidateCount = candidates.length;

    const health = this.connectionHealth.get(socket.id);
    if (health) {
      health.candidatesReceived += candidateCount;
      health.lastActivity = Date.now();
    }

    console.log(`[${clientInfo}] 📦 Processing batch of ${candidateCount} ICE candidates`);

    // Add candidates to room-specific buffer for optimized delivery
    const targetClients = this.io.sockets.adapter.rooms.get(roomId);
    if (targetClients) {
      targetClients.forEach(targetSocketId => {
        if (targetSocketId !== socket.id) {
          this.addCandidatesToBuffer(targetSocketId, candidates, socket.id);
        }
      });
    }

    this.updateHealthMetrics(socket.id, 'batch');
  }

  /**
   * Add candidates to target client buffer
   */
  addCandidatesToBuffer(targetSocketId, candidates, sourceSocketId) {
    if (!this.candidateBuffers.has(targetSocketId)) {
      this.candidateBuffers.set(targetSocketId, []);
    }

    const buffer = this.candidateBuffers.get(targetSocketId);
    buffer.push(...candidates.map(candidate => ({
      ...candidate,
      forwardedBy: sourceSocketId,
      receivedAt: Date.now()
    })));

    // Flush if buffer is full
    if (buffer.length >= this.BATCH_SIZE) {
      this.flushCandidateBuffer(targetSocketId);
      return;
    }

    // Set/reset batch timer
    if (this.batchTimers.has(targetSocketId)) {
      clearTimeout(this.batchTimers.get(targetSocketId));
    }

    const timer = setTimeout(() => {
      this.flushCandidateBuffer(targetSocketId);
    }, this.BATCH_TIMEOUT);

    this.batchTimers.set(targetSocketId, timer);
  }

  /**
   * Flush candidate buffer to target client
   */
  flushCandidateBuffer(targetSocketId) {
    const buffer = this.candidateBuffers.get(targetSocketId);
    if (!buffer || buffer.length === 0) return;

    const targetSocket = this.io.sockets.sockets.get(targetSocketId);
    if (!targetSocket) {
      // Client disconnected, cleanup buffer
      this.candidateBuffers.delete(targetSocketId);
      this.batchTimers.delete(targetSocketId);
      return;
    }

    const health = this.connectionHealth.get(targetSocketId);
    const candidateCount = buffer.length;

    console.log(`📤 Flushing ${candidateCount} candidates to ${health?.clientInfo || targetSocketId}`);

    // Send batch to target client
    targetSocket.emit('ice-candidate-batch', {
      candidates: [...buffer],
      batchId: Date.now(),
      timestamp: Date.now()
    });

    // Update health metrics
    if (health) {
      health.candidatesSent += candidateCount;
      health.batchesSent++;
    }

    // Clear buffer and timer
    this.candidateBuffers.set(targetSocketId, []);
    if (this.batchTimers.has(targetSocketId)) {
      clearTimeout(this.batchTimers.get(targetSocketId));
      this.batchTimers.delete(targetSocketId);
    }
  }

  /**
   * Handle batch acknowledgment for delivery confirmation
   */
  handleBatchAcknowledgment(socket, ackData, clientInfo) {
    const { batchId, processedCount, errorCount } = ackData;
    
    console.log(`[${clientInfo}] ✅ Batch acknowledgment: ${processedCount} processed, ${errorCount} errors`);
    
    this.updateHealthMetrics(socket.id, 'ack');
  }

  /**
   * Handle WebRTC offers
   */
  handleOffer(socket, message, clientInfo, roomId) {
    console.log(`[${clientInfo}] 📋 Forwarding offer to room ${roomId}`);
    
    socket.to(roomId).emit('offer', {
      ...message,
      forwardedBy: socket.id,
      timestamp: Date.now()
    });

    this.updateHealthMetrics(socket.id, 'offer');
  }

  /**
   * Handle WebRTC answers
   */
  handleAnswer(socket, message, clientInfo, roomId) {
    console.log(`[${clientInfo}] 📋 Forwarding answer to room ${roomId}`);
    
    socket.to(roomId).emit('answer', {
      ...message,
      forwardedBy: socket.id,
      timestamp: Date.now()
    });

    this.updateHealthMetrics(socket.id, 'answer');
  }

  /**
   * Update connection health metrics
   */
  updateHealthMetrics(socketId, eventType) {
    const health = this.connectionHealth.get(socketId);
    if (health) {
      health.lastActivity = Date.now();
      health[`${eventType}Count`] = (health[`${eventType}Count`] || 0) + 1;
    }
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(socket, reason, clientInfo) {
    console.log(`[${clientInfo}] 🔌 Client disconnected (${reason})`);
    
    // Force flush any pending candidates
    this.flushCandidateBuffer(socket.id);
    
    // Cleanup resources
    this.candidateBuffers.delete(socket.id);
    if (this.batchTimers.has(socket.id)) {
      clearTimeout(this.batchTimers.get(socket.id));
      this.batchTimers.delete(socket.id);
    }
    this.connectionHealth.delete(socket.id);
  }

  /**
   * Start health monitoring system
   */
  startHealthMonitoring() {
    setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Perform periodic health check
   */
  performHealthCheck() {
    const now = Date.now();
    let activeConnections = 0;
    let totalCandidatesForwarded = 0;
    let totalBatchesSent = 0;

    this.connectionHealth.forEach((health, socketId) => {
      const staleThreshold = now - 60000; // 1 minute
      
      if (health.lastActivity < staleThreshold) {
        console.warn(`⚠️ Stale connection detected: ${health.clientInfo} (last activity: ${new Date(health.lastActivity)})`);
      }
      
      activeConnections++;
      totalCandidatesForwarded += health.candidatesSent;
      totalBatchesSent += health.batchesSent;
    });

    console.log(`💓 Health Check: ${activeConnections} active connections, ${totalCandidatesForwarded} candidates forwarded, ${totalBatchesSent} batches sent`);
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      activeConnections: this.connectionHealth.size,
      pendingCandidateBuffers: this.candidateBuffers.size,
      activeBatchTimers: this.batchTimers.size,
      totalRooms: this.io.sockets.adapter.rooms.size
    };
  }
}

module.exports = EnhancedSignalingServer;

// Example usage:
/*
const express = require('express');
const http = require('http');
const EnhancedSignalingServer = require('./serverSignalingEnhanced');

const app = express();
const server = http.createServer(app);

// Initialize enhanced signaling server
const signalingServer = new EnhancedSignalingServer(server, {
  // Custom configuration options
});

server.listen(3001, () => {
  console.log('🚀 Enhanced WebRTC Signaling Server running on port 3001');
});
*/