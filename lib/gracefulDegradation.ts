/**
 * Production-Grade Graceful Degradation System
 * Implements adaptive quality management and fallback strategies
 */

export enum QualityLevel {
  MAXIMUM = 'maximum',
  HIGH = 'high', 
  MEDIUM = 'medium',
  LOW = 'low',
  MINIMUM = 'minimum'
}

export enum NetworkCondition {
  EXCELLENT = 'excellent',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  CRITICAL = 'critical'
}

export interface QualitySettings {
  audioCodec: string;
  audioBitrate: number;
  audioSampleRate: number;
  audioChannels: number;
  bufferSize: number;
  iceTimeout: number;
  reconnectDelay: number;
  heartbeatInterval: number;
}

export interface AdaptationTriggers {
  rttThreshold: number;
  packetLossThreshold: number;
  jitterThreshold: number;
  audioLevelThreshold: number;
  connectionFailureThreshold: number;
  adaptationCooldown: number;
}

export interface FallbackStrategy {
  level: QualityLevel;
  triggers: AdaptationTriggers;
  settings: QualitySettings;
  enabled: boolean;
  description: string;
}

export interface AdaptationEvent {
  timestamp: number;
  fromLevel: QualityLevel;
  toLevel: QualityLevel;
  trigger: string;
  reason: string;
  metrics: {
    rtt: number;
    packetLoss: number;
    jitter: number;
    audioLevel: number;
  };
  success: boolean;
}

export interface DegradationConfig {
  strategies: FallbackStrategy[];
  adaptationEnabled: boolean;
  aggressiveMode: boolean;
  minQualityLevel: QualityLevel;
  adaptationHistory: number;
  emergencyFallback: boolean;
  networkTypeAdaptation: boolean;
}

export class GracefulDegradationManager {
  private config: DegradationConfig;
  private currentLevel: QualityLevel = QualityLevel.MAXIMUM;
  private currentStrategy: FallbackStrategy;
  private networkCondition: NetworkCondition = NetworkCondition.GOOD;
  private adaptationHistory: AdaptationEvent[] = [];
  private lastAdaptation: number = 0;
  private connectionId: string;
  private metricsMonitor: any = null; // Will be ConnectionMonitoringSystem
  private adaptationListeners: ((event: AdaptationEvent) => void)[] = [];
  private qualityChangeListeners: ((level: QualityLevel, settings: QualitySettings) => void)[] = [];

  constructor(connectionId: string, config: DegradationConfig) {
    this.connectionId = connectionId;
    this.config = config;
    this.currentStrategy = this.getStrategyForLevel(this.currentLevel);
  }

  // Quality Management
  public getCurrentQualityLevel(): QualityLevel {
    return this.currentLevel;
  }

  public getCurrentSettings(): QualitySettings {
    return { ...this.currentStrategy.settings };
  }

  public async setQualityLevel(level: QualityLevel, reason: string = 'manual'): Promise<boolean> {
    const context = `[Degradation:${this.connectionId}]`;
    
    if (level === this.currentLevel) {
      console.log(`${context} Already at quality level: ${level}`);
      return true;
    }

    const previousLevel = this.currentLevel;
    const previousStrategy = this.currentStrategy;

    try {
      // Get strategy for new level
      const newStrategy = this.getStrategyForLevel(level);
      
      if (!newStrategy.enabled) {
        console.warn(`${context} ⚠️ Quality level ${level} is disabled`);
        return false;
      }

      console.log(`${context} 🔄 Adapting quality: ${previousLevel} → ${level} (${reason})`);

      // Apply new settings
      this.currentLevel = level;
      this.currentStrategy = newStrategy;

      // Create adaptation event
      const event: AdaptationEvent = {
        timestamp: Date.now(),
        fromLevel: previousLevel,
        toLevel: level,
        trigger: reason,
        reason: `Quality adaptation: ${reason}`,
        metrics: this.getCurrentMetrics(),
        success: true
      };

      // Notify listeners
      this.notifyQualityChangeListeners(level, newStrategy.settings);
      this.notifyAdaptationListeners(event);

      // Store in history
      this.adaptationHistory.push(event);
      this.maintainHistorySize();
      this.lastAdaptation = Date.now();

      console.log(`${context} ✅ Quality adaptation successful`);
      return true;

    } catch (error) {
      console.error(`${context} ❌ Quality adaptation failed:`, error);
      
      // Revert to previous state
      this.currentLevel = previousLevel;
      this.currentStrategy = previousStrategy;

      // Create failed adaptation event
      const failedEvent: AdaptationEvent = {
        timestamp: Date.now(),
        fromLevel: previousLevel,
        toLevel: level,
        trigger: reason,
        reason: `Quality adaptation failed: ${error}`,
        metrics: this.getCurrentMetrics(),
        success: false
      };

      this.adaptationHistory.push(failedEvent);
      this.notifyAdaptationListeners(failedEvent);

      return false;
    }
  }

  // Automatic Adaptation
  public startAdaptiveQuality(metricsMonitor: any): void {
    this.metricsMonitor = metricsMonitor;
    
    if (!this.config.adaptationEnabled) {
      const context = `[Degradation:${this.connectionId}]`;
      console.log(`${context} Adaptive quality is disabled`);
      return;
    }

    // Listen for metrics updates
    this.metricsMonitor.onMetricsUpdate((metrics: any) => {
      this.analyzeAndAdapt(metrics);
    });

    // Listen for alerts
    this.metricsMonitor.onAlert((alert: any) => {
      if (alert.level === 'critical') {
        this.handleCriticalCondition(alert);
      }
    });

    const context = `[Degradation:${this.connectionId}]`;
    console.log(`${context} ✅ Started adaptive quality management`);
  }

  private analyzeAndAdapt(metrics: any): void {
    if (!this.shouldAdapt()) {
      return;
    }

    const networkCondition = this.assessNetworkCondition(metrics);
    const recommendedLevel = this.calculateRecommendedQuality(metrics, networkCondition);

    if (recommendedLevel !== this.currentLevel) {
      const reason = this.buildAdaptationReason(metrics, networkCondition);
      this.setQualityLevel(recommendedLevel, reason);
    }
  }

  private shouldAdapt(): boolean {
    // Respect cooldown period
    const timeSinceLastAdaptation = Date.now() - this.lastAdaptation;
    const cooldown = this.currentStrategy.triggers.adaptationCooldown;
    
    if (timeSinceLastAdaptation < cooldown) {
      return false;
    }

    // Don't adapt if already at minimum level and degradation would be needed
    if (this.currentLevel === this.config.minQualityLevel) {
      return false;
    }

    return true;
  }

  private assessNetworkCondition(metrics: any): NetworkCondition {
    const { rtt, jitter } = metrics;
    const packetLossRate = metrics.packetsReceived > 0 
      ? metrics.packetsLost / (metrics.packetsReceived + metrics.packetsLost)
      : 0;

    // Assess based on multiple factors
    if (rtt < 50 && packetLossRate < 0.001 && jitter < 10) {
      return NetworkCondition.EXCELLENT;
    } else if (rtt < 150 && packetLossRate < 0.01 && jitter < 30) {
      return NetworkCondition.GOOD;
    } else if (rtt < 300 && packetLossRate < 0.03 && jitter < 50) {
      return NetworkCondition.FAIR;
    } else if (rtt < 500 && packetLossRate < 0.05 && jitter < 100) {
      return NetworkCondition.POOR;
    } else {
      return NetworkCondition.CRITICAL;
    }
  }

  private calculateRecommendedQuality(metrics: any, networkCondition: NetworkCondition): QualityLevel {
    const triggers = this.currentStrategy.triggers;
    const { rtt, jitter, audioLevel } = metrics;
    const packetLossRate = metrics.packetsReceived > 0 
      ? metrics.packetsLost / (metrics.packetsReceived + metrics.packetsLost)
      : 0;

    // Determine if degradation is needed
    let degradationNeeded = false;
    let upgradePossible = false;

    // Check degradation triggers
    if (rtt > triggers.rttThreshold ||
        packetLossRate > triggers.packetLossThreshold ||
        jitter > triggers.jitterThreshold ||
        audioLevel < triggers.audioLevelThreshold) {
      degradationNeeded = true;
    }

    // Check upgrade possibility (less aggressive)
    if (rtt < triggers.rttThreshold * 0.7 &&
        packetLossRate < triggers.packetLossThreshold * 0.5 &&
        jitter < triggers.jitterThreshold * 0.7 &&
        audioLevel > triggers.audioLevelThreshold * 1.5) {
      upgradePossible = true;
    }

    // Network condition based adaptation
    if (this.config.networkTypeAdaptation) {
      switch (networkCondition) {
        case NetworkCondition.CRITICAL:
          return this.getNextLowerLevel(this.currentLevel);
        case NetworkCondition.POOR:
          if (this.currentLevel === QualityLevel.MAXIMUM || this.currentLevel === QualityLevel.HIGH) {
            return QualityLevel.MEDIUM;
          }
          break;
        case NetworkCondition.EXCELLENT:
          if (upgradePossible && this.currentLevel !== QualityLevel.MAXIMUM) {
            return this.getNextHigherLevel(this.currentLevel);
          }
          break;
      }
    }

    // Standard adaptation logic
    if (degradationNeeded) {
      return this.getNextLowerLevel(this.currentLevel);
    } else if (upgradePossible) {
      return this.getNextHigherLevel(this.currentLevel);
    }

    return this.currentLevel;
  }

  private buildAdaptationReason(metrics: any, networkCondition: NetworkCondition): string {
    const reasons: string[] = [];
    const triggers = this.currentStrategy.triggers;
    const { rtt, jitter, audioLevel } = metrics;
    const packetLossRate = metrics.packetsReceived > 0 
      ? metrics.packetsLost / (metrics.packetsReceived + metrics.packetsLost)
      : 0;

    if (rtt > triggers.rttThreshold) {
      reasons.push(`high RTT (${rtt.toFixed(0)}ms)`);
    }
    if (packetLossRate > triggers.packetLossThreshold) {
      reasons.push(`packet loss (${(packetLossRate * 100).toFixed(1)}%)`);
    }
    if (jitter > triggers.jitterThreshold) {
      reasons.push(`high jitter (${jitter.toFixed(1)}ms)`);
    }
    if (audioLevel < triggers.audioLevelThreshold) {
      reasons.push(`low audio level (${audioLevel.toFixed(3)})`);
    }

    if (reasons.length > 0) {
      return `network degradation: ${reasons.join(', ')}`;
    } else {
      return `network improvement (${networkCondition})`;
    }
  }

  private handleCriticalCondition(alert: any): void {
    const context = `[Degradation:${this.connectionId}]`;
    console.warn(`${context} 🚨 Critical condition detected, emergency degradation`);

    // Emergency degradation to minimum quality
    if (this.config.emergencyFallback && this.currentLevel !== this.config.minQualityLevel) {
      this.setQualityLevel(this.config.minQualityLevel, 'emergency_fallback');
    }
  }

  // Quality Level Navigation
  private getNextLowerLevel(current: QualityLevel): QualityLevel {
    const levels = [QualityLevel.MAXIMUM, QualityLevel.HIGH, QualityLevel.MEDIUM, QualityLevel.LOW, QualityLevel.MINIMUM];
    const currentIndex = levels.indexOf(current);
    
    if (currentIndex < levels.length - 1) {
      const nextLevel = levels[currentIndex + 1];
      // Ensure we don't go below minimum configured level
      const minIndex = levels.indexOf(this.config.minQualityLevel);
      return currentIndex + 1 <= minIndex ? nextLevel : this.config.minQualityLevel;
    }
    
    return current;
  }

  private getNextHigherLevel(current: QualityLevel): QualityLevel {
    const levels = [QualityLevel.MAXIMUM, QualityLevel.HIGH, QualityLevel.MEDIUM, QualityLevel.LOW, QualityLevel.MINIMUM];
    const currentIndex = levels.indexOf(current);
    
    if (currentIndex > 0) {
      return levels[currentIndex - 1];
    }
    
    return current;
  }

  private getStrategyForLevel(level: QualityLevel): FallbackStrategy {
    const strategy = this.config.strategies.find(s => s.level === level);
    if (!strategy) {
      throw new Error(`No strategy found for quality level: ${level}`);
    }
    return strategy;
  }

  // Device-Specific Adaptations
  public adaptForDevice(deviceType: 'desktop' | 'mobile' | 'tablet'): void {
    const context = `[Degradation:${this.connectionId}]`;
    console.log(`${context} 📱 Adapting for device type: ${deviceType}`);

    let recommendedLevel = this.currentLevel;

    switch (deviceType) {
      case 'mobile':
        // Mobile devices typically have less processing power and unstable networks
        if (this.currentLevel === QualityLevel.MAXIMUM) {
          recommendedLevel = QualityLevel.HIGH;
        }
        // Reduce buffer sizes for mobile
        this.adjustMobileSettings();
        break;
      
      case 'tablet':
        // Tablets are between mobile and desktop
        if (this.currentLevel === QualityLevel.MAXIMUM) {
          recommendedLevel = QualityLevel.HIGH;
        }
        break;
      
      case 'desktop':
        // Desktop can typically handle maximum quality
        break;
    }

    if (recommendedLevel !== this.currentLevel) {
      this.setQualityLevel(recommendedLevel, `device_adaptation_${deviceType}`);
    }
  }

  private adjustMobileSettings(): void {
    // Mobile-specific optimizations
    if (this.currentStrategy.settings.bufferSize > 1024) {
      this.currentStrategy.settings.bufferSize = 1024;
    }
    if (this.currentStrategy.settings.heartbeatInterval < 45000) {
      this.currentStrategy.settings.heartbeatInterval = 45000; // Longer intervals to save battery
    }
  }

  public adaptForBandwidth(availableBandwidth: number): void {
    const context = `[Degradation:${this.connectionId}]`;
    console.log(`${context} 📊 Adapting for bandwidth: ${availableBandwidth} kbps`);

    let recommendedLevel = this.currentLevel;

    // Bandwidth-based adaptation thresholds
    if (availableBandwidth < 50) { // Very low bandwidth
      recommendedLevel = QualityLevel.MINIMUM;
    } else if (availableBandwidth < 100) { // Low bandwidth
      recommendedLevel = QualityLevel.LOW;
    } else if (availableBandwidth < 200) { // Medium bandwidth
      recommendedLevel = QualityLevel.MEDIUM;
    } else if (availableBandwidth < 500) { // Good bandwidth
      recommendedLevel = QualityLevel.HIGH;
    } // Above 500 kbps can handle maximum quality

    if (recommendedLevel !== this.currentLevel) {
      this.setQualityLevel(recommendedLevel, `bandwidth_adaptation_${availableBandwidth}kbps`);
    }
  }

  // Fallback Strategies
  public async executeEmergencyFallback(): Promise<boolean> {
    const context = `[Degradation:${this.connectionId}]`;
    console.warn(`${context} 🆘 Executing emergency fallback`);

    try {
      // Try progressive degradation first
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts && this.currentLevel !== this.config.minQualityLevel) {
        const nextLevel = this.getNextLowerLevel(this.currentLevel);
        const success = await this.setQualityLevel(nextLevel, `emergency_attempt_${attempts + 1}`);
        
        if (success) {
          // Wait for adaptation to take effect
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Check if condition improved
          if (this.metricsMonitor?.isHealthy()) {
            console.log(`${context} ✅ Emergency fallback successful at level: ${nextLevel}`);
            return true;
          }
        }
        
        attempts++;
      }

      // If progressive degradation fails, try minimum quality
      if (this.currentLevel !== this.config.minQualityLevel) {
        const success = await this.setQualityLevel(this.config.minQualityLevel, 'emergency_final');
        if (success) {
          console.log(`${context} ✅ Emergency fallback to minimum quality successful`);
          return true;
        }
      }

      console.error(`${context} ❌ Emergency fallback failed`);
      return false;

    } catch (error) {
      console.error(`${context} ❌ Emergency fallback error:`, error);
      return false;
    }
  }

  // Statistics and Analysis
  public getAdaptationStatistics(): {
    totalAdaptations: number;
    successRate: number;
    averageQualityLevel: number;
    timeInEachLevel: Record<QualityLevel, number>;
    mostCommonTriggers: Record<string, number>;
  } {
    const stats = {
      totalAdaptations: this.adaptationHistory.length,
      successRate: 0,
      averageQualityLevel: 0,
      timeInEachLevel: {} as Record<QualityLevel, number>,
      mostCommonTriggers: {} as Record<string, number>
    };

    if (this.adaptationHistory.length === 0) {
      return stats;
    }

    // Calculate success rate
    const successfulAdaptations = this.adaptationHistory.filter(event => event.success);
    stats.successRate = successfulAdaptations.length / this.adaptationHistory.length;

    // Count triggers
    this.adaptationHistory.forEach(event => {
      if (!stats.mostCommonTriggers[event.trigger]) {
        stats.mostCommonTriggers[event.trigger] = 0;
      }
      stats.mostCommonTriggers[event.trigger]++;
    });

    // Calculate time in each level (simplified - would need more detailed tracking)
    Object.values(QualityLevel).forEach(level => {
      stats.timeInEachLevel[level] = 0;
    });

    // Calculate average quality level (numerical representation)
    const levelValues = {
      [QualityLevel.MAXIMUM]: 5,
      [QualityLevel.HIGH]: 4,
      [QualityLevel.MEDIUM]: 3,
      [QualityLevel.LOW]: 2,
      [QualityLevel.MINIMUM]: 1
    };

    const totalLevelValue = this.adaptationHistory.reduce((sum, event) => {
      return sum + levelValues[event.toLevel];
    }, 0);

    stats.averageQualityLevel = totalLevelValue / this.adaptationHistory.length;

    return stats;
  }

  // Event Management
  public onAdaptation(callback: (event: AdaptationEvent) => void): void {
    this.adaptationListeners.push(callback);
  }

  public onQualityChange(callback: (level: QualityLevel, settings: QualitySettings) => void): void {
    this.qualityChangeListeners.push(callback);
  }

  private notifyAdaptationListeners(event: AdaptationEvent): void {
    this.adaptationListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in adaptation listener:', error);
      }
    });
  }

  private notifyQualityChangeListeners(level: QualityLevel, settings: QualitySettings): void {
    this.qualityChangeListeners.forEach(listener => {
      try {
        listener(level, settings);
      } catch (error) {
        console.error('Error in quality change listener:', error);
      }
    });
  }

  // Utility Methods
  private getCurrentMetrics(): any {
    return this.metricsMonitor?.getCurrentMetrics() || {
      rtt: 0,
      packetLoss: 0,
      jitter: 0,
      audioLevel: 0
    };
  }

  private maintainHistorySize(): void {
    if (this.adaptationHistory.length > this.config.adaptationHistory) {
      this.adaptationHistory = this.adaptationHistory.slice(-this.config.adaptationHistory);
    }
  }

  // Public API
  public forceQualityLevel(level: QualityLevel): Promise<boolean> {
    return this.setQualityLevel(level, 'manual_override');
  }

  public getAdaptationHistory(): AdaptationEvent[] {
    return [...this.adaptationHistory];
  }

  public isAdaptationEnabled(): boolean {
    return this.config.adaptationEnabled;
  }

  public setAdaptationEnabled(enabled: boolean): void {
    this.config.adaptationEnabled = enabled;
    const context = `[Degradation:${this.connectionId}]`;
    console.log(`${context} Adaptive quality ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Cleanup
  public destroy(): void {
    this.adaptationListeners = [];
    this.qualityChangeListeners = [];
    this.adaptationHistory = [];
    this.metricsMonitor = null;
  }
}

// Default Quality Strategies
export const DEFAULT_QUALITY_STRATEGIES: FallbackStrategy[] = [
  {
    level: QualityLevel.MAXIMUM,
    triggers: {
      rttThreshold: 100,
      packetLossThreshold: 0.005,
      jitterThreshold: 20,
      audioLevelThreshold: 0.1,
      connectionFailureThreshold: 1,
      adaptationCooldown: 10000
    },
    settings: {
      audioCodec: 'opus',
      audioBitrate: 128000,
      audioSampleRate: 48000,
      audioChannels: 2,
      bufferSize: 4096,
      iceTimeout: 30000,
      reconnectDelay: 1000,
      heartbeatInterval: 30000
    },
    enabled: true,
    description: 'Maximum quality for excellent network conditions'
  },
  {
    level: QualityLevel.HIGH,
    triggers: {
      rttThreshold: 200,
      packetLossThreshold: 0.01,
      jitterThreshold: 40,
      audioLevelThreshold: 0.05,
      connectionFailureThreshold: 2,
      adaptationCooldown: 8000
    },
    settings: {
      audioCodec: 'opus',
      audioBitrate: 96000,
      audioSampleRate: 48000,
      audioChannels: 1,
      bufferSize: 2048,
      iceTimeout: 25000,
      reconnectDelay: 1500,
      heartbeatInterval: 35000
    },
    enabled: true,
    description: 'High quality for good network conditions'
  },
  {
    level: QualityLevel.MEDIUM,
    triggers: {
      rttThreshold: 350,
      packetLossThreshold: 0.02,
      jitterThreshold: 60,
      audioLevelThreshold: 0.03,
      connectionFailureThreshold: 3,
      adaptationCooldown: 6000
    },
    settings: {
      audioCodec: 'opus',
      audioBitrate: 64000,
      audioSampleRate: 24000,
      audioChannels: 1,
      bufferSize: 1024,
      iceTimeout: 20000,
      reconnectDelay: 2000,
      heartbeatInterval: 40000
    },
    enabled: true,
    description: 'Medium quality for fair network conditions'
  },
  {
    level: QualityLevel.LOW,
    triggers: {
      rttThreshold: 500,
      packetLossThreshold: 0.04,
      jitterThreshold: 80,
      audioLevelThreshold: 0.02,
      connectionFailureThreshold: 4,
      adaptationCooldown: 5000
    },
    settings: {
      audioCodec: 'opus',
      audioBitrate: 32000,
      audioSampleRate: 16000,
      audioChannels: 1,
      bufferSize: 512,
      iceTimeout: 15000,
      reconnectDelay: 3000,
      heartbeatInterval: 45000
    },
    enabled: true,
    description: 'Low quality for poor network conditions'
  },
  {
    level: QualityLevel.MINIMUM,
    triggers: {
      rttThreshold: 1000,
      packetLossThreshold: 0.1,
      jitterThreshold: 150,
      audioLevelThreshold: 0.01,
      connectionFailureThreshold: 5,
      adaptationCooldown: 3000
    },
    settings: {
      audioCodec: 'opus',
      audioBitrate: 16000,
      audioSampleRate: 8000,
      audioChannels: 1,
      bufferSize: 256,
      iceTimeout: 10000,
      reconnectDelay: 5000,
      heartbeatInterval: 60000
    },
    enabled: true,
    description: 'Minimum quality for critical network conditions'
  }
];

// Default Configuration
export const DEFAULT_DEGRADATION_CONFIG: DegradationConfig = {
  strategies: DEFAULT_QUALITY_STRATEGIES,
  adaptationEnabled: true,
  aggressiveMode: false,
  minQualityLevel: QualityLevel.LOW,
  adaptationHistory: 50,
  emergencyFallback: true,
  networkTypeAdaptation: true
};

// Factory function
export function createGracefulDegradationManager(
  connectionId: string,
  config?: Partial<DegradationConfig>
): GracefulDegradationManager {
  const finalConfig = { ...DEFAULT_DEGRADATION_CONFIG, ...config };
  return new GracefulDegradationManager(connectionId, finalConfig);
}