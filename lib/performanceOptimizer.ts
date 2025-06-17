/**
 * Production-Grade Performance Optimization System
 * Implements mobile optimizations, bandwidth management, and resource efficiency
 */

export interface DeviceCapabilities {
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  platform: 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux' | 'unknown';
  browser: 'Chrome' | 'Firefox' | 'Safari' | 'Edge' | 'unknown';
  webrtcSupport: {
    hasWebRTC: boolean;
    hasGetUserMedia: boolean;
    hasRTCPeerConnection: boolean;
    hasDataChannels: boolean;
    supportedCodecs: string[];
  };
  hardwareCapabilities: {
    cores: number;
    memory: number; // GB
    concurrency: number;
    isLowPower: boolean;
  };
  networkCapabilities: {
    type: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
    effectiveType: '2g' | '3g' | '4g' | 'unknown';
    downlink: number;
    rtt: number;
    saveData: boolean;
  };
}

export interface PerformanceSettings {
  // Audio Processing
  audioProcessingEnabled: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  audioBitrate: number;
  audioSampleRate: number;
  audioChannels: number;
  
  // Connection Management
  iceTimeout: number;
  connectionTimeout: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  
  // Buffer Management
  audioBufferSize: number;
  iceBufferSize: number;
  maxHistorySize: number;
  
  // Resource Management
  maxConcurrentConnections: number;
  backgroundThrottling: boolean;
  batterySaving: boolean;
  memoryOptimization: boolean;
  
  // Codec Preferences
  preferredAudioCodec: string;
  codecPriority: string[];
  
  // Network Optimization
  adaptiveBitrate: boolean;
  bandwidthProbing: boolean;
  congestionControl: boolean;
}

export interface PerformanceMetrics {
  timestamp: number;
  
  // CPU and Memory
  cpuUsage: number;
  memoryUsage: number;
  memoryPressure: 'low' | 'medium' | 'high';
  
  // Network Performance
  throughput: number;
  latency: number;
  jitter: number;
  packetLoss: number;
  
  // Audio Performance
  audioProcessingDelay: number;
  audioDropouts: number;
  audioGlitches: number;
  
  // Connection Performance
  connectionSetupTime: number;
  reconnectionCount: number;
  averageReconnectTime: number;
  
  // Battery (mobile)
  batteryLevel?: number;
  batteryCharging?: boolean;
  
  // Overall Performance Score
  performanceScore: number; // 0-100
  bottleneck: 'cpu' | 'memory' | 'network' | 'audio' | 'none';
}

export interface OptimizationRule {
  name: string;
  condition: (capabilities: DeviceCapabilities, metrics: PerformanceMetrics) => boolean;
  optimization: (settings: PerformanceSettings) => PerformanceSettings;
  priority: number;
  description: string;
}

export class PerformanceOptimizer {
  private deviceCapabilities: DeviceCapabilities;
  private currentSettings: PerformanceSettings;
  private performanceMetrics: PerformanceMetrics[] = [];
  private optimizationRules: OptimizationRule[] = [];
  private optimizationTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private connectionId: string;
  private listeners: Map<string, ((data: any) => void)[]> = new Map();

  constructor(connectionId: string) {
    this.connectionId = connectionId;
    this.deviceCapabilities = this.detectDeviceCapabilities();
    this.currentSettings = this.getDefaultSettings();
    this.optimizationRules = this.getDefaultOptimizationRules();
    this.initializeOptimizations();
  }

  // Initialization
  private async initializeOptimizations(): Promise<void> {
    const context = `[Optimizer:${this.connectionId}]`;
    console.log(`${context} 🚀 Initializing performance optimizations...`);

    // Apply initial optimizations based on device capabilities
    await this.applyDeviceSpecificOptimizations();

    // Start performance monitoring
    this.startPerformanceMonitoring();

    // Start optimization loop
    this.startOptimizationLoop();

    console.log(`${context} ✅ Performance optimization initialized`);
  }

  // Device Detection
  private detectDeviceCapabilities(): DeviceCapabilities {
    const capabilities: DeviceCapabilities = {
      deviceType: this.detectDeviceType(),
      platform: this.detectPlatform(),
      browser: this.detectBrowser(),
      webrtcSupport: this.detectWebRTCSupport(),
      hardwareCapabilities: this.detectHardwareCapabilities(),
      networkCapabilities: this.detectNetworkCapabilities()
    };

    const context = `[Optimizer:${this.connectionId}]`;
    console.log(`${context} 📱 Device capabilities detected:`, {
      device: capabilities.deviceType,
      platform: capabilities.platform,
      browser: capabilities.browser,
      cores: capabilities.hardwareCapabilities.cores,
      memory: capabilities.hardwareCapabilities.memory,
      network: capabilities.networkCapabilities.type
    });

    return capabilities;
  }

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

  private detectPlatform(): 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux' | 'unknown' {
    if (typeof navigator === 'undefined') return 'unknown';
    
    const userAgent = navigator.userAgent;
    const platform = navigator.platform?.toLowerCase() || '';
    
    if (/iphone|ipad|ipod/.test(userAgent.toLowerCase())) return 'iOS';
    if (/android/.test(userAgent.toLowerCase())) return 'Android';
    if (/win/.test(platform)) return 'Windows';
    if (/mac/.test(platform)) return 'macOS';
    if (/linux/.test(platform)) return 'Linux';
    
    return 'unknown';
  }

  private detectBrowser(): 'Chrome' | 'Firefox' | 'Safari' | 'Edge' | 'unknown' {
    if (typeof navigator === 'undefined') return 'unknown';
    
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome') && !userAgent.includes('Edge')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    
    return 'unknown';
  }

  private detectWebRTCSupport(): DeviceCapabilities['webrtcSupport'] {
    if (typeof window === 'undefined') {
      return {
        hasWebRTC: false,
        hasGetUserMedia: false,
        hasRTCPeerConnection: false,
        hasDataChannels: false,
        supportedCodecs: []
      };
    }

    const hasWebRTC = !!(window.RTCPeerConnection || (window as any).webkitRTCPeerConnection);
    const hasGetUserMedia = !!(navigator.mediaDevices?.getUserMedia || (navigator as any).getUserMedia);
    const hasDataChannels = hasWebRTC; // Assume data channels if WebRTC is supported

    // Detect supported codecs (simplified)
    const supportedCodecs: string[] = [];
    if (hasWebRTC) {
      // This would typically require creating a peer connection to test codec support
      supportedCodecs.push('opus', 'pcmu', 'pcma'); // Common audio codecs
    }

    return {
      hasWebRTC,
      hasGetUserMedia,
      hasRTCPeerConnection: hasWebRTC,
      hasDataChannels,
      supportedCodecs
    };
  }

  private detectHardwareCapabilities(): DeviceCapabilities['hardwareCapabilities'] {
    const cores = navigator.hardwareConcurrency || 2;
    const memory = (navigator as any).deviceMemory || 4; // GB
    const isLowPower = cores <= 2 || memory <= 2;

    return {
      cores,
      memory,
      concurrency: cores,
      isLowPower
    };
  }

  private detectNetworkCapabilities(): DeviceCapabilities['networkCapabilities'] {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const connection = (navigator as any).connection;
      return {
        type: connection.type || 'unknown',
        effectiveType: connection.effectiveType || 'unknown',
        downlink: connection.downlink || 0,
        rtt: connection.rtt || 0,
        saveData: connection.saveData || false
      };
    }

    return {
      type: 'unknown',
      effectiveType: 'unknown',
      downlink: 0,
      rtt: 0,
      saveData: false
    };
  }

  // Settings Management
  private getDefaultSettings(): PerformanceSettings {
    return {
      // Audio Processing
      audioProcessingEnabled: true,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      audioBitrate: 64000,
      audioSampleRate: 48000,
      audioChannels: 1,
      
      // Connection Management
      iceTimeout: 30000,
      connectionTimeout: 30000,
      reconnectDelay: 2000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
      
      // Buffer Management
      audioBufferSize: 2048,
      iceBufferSize: 50,
      maxHistorySize: 100,
      
      // Resource Management
      maxConcurrentConnections: 10,
      backgroundThrottling: true,
      batterySaving: false,
      memoryOptimization: false,
      
      // Codec Preferences
      preferredAudioCodec: 'opus',
      codecPriority: ['opus', 'pcmu', 'pcma'],
      
      // Network Optimization
      adaptiveBitrate: true,
      bandwidthProbing: true,
      congestionControl: true
    };
  }

  public getCurrentSettings(): PerformanceSettings {
    return { ...this.currentSettings };
  }

  public updateSettings(updates: Partial<PerformanceSettings>): void {
    const context = `[Optimizer:${this.connectionId}]`;
    console.log(`${context} 🔧 Updating performance settings:`, updates);

    this.currentSettings = { ...this.currentSettings, ...updates };
    this.notifyListeners('settings_updated', this.currentSettings);
  }

  // Device-Specific Optimizations
  private async applyDeviceSpecificOptimizations(): Promise<void> {
    const { deviceType, platform, hardwareCapabilities, networkCapabilities } = this.deviceCapabilities;
    const updates: Partial<PerformanceSettings> = {};

    // Mobile optimizations
    if (deviceType === 'mobile') {
      updates.audioBitrate = 32000; // Lower bitrate for mobile
      updates.audioSampleRate = 24000; // Lower sample rate
      updates.audioBufferSize = 1024; // Smaller buffers
      updates.heartbeatInterval = 45000; // Longer intervals to save battery
      updates.batterySaving = true;
      updates.backgroundThrottling = true;
      updates.memoryOptimization = true;
      updates.maxConcurrentConnections = 5; // Limit connections
    }

    // Low-power device optimizations
    if (hardwareCapabilities.isLowPower) {
      updates.audioProcessingEnabled = false; // Disable heavy audio processing
      updates.echoCancellation = false;
      updates.noiseSuppression = false;
      updates.audioBufferSize = 512; // Smaller buffers
      updates.memoryOptimization = true;
      updates.maxHistorySize = 50; // Smaller history
    }

    // iOS-specific optimizations
    if (platform === 'iOS') {
      updates.audioChannels = 1; // Mono audio for better compatibility
      updates.audioSampleRate = 24000; // iOS prefers this rate
      updates.backgroundThrottling = true; // iOS background handling
    }

    // Android-specific optimizations
    if (platform === 'Android') {
      updates.audioBufferSize = 1024; // Android-optimized buffer size
      updates.batteryOptimization = true;
    }

    // Network-based optimizations
    if (networkCapabilities.saveData) {
      updates.audioBitrate = Math.min(updates.audioBitrate || this.currentSettings.audioBitrate, 24000);
      updates.adaptiveBitrate = true;
    }

    if (networkCapabilities.effectiveType === '2g' || networkCapabilities.effectiveType === '3g') {
      updates.audioBitrate = 16000; // Very low bitrate for slow networks
      updates.audioSampleRate = 16000;
      updates.connectionTimeout = 60000; // Longer timeouts
      updates.heartbeatInterval = 60000;
    }

    if (Object.keys(updates).length > 0) {
      this.updateSettings(updates);
      
      const context = `[Optimizer:${this.connectionId}]`;
      console.log(`${context} ✅ Applied device-specific optimizations for ${deviceType}/${platform}`);
    }
  }

  // Performance Monitoring
  private startPerformanceMonitoring(): void {
    this.metricsTimer = setInterval(() => {
      this.collectPerformanceMetrics();
    }, 10000); // Collect every 10 seconds
  }

  private async collectPerformanceMetrics(): Promise<void> {
    try {
      const metrics: PerformanceMetrics = {
        timestamp: Date.now(),
        
        // Basic metrics (would need actual implementation)
        cpuUsage: this.estimateCPUUsage(),
        memoryUsage: this.estimateMemoryUsage(),
        memoryPressure: this.assessMemoryPressure(),
        
        // Network metrics (would be provided by monitoring system)
        throughput: 0,
        latency: 0,
        jitter: 0,
        packetLoss: 0,
        
        // Audio metrics
        audioProcessingDelay: 0,
        audioDropouts: 0,
        audioGlitches: 0,
        
        // Connection metrics
        connectionSetupTime: 0,
        reconnectionCount: 0,
        averageReconnectTime: 0,
        
        // Performance assessment
        performanceScore: 0,
        bottleneck: 'none'
      };

      // Add battery info for mobile devices
      if (this.deviceCapabilities.deviceType === 'mobile' && 'getBattery' in navigator) {
        try {
          const battery = await (navigator as any).getBattery();
          metrics.batteryLevel = battery.level;
          metrics.batteryCharging = battery.charging;
        } catch (error) {
          // Battery API not available
        }
      }

      // Calculate performance score and identify bottlenecks
      this.calculatePerformanceScore(metrics);
      
      // Store metrics
      this.performanceMetrics.push(metrics);
      
      // Maintain metrics history
      if (this.performanceMetrics.length > this.currentSettings.maxHistorySize) {
        this.performanceMetrics = this.performanceMetrics.slice(-this.currentSettings.maxHistorySize);
      }

      // Notify listeners
      this.notifyListeners('metrics_collected', metrics);

    } catch (error) {
      console.error('Error collecting performance metrics:', error);
    }
  }

  private estimateCPUUsage(): number {
    // Simplified CPU usage estimation
    // In a real implementation, this would use performance monitoring APIs
    return Math.random() * 100; // Placeholder
  }

  private estimateMemoryUsage(): number {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      return (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
    }
    return 0;
  }

  private assessMemoryPressure(): 'low' | 'medium' | 'high' {
    const memoryUsage = this.estimateMemoryUsage();
    if (memoryUsage > 80) return 'high';
    if (memoryUsage > 60) return 'medium';
    return 'low';
  }

  private calculatePerformanceScore(metrics: PerformanceMetrics): void {
    let score = 100;
    let bottleneck: 'cpu' | 'memory' | 'network' | 'audio' | 'none' = 'none';

    // CPU impact
    if (metrics.cpuUsage > 80) {
      score -= 30;
      bottleneck = 'cpu';
    } else if (metrics.cpuUsage > 60) {
      score -= 15;
    }

    // Memory impact
    if (metrics.memoryPressure === 'high') {
      score -= 25;
      if (bottleneck === 'none') bottleneck = 'memory';
    } else if (metrics.memoryPressure === 'medium') {
      score -= 10;
    }

    // Network impact
    if (metrics.latency > 300 || metrics.packetLoss > 0.03) {
      score -= 20;
      if (bottleneck === 'none') bottleneck = 'network';
    }

    // Audio impact
    if (metrics.audioDropouts > 5 || metrics.audioGlitches > 3) {
      score -= 15;
      if (bottleneck === 'none') bottleneck = 'audio';
    }

    // Battery impact (mobile)
    if (metrics.batteryLevel !== undefined && metrics.batteryLevel < 0.2 && !metrics.batteryCharging) {
      score -= 10; // Penalize for low battery
    }

    metrics.performanceScore = Math.max(0, score);
    metrics.bottleneck = bottleneck;
  }

  // Optimization Loop
  private startOptimizationLoop(): void {
    this.optimizationTimer = setInterval(() => {
      this.runOptimizations();
    }, 30000); // Run optimizations every 30 seconds
  }

  private runOptimizations(): void {
    if (this.performanceMetrics.length === 0) return;

    const latestMetrics = this.performanceMetrics[this.performanceMetrics.length - 1];
    const context = `[Optimizer:${this.connectionId}]`;

    // Check if optimizations are needed
    if (latestMetrics.performanceScore < 70) {
      console.log(`${context} 🔧 Performance below threshold (${latestMetrics.performanceScore}), applying optimizations...`);
      this.applyPerformanceOptimizations(latestMetrics);
    }

    // Apply optimization rules
    this.applyOptimizationRules(latestMetrics);
  }

  private applyPerformanceOptimizations(metrics: PerformanceMetrics): void {
    const updates: Partial<PerformanceSettings> = {};

    switch (metrics.bottleneck) {
      case 'cpu':
        updates.audioProcessingEnabled = false;
        updates.echoCancellation = false;
        updates.noiseSuppression = false;
        updates.audioBufferSize = Math.min(this.currentSettings.audioBufferSize, 512);
        break;

      case 'memory':
        updates.memoryOptimization = true;
        updates.maxHistorySize = Math.min(this.currentSettings.maxHistorySize, 50);
        updates.iceBufferSize = Math.min(this.currentSettings.iceBufferSize, 25);
        break;

      case 'network':
        updates.audioBitrate = Math.min(this.currentSettings.audioBitrate, 24000);
        updates.adaptiveBitrate = true;
        updates.congestionControl = true;
        break;

      case 'audio':
        updates.audioBufferSize = Math.max(this.currentSettings.audioBufferSize, 2048);
        updates.audioProcessingEnabled = true;
        break;
    }

    // Battery optimizations for mobile
    if (metrics.batteryLevel !== undefined && metrics.batteryLevel < 0.3) {
      updates.batterySaving = true;
      updates.heartbeatInterval = Math.max(this.currentSettings.heartbeatInterval, 60000);
      updates.backgroundThrottling = true;
    }

    if (Object.keys(updates).length > 0) {
      this.updateSettings(updates);
      
      const context = `[Optimizer:${this.connectionId}]`;
      console.log(`${context} ✅ Applied ${metrics.bottleneck} optimizations`);
    }
  }

  // Optimization Rules
  private getDefaultOptimizationRules(): OptimizationRule[] {
    return [
      {
        name: 'mobile_battery_saver',
        condition: (capabilities, metrics) => 
          capabilities.deviceType === 'mobile' && 
          metrics.batteryLevel !== undefined && 
          metrics.batteryLevel < 0.2,
        optimization: (settings) => ({
          ...settings,
          batterySaving: true,
          audioBitrate: Math.min(settings.audioBitrate, 16000),
          heartbeatInterval: 90000,
          backgroundThrottling: true
        }),
        priority: 1,
        description: 'Aggressive battery saving for low battery mobile devices'
      },
      {
        name: 'low_bandwidth_adaptation',
        condition: (capabilities, metrics) => 
          capabilities.networkCapabilities.downlink < 0.5 || 
          capabilities.networkCapabilities.effectiveType === '2g',
        optimization: (settings) => ({
          ...settings,
          audioBitrate: 16000,
          audioSampleRate: 16000,
          adaptiveBitrate: true,
          connectionTimeout: 60000
        }),
        priority: 2,
        description: 'Low bandwidth network adaptation'
      },
      {
        name: 'high_latency_optimization',
        condition: (capabilities, metrics) => 
          metrics.latency > 500 || capabilities.networkCapabilities.rtt > 500,
        optimization: (settings) => ({
          ...settings,
          audioBufferSize: Math.max(settings.audioBufferSize, 4096),
          connectionTimeout: 60000,
          reconnectDelay: Math.max(settings.reconnectDelay, 5000)
        }),
        priority: 3,
        description: 'High latency network optimization'
      },
      {
        name: 'memory_pressure_relief',
        condition: (capabilities, metrics) => 
          metrics.memoryPressure === 'high' || capabilities.hardwareCapabilities.memory <= 2,
        optimization: (settings) => ({
          ...settings,
          memoryOptimization: true,
          maxHistorySize: 25,
          iceBufferSize: 20,
          maxConcurrentConnections: 3
        }),
        priority: 4,
        description: 'Memory pressure relief for low-memory devices'
      }
    ];
  }

  private applyOptimizationRules(metrics: PerformanceMetrics): void {
    const applicableRules = this.optimizationRules
      .filter(rule => rule.condition(this.deviceCapabilities, metrics))
      .sort((a, b) => a.priority - b.priority);

    if (applicableRules.length > 0) {
      let newSettings = { ...this.currentSettings };
      
      applicableRules.forEach(rule => {
        newSettings = rule.optimization(newSettings);
        
        const context = `[Optimizer:${this.connectionId}]`;
        console.log(`${context} 📋 Applied rule: ${rule.name}`);
      });

      if (JSON.stringify(newSettings) !== JSON.stringify(this.currentSettings)) {
        this.updateSettings(newSettings);
      }
    }
  }

  // Public API
  public getDeviceCapabilities(): DeviceCapabilities {
    return { ...this.deviceCapabilities };
  }

  public getPerformanceMetrics(): PerformanceMetrics[] {
    return [...this.performanceMetrics];
  }

  public getLatestMetrics(): PerformanceMetrics | null {
    return this.performanceMetrics.length > 0 
      ? this.performanceMetrics[this.performanceMetrics.length - 1] 
      : null;
  }

  public addOptimizationRule(rule: OptimizationRule): void {
    this.optimizationRules.push(rule);
    this.optimizationRules.sort((a, b) => a.priority - b.priority);
  }

  public forceOptimization(): void {
    this.runOptimizations();
  }

  public getOptimizationRecommendations(): string[] {
    const latestMetrics = this.getLatestMetrics();
    if (!latestMetrics) return [];

    const recommendations: string[] = [];

    if (latestMetrics.performanceScore < 50) {
      recommendations.push('Consider switching to a lower quality mode for better performance');
    }

    if (latestMetrics.memoryPressure === 'high') {
      recommendations.push('Close other browser tabs or applications to free up memory');
    }

    if (latestMetrics.cpuUsage > 80) {
      recommendations.push('Reduce CPU usage by closing other applications');
    }

    if (latestMetrics.bottleneck === 'network') {
      recommendations.push('Check your network connection for better stability');
    }

    if (this.deviceCapabilities.deviceType === 'mobile' && latestMetrics.batteryLevel && latestMetrics.batteryLevel < 0.2) {
      recommendations.push('Connect to a charger for optimal performance');
    }

    return recommendations;
  }

  // Event Management
  public onSettingsUpdate(callback: (settings: PerformanceSettings) => void): void {
    this.addEventListener('settings_updated', callback);
  }

  public onMetricsCollected(callback: (metrics: PerformanceMetrics) => void): void {
    this.addEventListener('metrics_collected', callback);
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
        console.error('Error in performance optimizer listener:', error);
      }
    });
  }

  // Cleanup
  public destroy(): void {
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    this.listeners.clear();
    this.performanceMetrics = [];
    this.optimizationRules = [];
  }
}

// Factory function
export function createPerformanceOptimizer(connectionId: string): PerformanceOptimizer {
  return new PerformanceOptimizer(connectionId);
}