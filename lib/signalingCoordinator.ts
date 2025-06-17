/**
 * Production-Grade Signaling Coordination System
 * Manages WebRTC signaling state synchronization via Redis
 */

import { redisClient } from './redis';

export interface SignalingCoordinationState {
  guideReady: boolean;
  attendeeReady: boolean;
  iceExchangeStarted: boolean;
  lastHeartbeat: number;
  guideOfferId: string | null;
  attendeeAnswerId: string | null;
  connectionPhase: 'initial' | 'offer_sent' | 'answer_sent' | 'ice_exchange' | 'connected' | 'failed';
  participants: {
    guide: {
      connected: boolean;
      lastSeen: number;
      iceGatheringComplete: boolean;
    };
    attendees: Record<string, {
      connected: boolean;
      lastSeen: number;
      iceGatheringComplete: boolean;
    }>;
  };
}

export interface ICECandidateMessage {
  candidateId: string;
  candidate: RTCIceCandidate;
  sender: 'guide' | 'attendee';
  senderId: string;
  targetId: string;
  timestamp: number;
  sequenceNumber: number;
  processed: boolean;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice_candidate' | 'heartbeat' | 'state_sync';
  payload: any;
  sender: 'guide' | 'attendee';
  senderId: string;
  timestamp: number;
  messageId: string;
}

export class SignalingCoordinator {
  private tourId: string;
  private language: string;
  private role: 'guide' | 'attendee';
  private participantId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private statePollingInterval: NodeJS.Timeout | null = null;
  private messageListeners: Map<string, ((message: SignalingMessage) => void)[]> = new Map();

  constructor(tourId: string, language: string, role: 'guide' | 'attendee', participantId: string) {
    this.tourId = tourId;
    this.language = language;
    this.role = role;
    this.participantId = participantId;
    this.startHeartbeat();
    this.startStatePolling();
  }

  // Redis Key Generators
  private getCoordinationKey(): string {
    return `webrtc:coordination:${this.tourId}:${this.language}`;
  }

  private getICECandidatesKey(): string {
    return `webrtc:ice_candidates:${this.tourId}:${this.language}`;
  }

  private getMessagesKey(): string {
    return `webrtc:messages:${this.tourId}:${this.language}`;
  }

  private getParticipantKey(): string {
    return `webrtc:participant:${this.tourId}:${this.language}:${this.participantId}`;
  }

  // State Management
  public async initializeCoordination(): Promise<void> {
    const context = `[${this.role}:${this.language}:${this.participantId}]`;
    console.log(`${context} Initializing signaling coordination...`);

    try {
      // Initialize coordination state if it doesn't exist
      const existingState = await this.getCoordinationState();
      if (!existingState) {
        const initialState: SignalingCoordinationState = {
          guideReady: false,
          attendeeReady: false,
          iceExchangeStarted: false,
          lastHeartbeat: Date.now(),
          guideOfferId: null,
          attendeeAnswerId: null,
          connectionPhase: 'initial',
          participants: {
            guide: {
              connected: false,
              lastSeen: 0,
              iceGatheringComplete: false
            },
            attendees: {}
          }
        };

        await redisClient.setex(
          this.getCoordinationKey(),
          300, // 5 minutes TTL
          JSON.stringify(initialState)
        );
      }

      // Register this participant
      await this.registerParticipant();
      console.log(`${context} ✅ Signaling coordination initialized`);
    } catch (error) {
      console.error(`${context} ❌ Failed to initialize coordination:`, error);
      throw error;
    }
  }

  private async registerParticipant(): Promise<void> {
    const participantData = {
      role: this.role,
      connected: true,
      lastSeen: Date.now(),
      iceGatheringComplete: false
    };

    await redisClient.setex(
      this.getParticipantKey(),
      300, // 5 minutes TTL
      JSON.stringify(participantData)
    );
  }

  public async getCoordinationState(): Promise<SignalingCoordinationState | null> {
    try {
      const state = await redisClient.get(this.getCoordinationKey());
      return state ? JSON.parse(state) : null;
    } catch (error) {
      console.error('Error getting coordination state:', error);
      return null;
    }
  }

  public async updateCoordinationState(updates: Partial<SignalingCoordinationState>): Promise<void> {
    const context = `[${this.role}:${this.language}:${this.participantId}]`;

    try {
      // Use Redis transaction to ensure atomic updates
      const multi = redisClient.multi();

      // Get current state
      const currentStateStr = await redisClient.get(this.getCoordinationKey());
      const currentState: SignalingCoordinationState = currentStateStr 
        ? JSON.parse(currentStateStr)
        : {
            guideReady: false,
            attendeeReady: false,
            iceExchangeStarted: false,
            lastHeartbeat: Date.now(),
            guideOfferId: null,
            attendeeAnswerId: null,
            connectionPhase: 'initial',
            participants: {
              guide: { connected: false, lastSeen: 0, iceGatheringComplete: false },
              attendees: {}
            }
          };

      // Merge updates
      const newState: SignalingCoordinationState = {
        ...currentState,
        ...updates,
        lastHeartbeat: Date.now(),
        participants: {
          ...currentState.participants,
          ...updates.participants
        }
      };

      // Update participant-specific data
      if (this.role === 'guide') {
        newState.participants.guide = {
          ...newState.participants.guide,
          lastSeen: Date.now()
        };
      } else {
        newState.participants.attendees[this.participantId] = {
          ...newState.participants.attendees[this.participantId],
          connected: true,
          lastSeen: Date.now()
        };
      }

      multi.setex(this.getCoordinationKey(), 300, JSON.stringify(newState));
      await multi.exec();

      console.log(`${context} Updated coordination state:`, {
        phase: newState.connectionPhase,
        guideReady: newState.guideReady,
        attendeeReady: newState.attendeeReady,
        iceExchangeStarted: newState.iceExchangeStarted
      });
    } catch (error) {
      console.error(`${context} Error updating coordination state:`, error);
      throw error;
    }
  }

  // ICE Candidate Management
  public async bufferICECandidate(
    candidate: RTCIceCandidate,
    targetId: string,
    sequenceNumber: number
  ): Promise<void> {
    const context = `[${this.role}:${this.language}:${this.participantId}]`;

    const candidateMessage: ICECandidateMessage = {
      candidateId: `${this.participantId}_${sequenceNumber}_${Date.now()}`,
      candidate,
      sender: this.role,
      senderId: this.participantId,
      targetId,
      timestamp: Date.now(),
      sequenceNumber,
      processed: false
    };

    try {
      // Store candidate with expiration
      const candidateKey = `${this.getICECandidatesKey()}:${candidateMessage.candidateId}`;
      await redisClient.setex(candidateKey, 120, JSON.stringify(candidateMessage)); // 2 minutes TTL

      // Add to candidates list
      await redisClient.lpush(this.getICECandidatesKey(), candidateMessage.candidateId);
      await redisClient.expire(this.getICECandidatesKey(), 300); // 5 minutes TTL

      console.log(`${context} Buffered ICE candidate #${sequenceNumber} for ${targetId}`);
    } catch (error) {
      console.error(`${context} Error buffering ICE candidate:`, error);
      throw error;
    }
  }

  public async getICECandidates(targetId?: string): Promise<ICECandidateMessage[]> {
    try {
      const candidateIds = await redisClient.lrange(this.getICECandidatesKey(), 0, -1);
      const candidates: ICECandidateMessage[] = [];

      for (const candidateId of candidateIds) {
        const candidateKey = `${this.getICECandidatesKey()}:${candidateId}`;
        const candidateData = await redisClient.get(candidateKey);
        
        if (candidateData) {
          const candidate: ICECandidateMessage = JSON.parse(candidateData);
          
          // Filter by target if specified
          if (!targetId || candidate.targetId === targetId || candidate.senderId === targetId) {
            // Only return candidates intended for this participant
            if (candidate.targetId === this.participantId || 
                (this.role === 'guide' && candidate.sender === 'attendee') ||
                (this.role === 'attendee' && candidate.sender === 'guide')) {
              candidates.push(candidate);
            }
          }
        }
      }

      // Sort by sequence number
      return candidates.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    } catch (error) {
      console.error('Error getting ICE candidates:', error);
      return [];
    }
  }

  public async markICECandidateProcessed(candidateId: string): Promise<void> {
    try {
      const candidateKey = `${this.getICECandidatesKey()}:${candidateId}`;
      const candidateData = await redisClient.get(candidateKey);
      
      if (candidateData) {
        const candidate: ICECandidateMessage = JSON.parse(candidateData);
        candidate.processed = true;
        
        await redisClient.setex(candidateKey, 120, JSON.stringify(candidate));
      }
    } catch (error) {
      console.error('Error marking ICE candidate as processed:', error);
    }
  }

  // Message Management
  public async sendMessage(message: Omit<SignalingMessage, 'sender' | 'senderId' | 'timestamp' | 'messageId'>): Promise<void> {
    const fullMessage: SignalingMessage = {
      ...message,
      sender: this.role,
      senderId: this.participantId,
      timestamp: Date.now(),
      messageId: `${this.participantId}_${Date.now()}_${Math.random().toString(36).substring(2,7)}`
    };

    try {
      const messageKey = `${this.getMessagesKey()}:${fullMessage.messageId}`;
      await redisClient.setex(messageKey, 300, JSON.stringify(fullMessage)); // 5 minutes TTL

      // Add to messages list
      await redisClient.lpush(this.getMessagesKey(), fullMessage.messageId);
      await redisClient.expire(this.getMessagesKey(), 300);

      // Notify listeners
      const listeners = this.messageListeners.get(message.type) || [];
      listeners.forEach(listener => listener(fullMessage));

      const context = `[${this.role}:${this.language}:${this.participantId}]`;
      console.log(`${context} Sent message: ${message.type}`);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  public async getMessages(messageType?: string, limit: number = 50): Promise<SignalingMessage[]> {
    try {
      const messageIds = await redisClient.lrange(this.getMessagesKey(), 0, limit - 1);
      const messages: SignalingMessage[] = [];

      for (const messageId of messageIds) {
        const messageKey = `${this.getMessagesKey()}:${messageId}`;
        const messageData = await redisClient.get(messageKey);
        
        if (messageData) {
          const message: SignalingMessage = JSON.parse(messageData);
          
          if (!messageType || message.type === messageType) {
            messages.push(message);
          }
        }
      }

      // Sort by timestamp (newest first)
      return messages.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Error getting messages:', error);
      return [];
    }
  }

  // Event Listeners
  public onMessage(messageType: string, callback: (message: SignalingMessage) => void): void {
    if (!this.messageListeners.has(messageType)) {
      this.messageListeners.set(messageType, []);
    }
    this.messageListeners.get(messageType)!.push(callback);
  }

  // Connection Synchronization
  public async waitForPeerReady(peerRole: 'guide' | 'attendee', timeout: number = 30000): Promise<boolean> {
    const context = `[${this.role}:${this.language}:${this.participantId}]`;
    console.log(`${context} Waiting for ${peerRole} to be ready...`);

    const startTime = Date.now();
    const checkInterval = 500;

    return new Promise((resolve) => {
      const checkReady = async () => {
        try {
          const state = await this.getCoordinationState();
          if (!state) {
            if (Date.now() - startTime < timeout) {
              setTimeout(checkReady, checkInterval);
            } else {
              resolve(false);
            }
            return;
          }

          const isReady = peerRole === 'guide' ? state.guideReady : state.attendeeReady;
          
          if (isReady) {
            console.log(`${context} ✅ ${peerRole} is ready`);
            resolve(true);
          } else if (Date.now() - startTime < timeout) {
            setTimeout(checkReady, checkInterval);
          } else {
            console.log(`${context} ⏰ Timeout waiting for ${peerRole}`);
            resolve(false);
          }
        } catch (error) {
          console.error(`${context} Error checking peer readiness:`, error);
          resolve(false);
        }
      };

      checkReady();
    });
  }

  public async signalReady(): Promise<void> {
    const updates: Partial<SignalingCoordinationState> = {};
    
    if (this.role === 'guide') {
      updates.guideReady = true;
    } else {
      updates.attendeeReady = true;
    }

    await this.updateCoordinationState(updates);
  }

  public async signalICEGatheringComplete(): Promise<void> {
    const context = `[${this.role}:${this.language}:${this.participantId}]`;
    console.log(`${context} Signaling ICE gathering complete`);

    if (this.role === 'guide') {
      await this.updateCoordinationState({
        participants: {
          guide: {
            connected: true,
            lastSeen: Date.now(),
            iceGatheringComplete: true
          },
          attendees: {}
        }
      });
    } else {
      const state = await this.getCoordinationState();
      if (state) {
        const updatedAttendees = { ...state.participants.attendees };
        updatedAttendees[this.participantId] = {
          connected: true,
          lastSeen: Date.now(),
          iceGatheringComplete: true
        };

        await this.updateCoordinationState({
          participants: {
            guide: state.participants.guide,
            attendees: updatedAttendees
          }
        });
      }
    }
  }

  // Lifecycle Management
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.registerParticipant();
        
        // Send heartbeat message
        await this.sendMessage({
          type: 'heartbeat',
          payload: { timestamp: Date.now() }
        });
      } catch (error) {
        console.error('Heartbeat failed:', error);
      }
    }, 30000); // Every 30 seconds
  }

  private startStatePolling(): void {
    this.statePollingInterval = setInterval(async () => {
      try {
        // Check for new ICE candidates
        const candidates = await this.getICECandidates();
        const unprocessedCandidates = candidates.filter(c => !c.processed);
        
        if (unprocessedCandidates.length > 0) {
          const context = `[${this.role}:${this.language}:${this.participantId}]`;
          console.log(`${context} Found ${unprocessedCandidates.length} unprocessed ICE candidates`);
        }
      } catch (error) {
        console.error('State polling error:', error);
      }
    }, 2000); // Every 2 seconds
  }

  public async cleanup(): Promise<void> {
    const context = `[${this.role}:${this.language}:${this.participantId}]`;
    console.log(`${context} Cleaning up signaling coordination...`);

    // Clear timers
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.statePollingInterval) {
      clearInterval(this.statePollingInterval);
      this.statePollingInterval = null;
    }

    try {
      // Mark participant as disconnected
      if (this.role === 'guide') {
        await this.updateCoordinationState({
          participants: {
            guide: {
              connected: false,
              lastSeen: Date.now(),
              iceGatheringComplete: false
            },
            attendees: {}
          }
        });
      } else {
        const state = await this.getCoordinationState();
        if (state) {
          const updatedAttendees = { ...state.participants.attendees };
          if (updatedAttendees[this.participantId]) {
            updatedAttendees[this.participantId].connected = false;
          }

          await this.updateCoordinationState({
            participants: {
              guide: state.participants.guide,
              attendees: updatedAttendees
            }
          });
        }
      }

      // Remove participant key
      await redisClient.del(this.getParticipantKey());
    } catch (error) {
      console.error(`${context} Error during cleanup:`, error);
    }

    // Clear listeners
    this.messageListeners.clear();
  }
}

// Factory function
export function createSignalingCoordinator(
  tourId: string,
  language: string,
  role: 'guide' | 'attendee',
  participantId: string
): SignalingCoordinator {
  return new SignalingCoordinator(tourId, language, role, participantId);
}