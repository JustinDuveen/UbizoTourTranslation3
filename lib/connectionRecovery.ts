/**
 * Production-Grade Connection Recovery System
 * Implements multi-level recovery strategies with exponential backoff
 */

export enum RecoveryLevel {
  ICE_RESTART = 'ice_restart',
  SIGNALING_RESET = 'signaling_reset',
  FULL_RECONNECT = 'full_reconnect'
}

export enum FailureType {
  ICE_CONNECTION_FAILED = 'ice_connection_failed',
  ICE_DISCONNECTED = 'ice_disconnected',
  CONNECTION_TIMEOUT = 'connection_timeout',
  MEDIA_STREAM_LOST = 'media_stream_lost',
  SIGNALING_ERROR = 'signaling_error',
  NETWORK_CHANGE = 'network_change',
  PEER_CONNECTION_FAILED = 'peer_connection_failed'
}

export interface RecoveryStrategy {
  level: RecoveryLevel;
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitterFactor: number;
  timeout: number;
  conditions: FailureType[];
}

export interface RecoveryAttempt {
  attemptNumber: number;
  level: RecoveryLevel;
  startTime: number;
  endTime?: number;
  success: boolean;
  error?: Error;
  metrics: {
    timeToRecover?: number;
    rtcPeerConnectionState?: string;
    iceConnectionState?: string;
    iceGatheringState?: string;
  };
}

export interface RecoverySession {
  sessionId: string;
  startTime: number;
  endTime?: number;
  originalFailure: FailureType;
  attempts: RecoveryAttempt[];
  finalOutcome: 'success' | 'failure' | 'abandoned';
  totalRecoveryTime?: number;
}

export interface NetworkCondition {
  type: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  effectiveType: '2g' | '3g' | '4g' | 'unknown';
  downlink: number;
  rtt: number;
  saveData: boolean;
}

export interface RecoveryConfig {
  strategies: RecoveryStrategy[];
  networkAdaptive: boolean;
  maxConcurrentRecoveries: number;
  healthCheckInterval: number;
  metricsRetentionTime: number;
  emergencyFallbackEnabled: boolean;
}

export class ConnectionRecoveryManager {
  private config: RecoveryConfig;
  private activeRecoveries: Map<string, RecoverySession> = new Map();
  private recoveryHistory: RecoverySession[] = [];
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private networkMonitor: NetworkCondition | null = null;
  private recoveryListeners: Map<string, ((session: RecoverySession) => void)[]> = new Map();

  constructor(config: RecoveryConfig) {
    this.config = config;
    this.initializeNetworkMonitoring();
    this.startHealthCheck();
  }

  // Recovery Strategy Selection
  private selectRecoveryStrategy(failure: FailureType, networkCondition?: NetworkCondition): RecoveryStrategy[] {
    let applicableStrategies = this.config.strategies.filter(strategy => 
      strategy.conditions.includes(failure)
    );

    // Sort by recovery level (fastest first)
    applicableStrategies.sort((a, b) => {
      const levelOrder = [RecoveryLevel.ICE_RESTART, RecoveryLevel.SIGNALING_RESET, RecoveryLevel.FULL_RECONNECT];
      return levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level);
    });

    // Adapt based on network conditions
    if (this.config.networkAdaptive && networkCondition) {
      applicableStrategies = this.adaptStrategiesForNetwork(applicableStrategies, networkCondition);
    }

    return applicableStrategies;
  }

  private adaptStrategiesForNetwork(strategies: RecoveryStrategy[], network: NetworkCondition): RecoveryStrategy[] {
    return strategies.map(strategy => {
      const adapted = { ...strategy };

      // Adjust timeouts based on network type
      if (network.type === 'cellular') {
        adapted.timeout *= 1.5;
        adapted.maxDelay *= 1.5;
        adapted.baseDelay = Math.max(adapted.baseDelay, 2000);
      } else if (network.effectiveType === '2g' || network.effectiveType === '3g') {
        adapted.timeout *= 2;
        adapted.maxDelay *= 2;
        adapted.baseDelay = Math.max(adapted.baseDelay, 3000);
      }

      // Adjust attempts based on network reliability
      if (network.rtt > 500) {
        adapted.maxAttempts = Math.min(adapted.maxAttempts + 2, 8);
      }

      return adapted;
    });
  }

  // Recovery Execution
  public async initiateRecovery(
    failure: FailureType,
    context: {
      peerConnection: RTCPeerConnection;
      participantId: string;
      tourId: string;
      language: string;
      role: 'guide' | 'attendee';
    }
  ): Promise<boolean> {
    const sessionId = `recovery_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
    const logContext = `[${context.role}:${context.language}:${context.participantId}]`;

    console.log(`${logContext} 🔄 Initiating recovery for failure: ${failure}`);

    // Check if we're already at max concurrent recoveries
    if (this.activeRecoveries.size >= this.config.maxConcurrentRecoveries) {
      console.warn(`${logContext} ⚠️ Max concurrent recoveries reached, queueing...`);
      return false;
    }

    const recoverySession: RecoverySession = {
      sessionId,
      startTime: Date.now(),
      originalFailure: failure,
      attempts: [],
      finalOutcome: 'failure'
    };

    this.activeRecoveries.set(sessionId, recoverySession);

    try {
      const strategies = this.selectRecoveryStrategy(failure, this.networkMonitor || undefined);
      console.log(`${logContext} Selected ${strategies.length} recovery strategies`);

      for (const strategy of strategies) {
        const success = await this.executeRecoveryStrategy(strategy, context, recoverySession);
        
        if (success) {
          recoverySession.finalOutcome = 'success';
          recoverySession.endTime = Date.now();
          recoverySession.totalRecoveryTime = recoverySession.endTime - recoverySession.startTime;
          
          console.log(`${logContext} ✅ Recovery successful using ${strategy.level} in ${recoverySession.totalRecoveryTime}ms`);
          break;
        }
      }

      // If all strategies failed, mark as failed
      if (recoverySession.finalOutcome !== 'success') {
        recoverySession.endTime = Date.now();
        recoverySession.totalRecoveryTime = recoverySession.endTime - recoverySession.startTime;
        
        console.error(`${logContext} ❌ All recovery strategies failed after ${recoverySession.totalRecoveryTime}ms`);
      }

    } catch (error) {
      recoverySession.finalOutcome = 'failure';
      recoverySession.endTime = Date.now();
      console.error(`${logContext} ❌ Recovery session failed:`, error);
    } finally {
      // Clean up and store results
      this.activeRecoveries.delete(sessionId);
      this.recoveryHistory.push(recoverySession);
      
      // Maintain history size
      if (this.recoveryHistory.length > 100) {
        this.recoveryHistory = this.recoveryHistory.slice(-50);
      }

      // Notify listeners
      this.notifyRecoveryListeners('session_complete', recoverySession);
    }

    return recoverySession.finalOutcome === 'success';
  }

  private async executeRecoveryStrategy(
    strategy: RecoveryStrategy,
    context: {
      peerConnection: RTCPeerConnection;
      participantId: string;
      tourId: string;
      language: string;
      role: 'guide' | 'attendee';
    },
    session: RecoverySession
  ): Promise<boolean> {
    const logContext = `[${context.role}:${context.language}:${context.participantId}]`;
    
    for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
      const recoveryAttempt: RecoveryAttempt = {
        attemptNumber: attempt,
        level: strategy.level,
        startTime: Date.now(),
        success: false,
        metrics: {
          rtcPeerConnectionState: context.peerConnection.connectionState,
          iceConnectionState: context.peerConnection.iceConnectionState,
          iceGatheringState: context.peerConnection.iceGatheringState
        }
      };

      session.attempts.push(recoveryAttempt);

      console.log(`${logContext} 🔄 Recovery attempt ${attempt}/${strategy.maxAttempts} using ${strategy.level}`);

      try {
        const success = await this.executeRecoveryLevel(strategy.level, context, strategy.timeout);
        
        recoveryAttempt.endTime = Date.now();
        recoveryAttempt.success = success;
        recoveryAttempt.metrics.timeToRecover = recoveryAttempt.endTime - recoveryAttempt.startTime;

        if (success) {
          console.log(`${logContext} ✅ Recovery attempt ${attempt} successful`);
          return true;
        } else {
          console.warn(`${logContext} ⚠️ Recovery attempt ${attempt} failed`);
        }

      } catch (error) {
        recoveryAttempt.endTime = Date.now();
        recoveryAttempt.error = error instanceof Error ? error : new Error(String(error));
        console.error(`${logContext} ❌ Recovery attempt ${attempt} error:`, error);
      }

      // Wait before next attempt (except for last attempt)
      if (attempt < strategy.maxAttempts) {
        const delay = this.calculateBackoff(attempt, strategy);
        console.log(`${logContext} ⏳ Waiting ${delay}ms before next attempt`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return false;
  }

  private async executeRecoveryLevel(
    level: RecoveryLevel,
    context: {
      peerConnection: RTCPeerConnection;
      participantId: string;
      tourId: string;
      language: string;
      role: 'guide' | 'attendee';
    },
    timeout: number
  ): Promise<boolean> {
    const { peerConnection } = context;

    switch (level) {
      case RecoveryLevel.ICE_RESTART:
        return this.performICERestart(peerConnection, timeout);
      
      case RecoveryLevel.SIGNALING_RESET:
        return this.performSignalingReset(peerConnection, context, timeout);
      
      case RecoveryLevel.FULL_RECONNECT:
        return this.performFullReconnect(context, timeout);
      
      default:
        throw new Error(`Unknown recovery level: ${level}`);
    }
  }

  private async performICERestart(pc: RTCPeerConnection, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), timeout);
      
      // Monitor connection state changes
      const checkConnection = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          clearTimeout(timeoutId);
          resolve(true);
        } else if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') {
          clearTimeout(timeoutId);
          resolve(false);
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      try {
        // Initiate ICE restart
        pc.restartIce();
        checkConnection();
      } catch (error) {
        clearTimeout(timeoutId);
        resolve(false);
      }
    });
  }

  private async performSignalingReset(
    pc: RTCPeerConnection,
    context: {
      participantId: string;
      tourId: string;
      language: string;
      role: 'guide' | 'attendee';
    },
    timeout: number
  ): Promise<boolean> {
    // This would involve recreating offer/answer exchange
    // Implementation depends on your signaling architecture
    console.log('Performing signaling reset...');
    
    return new Promise(async (resolve) => {
      const timeoutId = setTimeout(() => resolve(false), timeout);
      
      try {
        // Create new offer/answer
        if (context.role === 'guide') {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          // Send offer to attendee via signaling server
        } else {
          // Wait for new offer from guide and create answer
        }
        
        // Monitor for successful reconnection
        const checkConnection = () => {
          if (pc.connectionState === 'connected') {
            clearTimeout(timeoutId);
            resolve(true);
          } else if (pc.connectionState === 'failed') {
            clearTimeout(timeoutId);
            resolve(false);
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        
        checkConnection();
      } catch (error) {
        clearTimeout(timeoutId);
        resolve(false);
      }
    });
  }

  private async performFullReconnect(
    context: {
      peerConnection: RTCPeerConnection;
      participantId: string;
      tourId: string;
      language: string;
      role: 'guide' | 'attendee';
    },
    timeout: number
  ): Promise<boolean> {
    // This would involve completely recreating the peer connection
    console.log('Performing full reconnect...');
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(false), timeout);
      
      try {
        // Close existing connection
        context.peerConnection.close();
        
        // Signal need for complete reconnection
        // This would trigger the main connection logic to restart
        
        clearTimeout(timeoutId);
        resolve(true); // Indicates reconnection was initiated
      } catch (error) {
        clearTimeout(timeoutId);
        resolve(false);
      }
    });
  }

  // Utility Methods
  private calculateBackoff(attempt: number, strategy: RecoveryStrategy): number {
    const { baseDelay, maxDelay, backoffFactor, jitterFactor } = strategy;
    const exponentialDelay = Math.min(baseDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
    const jitter = exponentialDelay * jitterFactor * Math.random();
    return Math.floor(exponentialDelay + jitter);
  }

  // Network Monitoring
  private initializeNetworkMonitoring(): void {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const connection = (navigator as any).connection;
      
      const updateNetworkCondition = () => {
        this.networkMonitor = {
          type: connection.type || 'unknown',
          effectiveType: connection.effectiveType || 'unknown',
          downlink: connection.downlink || 0,
          rtt: connection.rtt || 0,
          saveData: connection.saveData || false
        };
      };

      updateNetworkCondition();
      connection.addEventListener('change', updateNetworkCondition);
    }
  }

  // Health Monitoring
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private performHealthCheck(): void {
    // Clean up old recovery sessions
    const cutoffTime = Date.now() - this.config.metricsRetentionTime;
    this.recoveryHistory = this.recoveryHistory.filter(session => session.startTime > cutoffTime);

    // Log recovery statistics
    if (this.recoveryHistory.length > 0) {
      const successRate = this.recoveryHistory.filter(s => s.finalOutcome === 'success').length / this.recoveryHistory.length;
      const averageRecoveryTime = this.recoveryHistory
        .filter(s => s.totalRecoveryTime)
        .reduce((sum, s) => sum + (s.totalRecoveryTime || 0), 0) / this.recoveryHistory.length;

      console.log(`Recovery Health Check - Success Rate: ${(successRate * 100).toFixed(1)}%, Avg Recovery Time: ${averageRecoveryTime.toFixed(0)}ms`);
    }
  }

  // Event Management
  public onRecoveryEvent(event: string, callback: (session: RecoverySession) => void): void {
    if (!this.recoveryListeners.has(event)) {
      this.recoveryListeners.set(event, []);
    }
    this.recoveryListeners.get(event)!.push(callback);
  }

  private notifyRecoveryListeners(event: string, session: RecoverySession): void {
    const listeners = this.recoveryListeners.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(session);
      } catch (error) {
        console.error('Error in recovery listener:', error);
      }
    });
  }

  // Statistics and Reporting
  public getRecoveryStatistics(): {
    totalRecoveries: number;
    successRate: number;
    averageRecoveryTime: number;
    strategyEffectiveness: Record<RecoveryLevel, { attempts: number; successes: number; successRate: number }>;
    commonFailures: Record<FailureType, number>;
  } {
    const stats = {
      totalRecoveries: this.recoveryHistory.length,
      successRate: 0,
      averageRecoveryTime: 0,
      strategyEffectiveness: {} as Record<RecoveryLevel, { attempts: number; successes: number; successRate: number }>,
      commonFailures: {} as Record<FailureType, number>
    };

    if (this.recoveryHistory.length === 0) {
      return stats;
    }

    // Calculate success rate
    const successfulRecoveries = this.recoveryHistory.filter(s => s.finalOutcome === 'success');
    stats.successRate = successfulRecoveries.length / this.recoveryHistory.length;

    // Calculate average recovery time
    const recoveriesWithTime = this.recoveryHistory.filter(s => s.totalRecoveryTime);
    if (recoveriesWithTime.length > 0) {
      stats.averageRecoveryTime = recoveriesWithTime.reduce((sum, s) => sum + (s.totalRecoveryTime || 0), 0) / recoveriesWithTime.length;
    }

    // Calculate strategy effectiveness
    Object.values(RecoveryLevel).forEach(level => {
      stats.strategyEffectiveness[level] = { attempts: 0, successes: 0, successRate: 0 };
    });

    this.recoveryHistory.forEach(session => {
      session.attempts.forEach(attempt => {
        const levelStats = stats.strategyEffectiveness[attempt.level];
        levelStats.attempts++;
        if (attempt.success) {
          levelStats.successes++;
        }
      });

      // Count failure types
      if (!stats.commonFailures[session.originalFailure]) {
        stats.commonFailures[session.originalFailure] = 0;
      }
      stats.commonFailures[session.originalFailure]++;
    });

    // Calculate success rates for each strategy
    Object.values(RecoveryLevel).forEach(level => {
      const levelStats = stats.strategyEffectiveness[level];
      levelStats.successRate = levelStats.attempts > 0 ? levelStats.successes / levelStats.attempts : 0;
    });

    return stats;
  }

  // Cleanup
  public destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.activeRecoveries.clear();
    this.recoveryListeners.clear();
  }
}

// Default Recovery Configuration
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  strategies: [
    {
      level: RecoveryLevel.ICE_RESTART,
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffFactor: 1.5,
      jitterFactor: 0.1,
      timeout: 10000,
      conditions: [
        FailureType.ICE_CONNECTION_FAILED,
        FailureType.ICE_DISCONNECTED,
        FailureType.NETWORK_CHANGE
      ]
    },
    {
      level: RecoveryLevel.SIGNALING_RESET,
      maxAttempts: 2,
      baseDelay: 2000,
      maxDelay: 10000,
      backoffFactor: 2,
      jitterFactor: 0.15,
      timeout: 20000,
      conditions: [
        FailureType.SIGNALING_ERROR,
        FailureType.CONNECTION_TIMEOUT,
        FailureType.ICE_CONNECTION_FAILED
      ]
    },
    {
      level: RecoveryLevel.FULL_RECONNECT,
      maxAttempts: 2,
      baseDelay: 5000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitterFactor: 0.2,
      timeout: 60000,
      conditions: [
        FailureType.PEER_CONNECTION_FAILED,
        FailureType.MEDIA_STREAM_LOST,
        FailureType.CONNECTION_TIMEOUT
      ]
    }
  ],
  networkAdaptive: true,
  maxConcurrentRecoveries: 3,
  healthCheckInterval: 60000,
  metricsRetentionTime: 3600000, // 1 hour
  emergencyFallbackEnabled: true
};

// Factory function
export function createConnectionRecoveryManager(config?: Partial<RecoveryConfig>): ConnectionRecoveryManager {
  const finalConfig = { ...DEFAULT_RECOVERY_CONFIG, ...config };
  return new ConnectionRecoveryManager(finalConfig);
}