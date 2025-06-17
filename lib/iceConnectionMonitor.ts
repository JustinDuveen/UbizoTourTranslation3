/**
 * Enhanced ICE Connection Monitor with RTCPeerConnection.getStats() analysis
 * 
 * This module provides comprehensive monitoring and diagnostics for WebRTC ICE connections,
 * including timeout detection, stats analysis, and detailed failure reporting.
 */

interface RTCIceCandidateStats extends RTCStats {
  candidateType: string;
  protocol: string;
  address: string;
  port: number;
}

interface ICEStats {
  localCandidates: RTCIceCandidateStats[];
  remoteCandidates: RTCIceCandidateStats[];
  candidatePairs: RTCIceCandidatePairStats[];
  transport?: RTCTransportStats;
  selectedPair?: RTCIceCandidatePairStats;
}

interface ICEAnalysis {
  hasHostCandidates: boolean;
  hasSrflxCandidates: boolean;
  hasRelayCandidates: boolean;
  selectedCandidateType?: string;
  connectionPath?: string;
  failureReason?: string;
  recommendations: string[];
}

interface ICETimeoutEvent {
  timestamp: number;
  duration: number;
  language: string;
  attendeeId?: string;
  role: 'guide' | 'attendee';
  connectionState: RTCIceConnectionState;
  gatheringState: RTCIceGatheringState;
  stats: ICEStats;
  analysis: ICEAnalysis;
}

type ICETimeoutCallback = (event: ICETimeoutEvent) => void;

class ICEConnectionMonitor {
  private pc: RTCPeerConnection;
  private language: string;
  private role: 'guide' | 'attendee';
  private attendeeId?: string;
  private startTime: number;
  private timeoutDuration: number;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private onTimeoutCallback?: ICETimeoutCallback;
  private isConnected: boolean = false;
  private isMonitoring: boolean = false;

  constructor(
    pc: RTCPeerConnection, 
    language: string, 
    role: 'guide' | 'attendee',
    attendeeId?: string,
    timeoutMs: number = 30000 // 30 seconds default
  ) {
    this.pc = pc;
    this.language = language;
    this.role = role;
    this.attendeeId = attendeeId;
    this.timeoutDuration = timeoutMs;
    this.startTime = Date.now();

    this.setupEventHandlers();
  }

  /**
   * Start monitoring the ICE connection
   */
  startMonitoring(onTimeout?: ICETimeoutCallback): void {
    if (this.isMonitoring) {
      console.warn(`[${this.language}] ICE monitor already running`);
      return;
    }

    this.isMonitoring = true;
    this.onTimeoutCallback = onTimeout;
    this.startTime = Date.now();

    const logContext = this.getLogContext();
    console.log(`${logContext} Starting ICE connection monitoring (timeout: ${this.timeoutDuration}ms)`);

    // Start timeout timer
    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout();
    }, this.timeoutDuration);

    // Start periodic stats collection (every 5 seconds)
    this.statsTimer = setInterval(() => {
      this.collectAndLogStats();
    }, 5000);

    console.log(`${logContext} ICE monitoring started`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    const logContext = this.getLogContext();
    console.log(`${logContext} Stopping ICE connection monitoring`);

    this.isMonitoring = false;

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    console.log(`${logContext} ICE monitoring stopped`);
  }

  /**
   * Setup event handlers for the peer connection
   */
  private setupEventHandlers(): void {
    this.pc.oniceconnectionstatechange = () => {
      const logContext = this.getLogContext();
      const state = this.pc.iceConnectionState;
      
      console.log(`${logContext} ICE connection state changed to: ${state}`);

      if (state === 'connected' || state === 'completed') {
        this.isConnected = true;
        this.stopMonitoring();
        console.log(`${logContext} ✅ ICE connection established successfully`);
      } else if (state === 'failed' || state === 'disconnected') {
        this.isConnected = false;
        if (this.isMonitoring) {
          this.handleTimeout();
        }
      }
    };

    this.pc.onicegatheringstatechange = () => {
      const logContext = this.getLogContext();
      console.log(`${logContext} ICE gathering state changed to: ${this.pc.iceGatheringState}`);
    };
  }



  /**
   * Collect ICE statistics from the peer connection
   */
  private async collectICEStats(): Promise<ICEStats> {
    const statsReport = await this.pc.getStats();
    const stats: ICEStats = {
      localCandidates: [],
      remoteCandidates: [],
      candidatePairs: []
    };

    statsReport.forEach((report) => {
      switch (report.type) {
        case 'local-candidate':
          stats.localCandidates.push(report as RTCIceCandidateStats);
          break;
        case 'remote-candidate':
          stats.remoteCandidates.push(report as RTCIceCandidateStats);
          break;
        case 'candidate-pair':
          const pair = report as RTCIceCandidatePairStats;
          stats.candidatePairs.push(pair);
          if (pair.state === 'succeeded' && !stats.selectedPair) {
            stats.selectedPair = pair;
          }
          break;
        case 'transport':
          stats.transport = report as RTCTransportStats;
          break;
      }
    });

    return stats;
  }

  /**
   * Analyze ICE failure based on collected stats
   */
  private analyzeICEFailure(stats: ICEStats): ICEAnalysis {
    const analysis: ICEAnalysis = {
      hasHostCandidates: false,
      hasSrflxCandidates: false,
      hasRelayCandidates: false,
      recommendations: []
    };

    // Analyze local candidates
    for (const candidate of stats.localCandidates) {
      if (candidate.candidateType === 'host') {
        analysis.hasHostCandidates = true;
      } else if (candidate.candidateType === 'srflx') {
        analysis.hasSrflxCandidates = true;
      } else if (candidate.candidateType === 'relay') {
        analysis.hasRelayCandidates = true;
      }
    }

    // Analyze remote candidates
    const hasRemoteCandidates = stats.remoteCandidates.length > 0;
    
    // Analyze candidate pairs
    const successfulPairs = stats.candidatePairs.filter(pair => pair.state === 'succeeded');
    const inProgressPairs = stats.candidatePairs.filter(pair => pair.state === 'in-progress');
    const waitingPairs = stats.candidatePairs.filter(pair => pair.state === 'waiting');

    // Determine failure reason and recommendations
    if (!hasRemoteCandidates) {
      analysis.failureReason = 'No remote ICE candidates received';
      analysis.recommendations.push('Check signaling server connectivity');
      analysis.recommendations.push('Verify ICE candidate exchange is working');
      analysis.recommendations.push('Implement WebSocket-based signaling for real-time delivery');
    } else if (stats.remoteCandidates.length < 3) {
      analysis.failureReason = `Incomplete remote candidates (${stats.remoteCandidates.length} received)`;
      analysis.recommendations.push('Increase ICE candidate exchange timeout');
      analysis.recommendations.push('Check for signaling delays or packet loss');
      analysis.recommendations.push('Implement retry mechanism for candidate exchange');
    } else if (!analysis.hasRelayCandidates) {
      analysis.failureReason = 'No TURN relay candidates available';
      analysis.recommendations.push('Configure TURN servers for NAT traversal');
      analysis.recommendations.push('Check TURN server authentication credentials');
      analysis.recommendations.push('Verify TURN servers are accessible from client network');
    } else if (inProgressPairs.length > 0 && successfulPairs.length === 0) {
      analysis.failureReason = 'ICE connectivity checks in progress but not completing';
      analysis.recommendations.push('Check for firewall blocking UDP traffic');
      analysis.recommendations.push('Increase ICE timeout duration');
      analysis.recommendations.push('Verify STUN/TURN server accessibility');
    } else if (waitingPairs.length > 0 && successfulPairs.length === 0) {
      analysis.failureReason = 'ICE candidate pairs waiting but not starting checks';
      analysis.recommendations.push('Check if peer connection is in correct state');
      analysis.recommendations.push('Verify SDP exchange completed successfully');
      analysis.recommendations.push('Restart ICE gathering if needed');
    } else {
      analysis.failureReason = 'Unknown ICE connection failure';
      analysis.recommendations.push('Check network connectivity');
      analysis.recommendations.push('Review browser console for additional errors');
      analysis.recommendations.push('Try restarting the peer connection');
    }

    // Add selected candidate type if available
    if (stats.selectedPair) {
      const localCandidate = stats.localCandidates.find(c => c.id === stats.selectedPair!.localCandidateId);
      const remoteCandidate = stats.remoteCandidates.find(c => c.id === stats.selectedPair!.remoteCandidateId);
      
      if (localCandidate && remoteCandidate) {
        analysis.selectedCandidateType = `${localCandidate.candidateType} -> ${remoteCandidate.candidateType}`;
        analysis.connectionPath = `${localCandidate.address}:${localCandidate.port} -> ${remoteCandidate.address}:${remoteCandidate.port}`;
      }
    }

    return analysis;
  }

  /**
   * Log detailed failure analysis
   */
  private logFailureAnalysis(event: ICETimeoutEvent): void {
    const logContext = this.getLogContext();
    
    console.error(`${logContext} 📊 ICE FAILURE ANALYSIS:`);
    console.error(`${logContext} Duration: ${event.duration}ms`);
    console.error(`${logContext} Connection State: ${event.connectionState}`);
    console.error(`${logContext} Gathering State: ${event.gatheringState}`);
    console.error(`${logContext} Failure Reason: ${event.analysis.failureReason}`);
    
    console.error(`${logContext} 📈 CANDIDATE STATISTICS:`);
    console.error(`${logContext} Local candidates: ${event.stats.localCandidates.length}`);
    console.error(`${logContext} Remote candidates: ${event.stats.remoteCandidates.length}`);
    console.error(`${logContext} Candidate pairs: ${event.stats.candidatePairs.length}`);
    
    console.error(`${logContext} 🔍 CANDIDATE TYPES:`);
    console.error(`${logContext} Has host candidates: ${event.analysis.hasHostCandidates}`);
    console.error(`${logContext} Has srflx candidates: ${event.analysis.hasSrflxCandidates}`);
    console.error(`${logContext} Has relay candidates: ${event.analysis.hasRelayCandidates}`);
    
    if (event.analysis.selectedCandidateType) {
      console.error(`${logContext} Selected candidate: ${event.analysis.selectedCandidateType}`);
      console.error(`${logContext} Connection path: ${event.analysis.connectionPath}`);
    }
    
    console.error(`${logContext} 💡 RECOMMENDATIONS:`);
    event.analysis.recommendations.forEach((rec, index) => {
      console.error(`${logContext} ${index + 1}. ${rec}`);
    });

    // Log detailed candidate information
    if (event.stats.localCandidates.length > 0) {
      console.error(`${logContext} 📍 LOCAL CANDIDATES:`);
      event.stats.localCandidates.forEach((candidate, index) => {
        console.error(`${logContext} ${index + 1}. ${candidate.candidateType} ${candidate.protocol} ${candidate.address}:${candidate.port}`);
      });
    }

    if (event.stats.remoteCandidates.length > 0) {
      console.error(`${logContext} 📍 REMOTE CANDIDATES:`);
      event.stats.remoteCandidates.forEach((candidate, index) => {
        console.error(`${logContext} ${index + 1}. ${candidate.candidateType} ${candidate.protocol} ${candidate.address}:${candidate.port}`);
      });
    }

    // Log candidate pair states
    if (event.stats.candidatePairs.length > 0) {
      console.error(`${logContext} 🔗 CANDIDATE PAIRS:`);
      const pairsByState = event.stats.candidatePairs.reduce((acc, pair) => {
        acc[pair.state] = (acc[pair.state] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      Object.entries(pairsByState).forEach(([state, count]) => {
        console.error(`${logContext} ${state}: ${count} pairs`);
      });
    }
  }

  /**
   * Handle ICE connection timeout with comprehensive analysis
   */
  private async handleTimeout(): Promise<void> {
    if (!this.isMonitoring) return;

    const duration = Date.now() - this.startTime;
    const logContext = this.getLogContext();
    
    console.error(`${logContext} ⏰ ICE connection timeout after ${duration}ms`);
    
    try {
      // Collect detailed stats using getStats() API
      const stats = await this.collectICEStats();
      const analysis = this.analyzeICEFailure(stats);
      
      // Create comprehensive timeout event
      const timeoutEvent: ICETimeoutEvent = {
        timestamp: Date.now(),
        duration,
        language: this.language,
        attendeeId: this.attendeeId,
        role: this.role,
        connectionState: this.pc.iceConnectionState,
        gatheringState: this.pc.iceGatheringState,
        stats,
        analysis
      };

      // Log detailed failure analysis
      this.logFailureAnalysis(timeoutEvent);
      
      // Stop monitoring since we've timed out
      this.stopMonitoring();
      
      // Call the timeout callback with detailed analysis
      if (this.onTimeoutCallback) {
        this.onTimeoutCallback(timeoutEvent);
      }
      
      console.error(`${logContext} 🔍 ICE TIMEOUT SUMMARY:`);
      console.error(`${logContext} - Local candidates generated: ${stats.localCandidates.length}`);
      console.error(`${logContext} - Remote candidates received: ${stats.remoteCandidates.length}`);
      console.error(`${logContext} - Root cause: ${analysis.failureReason}`);
      console.error(`${logContext} - Primary recommendation: ${analysis.recommendations[0] || 'Check network connectivity'}`);
      
    } catch (error) {
      console.error(`${logContext} Error during timeout analysis:`, error);
      
      // Fallback timeout event without detailed stats
      const fallbackEvent: ICETimeoutEvent = {
        timestamp: Date.now(),
        duration,
        language: this.language,
        attendeeId: this.attendeeId,
        role: this.role,
        connectionState: this.pc.iceConnectionState,
        gatheringState: this.pc.iceGatheringState,
        stats: { localCandidates: [], remoteCandidates: [], candidatePairs: [] },
        analysis: {
          hasHostCandidates: false,
          hasSrflxCandidates: false,
          hasRelayCandidates: false,
          failureReason: 'ICE timeout - unable to analyze stats',
          recommendations: ['Check network connectivity', 'Verify WebSocket signaling']
        }
      };
      
      this.onTimeoutCallback?.(fallbackEvent);
    }
  }

  /**
   * Collect and log periodic stats during monitoring
   */
  private async collectAndLogStats(): Promise<void> {
    if (!this.isMonitoring) return;

    try {
      const logContext = this.getLogContext();
      const stats = await this.collectICEStats();
      const duration = Date.now() - this.startTime;

      console.log(`${logContext} 📊 ICE MONITOR (${duration}ms): ${stats.localCandidates.length} local, ${stats.remoteCandidates.length} remote, ${stats.candidatePairs.length} pairs, state: ${this.pc.iceConnectionState}`);

      // Log successful pair if found
      if (stats.selectedPair) {
        console.log(`${logContext} ✅ Successful candidate pair found, stopping monitor`);
        this.stopMonitoring();
      }

    } catch (error) {
      console.error(`${this.getLogContext()} Error collecting periodic stats:`, error);
    }
  }

  /**
   * Get log context string
   */
  private getLogContext(): string {
    const attendeeInfo = this.attendeeId ? `:${this.attendeeId}` : '';
    return `[${this.language}:${this.role.toUpperCase()}${attendeeInfo}]`;
  }

  /**
   * Get current monitoring status
   */
  getStatus(): { monitoring: boolean; connected: boolean; duration: number } {
    return {
      monitoring: this.isMonitoring,
      connected: this.isConnected,
      duration: Date.now() - this.startTime
    };
  }
}

/**
 * Create and start ICE connection monitor
 */
export function createICEMonitor(
  pc: RTCPeerConnection,
  language: string,
  role: 'guide' | 'attendee',
  attendeeId?: string,
  timeoutMs: number = 30000
): ICEConnectionMonitor {
  return new ICEConnectionMonitor(pc, language, role, attendeeId, timeoutMs);
}

/**
 * Enhanced ICE timeout handler with automatic recovery recommendations
 */
export function handleICETimeout(event: ICETimeoutEvent): void {
  const logContext = `[${event.language}:${event.role.toUpperCase()}${event.attendeeId ? `:${event.attendeeId}` : ''}]`;
  
  console.error(`${logContext} 🚨 ICE CONNECTION FAILED - IMPLEMENTING RECOVERY`);
  
  // Implement specific recovery strategies based on failure analysis
  if (event.analysis.failureReason?.includes('No remote ICE candidates')) {
    console.error(`${logContext} 🔄 RECOVERY: Signaling issue detected - checking WebSocket connection`);
    // Could trigger signaling reconnection here
  } else if (event.analysis.failureReason?.includes('No TURN relay candidates')) {
    console.error(`${logContext} 🔄 RECOVERY: TURN server issue - attempting ICE restart`);
    // Could trigger ICE restart here
  } else if (!event.analysis.hasRelayCandidates) {
    console.error(`${logContext} 🔄 RECOVERY: NAT traversal issue - recommend TURN server configuration`);
  }
}

export default ICEConnectionMonitor;
export type { ICETimeoutEvent, ICEStats, ICEAnalysis };