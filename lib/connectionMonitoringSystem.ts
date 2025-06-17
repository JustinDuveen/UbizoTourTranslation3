/**
 * Production-Grade Connection Monitoring and Diagnostics System
 * Provides real-time monitoring, quality assessment, and diagnostic capabilities
 */

export interface ConnectionMetrics {
  // Basic Connection Stats
  connectionId: string;
  timestamp: number;
  duration: number;
  
  // WebRTC Connection States
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
  
  // Network Quality Metrics
  rtt: number;
  jitter: number;
  packetsLost: number;
  packetsReceived: number;
  packetsSent: number;
  bytesReceived: number;
  bytesSent: number;
  availableOutgoingBitrate?: number;
  availableIncomingBitrate?: number;
  
  // Audio Specific Metrics
  audioLevel: number;
  audioInputLevel?: number;
  audioOutputLevel?: number;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
  audioEnergyLevel?: number;
  audioConcealment?: number;
  
  // ICE Candidate Information
  localCandidateType?: string;
  remoteCandidateType?: string;
  candidatePairState?: string;
  transportType?: string;
  
  // Device and Browser Information
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browserType: string;
  platformType: string;
  networkType?: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  
  // Quality Assessment
  overallQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  qualityScore: number; // 0-100
  
  // Error Information
  errors: ConnectionError[];
  warnings: ConnectionWarning[];
}

export interface ConnectionError {
  type: 'ice_failed' | 'media_lost' | 'signaling_failed' | 'timeout' | 'codec_error' | 'network_error';
  message: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, any>;
}

export interface ConnectionWarning {
  type: 'high_rtt' | 'packet_loss' | 'low_audio' | 'connection_degraded' | 'ice_restart';
  message: string;
  timestamp: number;
  value?: number;
  threshold?: number;
}

export interface DiagnosticReport {
  reportId: string;
  timestamp: number;
  duration: number;
  connectionId: string;
  
  // Summary Statistics
  summary: {
    overallHealth: 'healthy' | 'degraded' | 'poor' | 'critical';
    primaryIssues: string[];
    recommendations: string[];
  };
  
  // Detailed Metrics
  metrics: {
    latest: ConnectionMetrics;
    average: Partial<ConnectionMetrics>;
    min: Partial<ConnectionMetrics>;
    max: Partial<ConnectionMetrics>;
    trend: 'improving' | 'stable' | 'degrading';
  };
  
  // Connection Timeline
  timeline: {
    connectionEstablished?: number;
    firstMediaReceived?: number;
    firstAudioDetected?: number;
    lastDisconnection?: number;
    reconnectionAttempts: number;
  };
  
  // Network Analysis
  networkAnalysis: {
    stability: 'stable' | 'unstable' | 'highly_unstable';
    bandwidth: 'sufficient' | 'limited' | 'inadequate';
    latency: 'low' | 'moderate' | 'high' | 'very_high';
    reliability: number; // 0-100
  };
  
  // Audio Quality Analysis
  audioAnalysis: {
    quality: 'excellent' | 'good' | 'fair' | 'poor';
    consistency: 'consistent' | 'variable' | 'unstable';
    issues: string[];
  };
}

export interface MonitoringConfig {
  metricsInterval: number;
  reportInterval: number;
  historyRetention: number;
  qualityThresholds: {
    excellent: { rtt: number; packetLoss: number; audioLevel: number };
    good: { rtt: number; packetLoss: number; audioLevel: number };
    fair: { rtt: number; packetLoss: number; audioLevel: number };
  };
  alertThresholds: {
    highRTT: number;
    packetLossRate: number;
    lowAudioLevel: number;
    connectionTimeout: number;
  };
  enableDetailedLogging: boolean;
  enablePerformanceMetrics: boolean;
}

export class ConnectionMonitoringSystem {
  private config: MonitoringConfig;
  private connectionId: string;
  private peerConnection: RTCPeerConnection | null = null;
  private metricsHistory: ConnectionMetrics[] = [];
  private currentMetrics: ConnectionMetrics | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private connectionStartTime: number = 0;
  private listeners: Map<string, ((data: any) => void)[]> = new Map();
  private diagnosticCallbacks: ((report: DiagnosticReport) => void)[] = [];

  constructor(connectionId: string, config: MonitoringConfig) {
    this.connectionId = connectionId;
    this.config = config;
    this.connectionStartTime = Date.now();
  }

  // Monitoring Lifecycle
  public startMonitoring(peerConnection: RTCPeerConnection): void {
    this.peerConnection = peerConnection;
    this.setupPeerConnectionListeners();
    this.startMetricsCollection();
    this.startReportGeneration();

    const context = `[Monitor:${this.connectionId}]`;
    console.log(`${context} ✅ Started connection monitoring`);
  }

  public stopMonitoring(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }

    const context = `[Monitor:${this.connectionId}]`;
    console.log(`${context} 🛑 Stopped connection monitoring`);
  }

  // Metrics Collection
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(async () => {
      await this.collectMetrics();
    }, this.config.metricsInterval);
  }

  private async collectMetrics(): Promise<void> {
    if (!this.peerConnection) return;

    try {
      const metrics = await this.gatherConnectionMetrics();
      this.currentMetrics = metrics;
      this.metricsHistory.push(metrics);

      // Maintain history size
      if (this.metricsHistory.length > this.config.historyRetention) {
        this.metricsHistory = this.metricsHistory.slice(-this.config.historyRetention);
      }

      // Check for alerts
      this.checkForAlerts(metrics);

      // Notify listeners
      this.notifyListeners('metrics_updated', metrics);

      if (this.config.enableDetailedLogging) {
        this.logDetailedMetrics(metrics);
      }
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  private async gatherConnectionMetrics(): Promise<ConnectionMetrics> {
    const pc = this.peerConnection!;
    const stats = await pc.getStats();
    
    const metrics: ConnectionMetrics = {
      connectionId: this.connectionId,
      timestamp: Date.now(),
      duration: Date.now() - this.connectionStartTime,
      
      // Connection states
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
      
      // Initialize metrics with defaults
      rtt: 0,
      jitter: 0,
      packetsLost: 0,
      packetsReceived: 0,
      packetsSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      audioLevel: 0,
      
      // Device information
      deviceType: this.detectDeviceType(),
      browserType: this.detectBrowserType(),
      platformType: this.detectPlatformType(),
      networkType: this.detectNetworkType(),
      
      overallQuality: 'poor',
      qualityScore: 0,
      errors: [],
      warnings: []
    };

    // Process WebRTC stats
    stats.forEach(report => {
      this.processStatsReport(report, metrics);
    });

    // Calculate quality metrics
    this.calculateQualityMetrics(metrics);

    return metrics;
  }

  private processStatsReport(report: any, metrics: ConnectionMetrics): void {
    switch (report.type) {
      case 'candidate-pair':
        if (report.state === 'succeeded') {
          metrics.rtt = report.currentRoundTripTime * 1000 || 0; // Convert to ms
          metrics.localCandidateType = report.localCandidateType;
          metrics.remoteCandidateType = report.remoteCandidateType;
          metrics.candidatePairState = report.state;
          metrics.transportType = report.transportType;
          metrics.availableOutgoingBitrate = report.availableOutgoingBitrate;
          metrics.availableIncomingBitrate = report.availableIncomingBitrate;
        }
        break;

      case 'inbound-rtp':
        if (report.kind === 'audio') {
          metrics.packetsReceived = report.packetsReceived || 0;
          metrics.packetsLost = report.packetsLost || 0;
          metrics.bytesReceived = report.bytesReceived || 0;
          metrics.jitter = (report.jitter || 0) * 1000; // Convert to ms
          metrics.audioCodec = report.codecId;
          metrics.audioConcealment = report.concealedSamples;
        }
        break;

      case 'outbound-rtp':
        if (report.kind === 'audio') {
          metrics.packetsSent = report.packetsSent || 0;
          metrics.bytesSent = report.bytesSent || 0;
        }
        break;

      case 'track':
        if (report.kind === 'audio') {
          metrics.audioLevel = report.audioLevel || 0;
          metrics.audioEnergyLevel = report.totalAudioEnergy || 0;
        }
        break;

      case 'media-source':
        if (report.kind === 'audio') {
          metrics.audioInputLevel = report.audioLevel || 0;
          metrics.audioChannels = report.channels;
          metrics.audioSampleRate = report.sampleRate;
        }
        break;

      case 'codec':
        if (report.mimeType && report.mimeType.includes('audio')) {
          metrics.audioCodec = report.mimeType;
        }
        break;
    }
  }

  private calculateQualityMetrics(metrics: ConnectionMetrics): void {
    const { qualityThresholds } = this.config;
    
    // Calculate packet loss rate
    const packetLossRate = metrics.packetsReceived > 0 
      ? metrics.packetsLost / (metrics.packetsReceived + metrics.packetsLost)
      : 0;

    // Quality assessment based on multiple factors
    let qualityScore = 100;
    let qualityLevel: 'excellent' | 'good' | 'fair' | 'poor' | 'critical' = 'excellent';

    // RTT impact
    if (metrics.rtt > qualityThresholds.excellent.rtt) {
      qualityScore -= 15;
      if (metrics.rtt > qualityThresholds.good.rtt) {
        qualityScore -= 15;
        if (metrics.rtt > qualityThresholds.fair.rtt) {
          qualityScore -= 20;
        }
      }
    }

    // Packet loss impact
    if (packetLossRate > qualityThresholds.excellent.packetLoss) {
      qualityScore -= 20;
      if (packetLossRate > qualityThresholds.good.packetLoss) {
        qualityScore -= 20;
        if (packetLossRate > qualityThresholds.fair.packetLoss) {
          qualityScore -= 30;
        }
      }
    }

    // Audio level impact
    if (metrics.audioLevel < qualityThresholds.excellent.audioLevel) {
      qualityScore -= 10;
      if (metrics.audioLevel < qualityThresholds.good.audioLevel) {
        qualityScore -= 10;
        if (metrics.audioLevel < qualityThresholds.fair.audioLevel) {
          qualityScore -= 15;
        }
      }
    }

    // Jitter impact
    if (metrics.jitter > 30) {
      qualityScore -= 10;
      if (metrics.jitter > 50) {
        qualityScore -= 15;
      }
    }

    // Connection state impact
    if (metrics.connectionState !== 'connected') {
      qualityScore -= 50;
    }
    if (metrics.iceConnectionState === 'disconnected') {
      qualityScore -= 30;
    }

    // Determine quality level
    qualityScore = Math.max(0, Math.min(100, qualityScore));
    
    if (qualityScore >= 85) qualityLevel = 'excellent';
    else if (qualityScore >= 70) qualityLevel = 'good';
    else if (qualityScore >= 50) qualityLevel = 'fair';
    else if (qualityScore >= 25) qualityLevel = 'poor';
    else qualityLevel = 'critical';

    metrics.qualityScore = qualityScore;
    metrics.overallQuality = qualityLevel;

    // Generate warnings based on thresholds
    this.generateWarnings(metrics, packetLossRate);
  }

  private generateWarnings(metrics: ConnectionMetrics, packetLossRate: number): void {
    const { alertThresholds } = this.config;

    if (metrics.rtt > alertThresholds.highRTT) {
      metrics.warnings.push({
        type: 'high_rtt',
        message: `High round-trip time: ${metrics.rtt.toFixed(0)}ms`,
        timestamp: metrics.timestamp,
        value: metrics.rtt,
        threshold: alertThresholds.highRTT
      });
    }

    if (packetLossRate > alertThresholds.packetLossRate) {
      metrics.warnings.push({
        type: 'packet_loss',
        message: `High packet loss rate: ${(packetLossRate * 100).toFixed(1)}%`,
        timestamp: metrics.timestamp,
        value: packetLossRate,
        threshold: alertThresholds.packetLossRate
      });
    }

    if (metrics.audioLevel < alertThresholds.lowAudioLevel) {
      metrics.warnings.push({
        type: 'low_audio',
        message: `Low audio level detected: ${metrics.audioLevel.toFixed(3)}`,
        timestamp: metrics.timestamp,
        value: metrics.audioLevel,
        threshold: alertThresholds.lowAudioLevel
      });
    }

    if (metrics.connectionState === 'disconnected' || metrics.iceConnectionState === 'disconnected') {
      metrics.warnings.push({
        type: 'connection_degraded',
        message: 'Connection degraded - experiencing disconnection',
        timestamp: metrics.timestamp
      });
    }
  }

  // Alert System
  private checkForAlerts(metrics: ConnectionMetrics): void {
    const context = `[Monitor:${this.connectionId}]`;

    // Check for critical conditions
    if (metrics.overallQuality === 'critical') {
      console.error(`${context} 🚨 CRITICAL: Connection quality is critical (score: ${metrics.qualityScore})`);
      this.notifyListeners('alert', {
        level: 'critical',
        message: 'Connection quality is critical',
        metrics
      });
    }

    // Check for errors
    if (metrics.connectionState === 'failed' || metrics.iceConnectionState === 'failed') {
      const error: ConnectionError = {
        type: 'ice_failed',
        message: 'ICE connection failed',
        timestamp: metrics.timestamp,
        severity: 'critical',
        context: {
          connectionState: metrics.connectionState,
          iceConnectionState: metrics.iceConnectionState
        }
      };
      metrics.errors.push(error);
      
      console.error(`${context} ❌ Connection failed:`, error);
      this.notifyListeners('error', error);
    }

    // Check warnings
    metrics.warnings.forEach(warning => {
      if (warning.type === 'high_rtt' && warning.value! > 1000) {
        console.warn(`${context} ⚠️ Very high RTT: ${warning.value}ms`);
      }
    });
  }

  // Report Generation
  private startReportGeneration(): void {
    this.reportTimer = setInterval(() => {
      this.generateDiagnosticReport();
    }, this.config.reportInterval);
  }

  public generateDiagnosticReport(): DiagnosticReport | null {
    if (this.metricsHistory.length === 0 || !this.currentMetrics) {
      return null;
    }

    const report: DiagnosticReport = {
      reportId: `report_${this.connectionId}_${Date.now()}`,
      timestamp: Date.now(),
      duration: Date.now() - this.connectionStartTime,
      connectionId: this.connectionId,
      
      summary: this.generateSummary(),
      metrics: this.calculateAggregateMetrics(),
      timeline: this.generateTimeline(),
      networkAnalysis: this.analyzeNetwork(),
      audioAnalysis: this.analyzeAudio()
    };

    // Notify listeners
    this.notifyListeners('report_generated', report);
    this.diagnosticCallbacks.forEach(callback => callback(report));

    const context = `[Monitor:${this.connectionId}]`;
    console.log(`${context} 📊 Generated diagnostic report - Health: ${report.summary.overallHealth}, Quality: ${this.currentMetrics.overallQuality}`);

    return report;
  }

  private generateSummary(): DiagnosticReport['summary'] {
    const latest = this.currentMetrics!;
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Identify primary issues
    if (latest.overallQuality === 'critical' || latest.overallQuality === 'poor') {
      issues.push('Poor connection quality detected');
      recommendations.push('Check network connectivity and consider reconnection');
    }

    if (latest.rtt > 300) {
      issues.push('High latency detected');
      recommendations.push('Switch to a lower-latency network connection if possible');
    }

    const recentWarnings = this.metricsHistory
      .slice(-10)
      .flatMap(m => m.warnings)
      .filter(w => Date.now() - w.timestamp < 60000); // Last minute

    if (recentWarnings.some(w => w.type === 'packet_loss')) {
      issues.push('Packet loss detected');
      recommendations.push('Check network stability and bandwidth availability');
    }

    if (recentWarnings.some(w => w.type === 'low_audio')) {
      issues.push('Low audio levels detected');
      recommendations.push('Check microphone settings and audio processing');
    }

    // Determine overall health
    let overallHealth: 'healthy' | 'degraded' | 'poor' | 'critical' = 'healthy';
    if (latest.overallQuality === 'critical') overallHealth = 'critical';
    else if (latest.overallQuality === 'poor') overallHealth = 'poor';
    else if (latest.overallQuality === 'fair' || issues.length > 1) overallHealth = 'degraded';

    return { overallHealth, primaryIssues: issues, recommendations };
  }

  private calculateAggregateMetrics(): DiagnosticReport['metrics'] {
    const recent = this.metricsHistory.slice(-20); // Last 20 measurements
    
    if (recent.length === 0) {
      return {
        latest: this.currentMetrics!,
        average: {},
        min: {},
        max: {},
        trend: 'stable'
      };
    }

    // Calculate averages
    const average = {
      rtt: recent.reduce((sum, m) => sum + m.rtt, 0) / recent.length,
      jitter: recent.reduce((sum, m) => sum + m.jitter, 0) / recent.length,
      audioLevel: recent.reduce((sum, m) => sum + m.audioLevel, 0) / recent.length,
      qualityScore: recent.reduce((sum, m) => sum + m.qualityScore, 0) / recent.length
    };

    // Calculate min/max
    const min = {
      rtt: Math.min(...recent.map(m => m.rtt)),
      jitter: Math.min(...recent.map(m => m.jitter)),
      audioLevel: Math.min(...recent.map(m => m.audioLevel)),
      qualityScore: Math.min(...recent.map(m => m.qualityScore))
    };

    const max = {
      rtt: Math.max(...recent.map(m => m.rtt)),
      jitter: Math.max(...recent.map(m => m.jitter)),
      audioLevel: Math.max(...recent.map(m => m.audioLevel)),
      qualityScore: Math.max(...recent.map(m => m.qualityScore))
    };

    // Calculate trend
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));
    
    const firstAvgQuality = firstHalf.reduce((sum, m) => sum + m.qualityScore, 0) / firstHalf.length;
    const secondAvgQuality = secondHalf.reduce((sum, m) => sum + m.qualityScore, 0) / secondHalf.length;
    
    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    const difference = secondAvgQuality - firstAvgQuality;
    if (difference > 5) trend = 'improving';
    else if (difference < -5) trend = 'degrading';

    return {
      latest: this.currentMetrics!,
      average,
      min,
      max,
      trend
    };
  }

  private generateTimeline(): DiagnosticReport['timeline'] {
    // This would track important connection events
    // For now, return basic timeline data
    return {
      connectionEstablished: this.connectionStartTime,
      reconnectionAttempts: 0 // Would track actual reconnection attempts
    };
  }

  private analyzeNetwork(): DiagnosticReport['networkAnalysis'] {
    const recent = this.metricsHistory.slice(-10);
    
    if (recent.length === 0) {
      return {
        stability: 'stable',
        bandwidth: 'sufficient',
        latency: 'low',
        reliability: 100
      };
    }

    // Analyze stability (based on RTT variance)
    const rttValues = recent.map(m => m.rtt);
    const avgRtt = rttValues.reduce((sum, rtt) => sum + rtt, 0) / rttValues.length;
    const rttVariance = rttValues.reduce((sum, rtt) => sum + Math.pow(rtt - avgRtt, 2), 0) / rttValues.length;
    
    let stability: 'stable' | 'unstable' | 'highly_unstable' = 'stable';
    if (rttVariance > 10000) stability = 'highly_unstable';
    else if (rttVariance > 2500) stability = 'unstable';

    // Analyze bandwidth
    const avgBytesReceived = recent.reduce((sum, m) => sum + m.bytesReceived, 0) / recent.length;
    let bandwidth: 'sufficient' | 'limited' | 'inadequate' = 'sufficient';
    if (avgBytesReceived < 1000) bandwidth = 'inadequate';
    else if (avgBytesReceived < 5000) bandwidth = 'limited';

    // Analyze latency
    let latency: 'low' | 'moderate' | 'high' | 'very_high' = 'low';
    if (avgRtt > 500) latency = 'very_high';
    else if (avgRtt > 200) latency = 'high';
    else if (avgRtt > 100) latency = 'moderate';

    // Calculate reliability
    const successfulConnections = recent.filter(m => 
      m.connectionState === 'connected' && m.iceConnectionState !== 'failed'
    ).length;
    const reliability = (successfulConnections / recent.length) * 100;

    return { stability, bandwidth, latency, reliability };
  }

  private analyzeAudio(): DiagnosticReport['audioAnalysis'] {
    const recent = this.metricsHistory.slice(-10);
    
    if (recent.length === 0) {
      return {
        quality: 'good',
        consistency: 'consistent',
        issues: []
      };
    }

    const audioLevels = recent.map(m => m.audioLevel);
    const avgAudioLevel = audioLevels.reduce((sum, level) => sum + level, 0) / audioLevels.length;
    
    // Assess quality
    let quality: 'excellent' | 'good' | 'fair' | 'poor' = 'good';
    if (avgAudioLevel < 0.01) quality = 'poor';
    else if (avgAudioLevel < 0.05) quality = 'fair';
    else if (avgAudioLevel > 0.2) quality = 'excellent';

    // Assess consistency
    const audioVariance = audioLevels.reduce((sum, level) => sum + Math.pow(level - avgAudioLevel, 2), 0) / audioLevels.length;
    let consistency: 'consistent' | 'variable' | 'unstable' = 'consistent';
    if (audioVariance > 0.01) consistency = 'unstable';
    else if (audioVariance > 0.005) consistency = 'variable';

    // Identify issues
    const issues: string[] = [];
    if (avgAudioLevel < 0.01) issues.push('Very low audio levels detected');
    if (audioVariance > 0.01) issues.push('Highly variable audio levels');
    
    const hasPacketLoss = recent.some(m => m.packetsLost > 0);
    if (hasPacketLoss) issues.push('Packet loss affecting audio quality');

    return { quality, consistency, issues };
  }

  // Device and Environment Detection
  private detectDeviceType(): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
    if (typeof navigator === 'undefined') return 'unknown';
    
    const userAgent = navigator.userAgent.toLowerCase();
    if (/mobile|android|iphone|ipod|blackberry|windows phone/.test(userAgent)) {
      return 'mobile';
    }
    if (/tablet|ipad/.test(userAgent)) {
      return 'tablet';
    }
    return 'desktop';
  }

  private detectBrowserType(): string {
    if (typeof navigator === 'undefined') return 'unknown';
    
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  }

  private detectPlatformType(): string {
    if (typeof navigator === 'undefined') return 'unknown';
    
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) return 'Windows';
    if (platform.includes('mac')) return 'macOS';
    if (platform.includes('linux')) return 'Linux';
    if (platform.includes('android')) return 'Android';
    if (platform.includes('iphone') || platform.includes('ipad')) return 'iOS';
    return 'Unknown';
  }

  private detectNetworkType(): 'wifi' | 'cellular' | 'ethernet' | 'unknown' {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const connection = (navigator as any).connection;
      return connection.type || 'unknown';
    }
    return 'unknown';
  }

  // Event Management
  public onMetricsUpdate(callback: (metrics: ConnectionMetrics) => void): void {
    this.addEventListener('metrics_updated', callback);
  }

  public onAlert(callback: (alert: any) => void): void {
    this.addEventListener('alert', callback);
  }

  public onError(callback: (error: ConnectionError) => void): void {
    this.addEventListener('error', callback);
  }

  public onReport(callback: (report: DiagnosticReport) => void): void {
    this.diagnosticCallbacks.push(callback);
  }

  private addEventListener(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  private notifyListeners(event: string, data: any): void {
    const eventListeners = this.listeners.get(event) || [];
    eventListeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    });
  }

  // Utility Methods
  private setupPeerConnectionListeners(): void {
    if (!this.peerConnection) return;

    this.peerConnection.addEventListener('connectionstatechange', () => {
      const context = `[Monitor:${this.connectionId}]`;
      console.log(`${context} Connection state changed: ${this.peerConnection!.connectionState}`);
    });

    this.peerConnection.addEventListener('iceconnectionstatechange', () => {
      const context = `[Monitor:${this.connectionId}]`;
      console.log(`${context} ICE connection state changed: ${this.peerConnection!.iceConnectionState}`);
    });
  }

  private logDetailedMetrics(metrics: ConnectionMetrics): void {
    const context = `[Monitor:${this.connectionId}]`;
    console.log(`${context} 📊 Metrics:`, {
      quality: `${metrics.overallQuality} (${metrics.qualityScore})`,
      rtt: `${metrics.rtt.toFixed(0)}ms`,
      jitter: `${metrics.jitter.toFixed(1)}ms`,
      packetLoss: metrics.packetsLost,
      audioLevel: metrics.audioLevel.toFixed(3),
      connectionState: metrics.connectionState,
      warnings: metrics.warnings.length
    });
  }

  // Public API
  public getCurrentMetrics(): ConnectionMetrics | null {
    return this.currentMetrics;
  }

  public getMetricsHistory(): ConnectionMetrics[] {
    return [...this.metricsHistory];
  }

  public getConnectionDuration(): number {
    return Date.now() - this.connectionStartTime;
  }

  public isHealthy(): boolean {
    return this.currentMetrics ? 
      this.currentMetrics.overallQuality !== 'critical' && 
      this.currentMetrics.overallQuality !== 'poor' : false;
  }

  // Cleanup
  public destroy(): void {
    this.stopMonitoring();
    this.listeners.clear();
    this.diagnosticCallbacks = [];
    this.metricsHistory = [];
    this.currentMetrics = null;
  }
}

// Default Configuration
export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  metricsInterval: 5000, // 5 seconds
  reportInterval: 60000, // 1 minute
  historyRetention: 120, // Keep 120 measurements (10 minutes at 5s intervals)
  qualityThresholds: {
    excellent: { rtt: 50, packetLoss: 0.001, audioLevel: 0.1 },
    good: { rtt: 150, packetLoss: 0.01, audioLevel: 0.05 },
    fair: { rtt: 300, packetLoss: 0.03, audioLevel: 0.02 }
  },
  alertThresholds: {
    highRTT: 400,
    packetLossRate: 0.05,
    lowAudioLevel: 0.01,
    connectionTimeout: 30000
  },
  enableDetailedLogging: false,
  enablePerformanceMetrics: true
};

// Factory function
export function createConnectionMonitoringSystem(
  connectionId: string,
  config?: Partial<MonitoringConfig>
): ConnectionMonitoringSystem {
  const finalConfig = { ...DEFAULT_MONITORING_CONFIG, ...config };
  return new ConnectionMonitoringSystem(connectionId, finalConfig);
}