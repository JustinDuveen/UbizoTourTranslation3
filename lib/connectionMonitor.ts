/**
 * Real-time WebRTC Connection Quality Monitor
 * Tracks connection health, performance metrics, and provides automated recovery
 */

export interface ConnectionMetrics {
  rtt: number; // Round-trip time in ms
  packetsLost: number;
  packetsReceived: number;
  bytesReceived: number;
  audioLevel: number;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  timestamp: number;
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

export interface ConnectionHealth {
  score: number; // 0-100
  status: 'healthy' | 'degraded' | 'critical' | 'failed';
  issues: string[];
  recommendations: string[];
}

export class ConnectionMonitor {
  private pc: RTCPeerConnection;
  private language: string;
  private attendeeId?: string;
  private metrics: ConnectionMetrics[] = [];
  private monitorInterval?: NodeJS.Timeout;
  private onHealthChange?: (health: ConnectionHealth) => void;
  private onMetricsUpdate?: (metrics: ConnectionMetrics) => void;
  
  constructor(
    pc: RTCPeerConnection, 
    language: string, 
    attendeeId?: string,
    callbacks?: {
      onHealthChange?: (health: ConnectionHealth) => void;
      onMetricsUpdate?: (metrics: ConnectionMetrics) => void;
    }
  ) {
    this.pc = pc;
    this.language = language;
    this.attendeeId = attendeeId;
    this.onHealthChange = callbacks?.onHealthChange;
    this.onMetricsUpdate = callbacks?.onMetricsUpdate;
  }

  start(intervalMs: number = 2000): void {
    console.log(`[MONITOR] Starting connection monitoring for ${this.language}${this.attendeeId ? ` (${this.attendeeId})` : ''}`);
    
    this.monitorInterval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics();
        this.metrics.push(metrics);
        
        // Keep only last 30 measurements (1 minute at 2s intervals)
        if (this.metrics.length > 30) {
          this.metrics = this.metrics.slice(-30);
        }
        
        const health = this.calculateHealth(metrics);
        
        // Log significant changes
        this.logMetrics(metrics, health);
        
        // Trigger callbacks
        this.onMetricsUpdate?.(metrics);
        this.onHealthChange?.(health);
        
        // Auto-recovery for critical issues
        if (health.status === 'critical' || health.status === 'failed') {
          this.handleCriticalIssues(health);
        }
        
      } catch (error) {
        console.error(`[MONITOR] Error collecting metrics for ${this.language}:`, error);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
      console.log(`[MONITOR] Stopped monitoring for ${this.language}`);
    }
  }

  private async collectMetrics(): Promise<ConnectionMetrics> {
    const stats = await this.pc.getStats();
    let rtt = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let bytesReceived = 0;
    let audioLevel = 0;

    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        rtt = report.currentRoundTripTime * 1000 || 0; // Convert to ms
      } else if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        packetsLost = report.packetsLost || 0;
        packetsReceived = report.packetsReceived || 0;
        bytesReceived = report.bytesReceived || 0;
        audioLevel = report.audioLevel || 0;
      }
    });

    const quality = this.determineQuality(rtt, packetsLost, packetsReceived);

    return {
      rtt,
      packetsLost,
      packetsReceived,
      bytesReceived,
      audioLevel,
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      timestamp: Date.now(),
      quality
    };
  }

  private determineQuality(rtt: number, packetsLost: number, packetsReceived: number): ConnectionMetrics['quality'] {
    const lossRate = packetsReceived > 0 ? (packetsLost / packetsReceived) * 100 : 0;
    
    if (rtt > 500 || lossRate > 5) return 'critical';
    if (rtt > 300 || lossRate > 2) return 'poor';
    if (rtt > 150 || lossRate > 1) return 'fair';
    if (rtt > 50 || lossRate > 0.5) return 'good';
    return 'excellent';
  }

  private calculateHealth(metrics: ConnectionMetrics): ConnectionHealth {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // RTT analysis
    if (metrics.rtt > 500) {
      score -= 40;
      issues.push(`High latency: ${metrics.rtt.toFixed(0)}ms`);
      recommendations.push('Check network connection and consider using closer TURN servers');
    } else if (metrics.rtt > 300) {
      score -= 20;
      issues.push(`Elevated latency: ${metrics.rtt.toFixed(0)}ms`);
    }

    // Packet loss analysis
    const lossRate = metrics.packetsReceived > 0 ? (metrics.packetsLost / metrics.packetsReceived) * 100 : 0;
    if (lossRate > 5) {
      score -= 30;
      issues.push(`High packet loss: ${lossRate.toFixed(1)}%`);
      recommendations.push('Network congestion detected - consider reconnecting');
    } else if (lossRate > 2) {
      score -= 15;
      issues.push(`Moderate packet loss: ${lossRate.toFixed(1)}%`);
    }

    // Connection state analysis
    if (metrics.connectionState === 'failed' || metrics.iceConnectionState === 'failed') {
      score = 0;
      issues.push('Connection failed');
      recommendations.push('Immediate reconnection required');
    } else if (metrics.connectionState === 'disconnected' || metrics.iceConnectionState === 'disconnected') {
      score -= 50;
      issues.push('Connection disconnected');
      recommendations.push('Attempting automatic reconnection');
    }

    // Audio level analysis
    if (metrics.packetsReceived > 100 && metrics.audioLevel === 0) {
      score -= 25;
      issues.push('No audio detected despite packets received');
      recommendations.push('Check audio track configuration');
    }

    // Determine status
    let status: ConnectionHealth['status'];
    if (score >= 80) status = 'healthy';
    else if (score >= 60) status = 'degraded';
    else if (score >= 20) status = 'critical';
    else status = 'failed';

    return { score, status, issues, recommendations };
  }

  private logMetrics(metrics: ConnectionMetrics, health: ConnectionHealth): void {
    const context = `[MONITOR-${this.language.toUpperCase()}]`;
    
    // Log every 10 seconds or on significant changes
    const shouldLog = this.metrics.length % 5 === 0 || health.status !== 'healthy';
    
    if (shouldLog) {
      console.log(`${context} 📊 Connection Health: ${health.status.toUpperCase()} (${health.score}/100)`);
      console.log(`${context} 📈 RTT: ${metrics.rtt.toFixed(0)}ms | Quality: ${metrics.quality.toUpperCase()}`);
      console.log(`${context} 📦 Packets: ${metrics.packetsReceived} received, ${metrics.packetsLost} lost`);
      console.log(`${context} 🔊 Audio Level: ${(metrics.audioLevel * 100).toFixed(1)}%`);
      
      if (health.issues.length > 0) {
        console.warn(`${context} ⚠️ Issues: ${health.issues.join(', ')}`);
      }
      
      if (health.recommendations.length > 0) {
        console.info(`${context} 💡 Recommendations: ${health.recommendations.join(', ')}`);
      }
    }
  }

  private handleCriticalIssues(health: ConnectionHealth): void {
    const context = `[MONITOR-${this.language.toUpperCase()}]`;
    
    console.error(`${context} 🚨 CRITICAL CONNECTION ISSUES DETECTED`);
    console.error(`${context} Issues: ${health.issues.join(', ')}`);
    console.error(`${context} Recommendations: ${health.recommendations.join(', ')}`);
    
    // Trigger automatic recovery mechanisms
    if (health.issues.some(issue => issue.includes('failed'))) {
      console.log(`${context} 🔄 Triggering connection restart due to failure`);
      // Connection restart will be handled by the calling code
    }
  }

  getLatestMetrics(): ConnectionMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  getAverageMetrics(lastN: number = 10): Partial<ConnectionMetrics> | null {
    if (this.metrics.length === 0) return null;
    
    const recentMetrics = this.metrics.slice(-lastN);
    const avg = {
      rtt: recentMetrics.reduce((sum, m) => sum + m.rtt, 0) / recentMetrics.length,
      packetsLost: recentMetrics.reduce((sum, m) => sum + m.packetsLost, 0),
      packetsReceived: recentMetrics.reduce((sum, m) => sum + m.packetsReceived, 0),
      audioLevel: recentMetrics.reduce((sum, m) => sum + m.audioLevel, 0) / recentMetrics.length
    };
    
    return avg;
  }
}

// Global monitor registry
const monitors = new Map<string, ConnectionMonitor>();

export function startConnectionMonitoring(
  pc: RTCPeerConnection, 
  language: string, 
  attendeeId?: string,
  callbacks?: {
    onHealthChange?: (health: ConnectionHealth) => void;
    onMetricsUpdate?: (metrics: ConnectionMetrics) => void;
  }
): void {
  const key = attendeeId ? `${language}-${attendeeId}` : language;
  
  // Stop existing monitor if any
  stopConnectionMonitoring(language, attendeeId);
  
  const monitor = new ConnectionMonitor(pc, language, attendeeId, callbacks);
  monitors.set(key, monitor);
  monitor.start();
}

export function stopConnectionMonitoring(language: string, attendeeId?: string): void {
  const key = attendeeId ? `${language}-${attendeeId}` : language;
  const monitor = monitors.get(key);
  
  if (monitor) {
    monitor.stop();
    monitors.delete(key);
  }
}

export function getConnectionMetrics(language: string, attendeeId?: string): ConnectionMetrics | null {
  const key = attendeeId ? `${language}-${attendeeId}` : language;
  const monitor = monitors.get(key);
  return monitor?.getLatestMetrics() || null;
}
