/**
 * Production-Grade WebRTC Manager
 * Unified system that integrates all production-ready components
 */

import { 
  WebRTCConnectionManager, 
  ConnectionState, 
  ConnectionRole, 
  createConnectionManager 
} from './webrtcConnectionManager';

import { 
  SignalingCoordinator, 
  createSignalingCoordinator 
} from './signalingCoordinator';

import { 
  ConnectionRecoveryManager, 
  FailureType, 
  createConnectionRecoveryManager 
} from './connectionRecovery';

import { 
  ConnectionMonitoringSystem, 
  createConnectionMonitoringSystem 
} from './connectionMonitoringSystem';

import { 
  GracefulDegradationManager, 
  QualityLevel, 
  createGracefulDegradationManager 
} from './gracefulDegradation';

import { 
  PerformanceOptimizer, 
  createPerformanceOptimizer 
} from './performanceOptimizer';

export interface ProductionWebRTCConfig {
  // Connection Identity
  tourId: string;
  language: string;
  role: 'guide' | 'attendee';
  participantId: string;
  
  // Feature Flags
  enableSignalingCoordination: boolean;
  enableConnectionRecovery: boolean;
  enableQualityMonitoring: boolean;
  enableGracefulDegradation: boolean;
  enablePerformanceOptimization: boolean;
  
  // Quality Settings
  initialQualityLevel: QualityLevel;
  autoQualityAdaptation: boolean;
  
  // Recovery Settings
  enableAutoRecovery: boolean;
  maxRecoveryAttempts: number;
  
  // Monitoring Settings
  enableDetailedMetrics: boolean;
  metricsRetentionTime: number;
  
  // Callbacks
  onConnectionStateChange?: (state: ConnectionState) => void;
  onQualityChange?: (level: QualityLevel) => void;
  onRecoveryAttempt?: (attempt: any) => void;
  onError?: (error: Error) => void;
  onMetricsUpdate?: (metrics: any) => void;
}

export interface ProductionWebRTCStatus {
  connectionState: ConnectionState;
  qualityLevel: QualityLevel;
  isHealthy: boolean;
  performanceScore: number;
  connectionDuration: number;
  recoveryAttempts: number;
  lastError?: Error;
  recommendations: string[];
}

export class ProductionWebRTCManager {
  private config: ProductionWebRTCConfig;
  private connectionManager: WebRTCConnectionManager | null = null;
  private signalingCoordinator: SignalingCoordinator | null = null;
  private recoveryManager: ConnectionRecoveryManager | null = null;
  private monitoringSystem: ConnectionMonitoringSystem | null = null;
  private degradationManager: GracefulDegradationManager | null = null;
  private performanceOptimizer: PerformanceOptimizer | null = null;
  
  private isInitialized: boolean = false;
  private isDestroyed: boolean = false;
  private connectionId: string;

  constructor(config: ProductionWebRTCConfig) {
    this.config = config;
    this.connectionId = `${config.role}_${config.participantId}_${Date.now()}`;
    
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🚀 Initializing Production WebRTC Manager`);
  }

  // Initialization
  public async initialize(): Promise<void> {
    if (this.isInitialized || this.isDestroyed) {
      throw new Error('Manager is already initialized or destroyed');
    }

    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 📋 Starting production WebRTC initialization...`);

    try {
      // Initialize core components in correct order
      await this.initializeComponents();
      
      // Set up component integrations
      this.setupComponentIntegrations();
      
      // Mark as initialized
      this.isInitialized = true;
      
      console.log(`${context} ✅ Production WebRTC Manager initialized successfully`);
    } catch (error) {
      console.error(`${context} ❌ Failed to initialize Production WebRTC Manager:`, error);
      await this.cleanup();
      throw error;
    }
  }

  private async initializeComponents(): Promise<void> {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    
    // 1. Initialize Connection Manager (Core)
    console.log(`${context} 🔧 Initializing Connection Manager...`);
    this.connectionManager = createConnectionManager({
      role: this.config.role === 'guide' ? ConnectionRole.GUIDE : ConnectionRole.ATTENDEE,
      language: this.config.language,
      tourId: this.config.tourId,
      peerId: this.config.participantId
    });

    // 2. Initialize Signaling Coordinator
    if (this.config.enableSignalingCoordination) {
      console.log(`${context} 📡 Initializing Signaling Coordinator...`);
      this.signalingCoordinator = createSignalingCoordinator(
        this.config.tourId,
        this.config.language,
        this.config.role,
        this.config.participantId
      );
      await this.signalingCoordinator.initializeCoordination();
    }

    // 3. Initialize Monitoring System
    if (this.config.enableQualityMonitoring) {
      console.log(`${context} 📊 Initializing Monitoring System...`);
      this.monitoringSystem = createConnectionMonitoringSystem(this.connectionId, {
        enableDetailedLogging: this.config.enableDetailedMetrics,
        historyRetention: Math.floor(this.config.metricsRetentionTime / 5000) // Convert to measurements
      });
    }

    // 4. Initialize Recovery Manager
    if (this.config.enableConnectionRecovery) {
      console.log(`${context} 🔄 Initializing Recovery Manager...`);
      this.recoveryManager = createConnectionRecoveryManager({
        maxConcurrentRecoveries: 1,
        strategies: [] // Use defaults
      });
    }

    // 5. Initialize Graceful Degradation
    if (this.config.enableGracefulDegradation) {
      console.log(`${context} ⚖️ Initializing Graceful Degradation...`);
      this.degradationManager = createGracefulDegradationManager(this.connectionId, {
        adaptationEnabled: this.config.autoQualityAdaptation
      });
      
      // Set initial quality level
      await this.degradationManager.setQualityLevel(this.config.initialQualityLevel, 'initial_setup');
    }

    // 6. Initialize Performance Optimizer
    if (this.config.enablePerformanceOptimization) {
      console.log(`${context} ⚡ Initializing Performance Optimizer...`);
      this.performanceOptimizer = createPerformanceOptimizer(this.connectionId);
    }
  }

  private setupComponentIntegrations(): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🔗 Setting up component integrations...`);

    // Connection Manager Events
    if (this.connectionManager) {
      this.connectionManager.onStateChange(ConnectionState.CONNECTED, () => {
        this.handleConnectionEstablished();
      });

      this.connectionManager.onStateChange(ConnectionState.FAILED, () => {
        this.handleConnectionFailed();
      });

      this.connectionManager.onStateChange(ConnectionState.RECONNECTING, () => {
        this.handleReconnecting();
      });
    }

    // Monitoring System Integration
    if (this.monitoringSystem) {
      this.monitoringSystem.onAlert((alert) => {
        this.handleMonitoringAlert(alert);
      });

      this.monitoringSystem.onError((error) => {
        this.handleMonitoringError(error);
      });

      this.monitoringSystem.onMetricsUpdate((metrics) => {
        this.config.onMetricsUpdate?.(metrics);
      });
    }

    // Degradation Manager Integration
    if (this.degradationManager && this.monitoringSystem) {
      this.degradationManager.startAdaptiveQuality(this.monitoringSystem);
      
      this.degradationManager.onQualityChange((level, settings) => {
        this.handleQualityChange(level, settings);
      });

      this.degradationManager.onAdaptation((event) => {
        console.log(`${context} 📈 Quality adaptation: ${event.fromLevel} → ${event.toLevel} (${event.reason})`);
      });
    }

    // Performance Optimizer Integration
    if (this.performanceOptimizer) {
      this.performanceOptimizer.onSettingsUpdate((settings) => {
        this.handlePerformanceSettingsUpdate(settings);
      });
    }

    // Recovery Manager Integration
    if (this.recoveryManager) {
      this.recoveryManager.onRecoveryEvent('session_complete', (session) => {
        this.config.onRecoveryAttempt?.(session);
        console.log(`${context} 🔄 Recovery session completed: ${session.finalOutcome}`);
      });
    }
  }

  // Connection Management
  public async createPeerConnection(iceServers?: RTCIceServer[]): Promise<RTCPeerConnection> {
    this.ensureInitialized();
    
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🔌 Creating peer connection...`);

    // Get optimized settings from performance optimizer
    let rtcConfig: RTCConfiguration = {
      iceServers: iceServers || [
        { urls: 'stun:stun.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    // Apply performance optimizations to RTC configuration
    if (this.performanceOptimizer) {
      const deviceCapabilities = this.performanceOptimizer.getDeviceCapabilities();
      if (deviceCapabilities.deviceType === 'mobile') {
        rtcConfig.iceCandidatePoolSize = 6; // Reduce for mobile
      }
    }

    const pc = new RTCPeerConnection(rtcConfig);

    // Set up peer connection with all managers
    this.connectionManager!.setPeerConnection(pc);
    
    if (this.monitoringSystem) {
      this.monitoringSystem.startMonitoring(pc);
    }

    // Set up ICE candidate handling with buffering
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        // Buffer ICE candidates until ready for exchange
        this.connectionManager!.bufferICECandidate(event.candidate, 1);
        
        // Send via signaling coordinator if available
        if (this.signalingCoordinator && this.connectionManager!.isReadyForICEExchange()) {
          await this.signalingCoordinator.bufferICECandidate(
            event.candidate,
            this.getTargetParticipantId(),
            this.connectionManager!.getBufferedCandidateCount()
          );
        }
      } else {
        // ICE gathering complete
        this.connectionManager!.setICEGatheringComplete();
        
        if (this.signalingCoordinator) {
          await this.signalingCoordinator.signalICEGatheringComplete();
        }
      }
    };

    console.log(`${context} ✅ Peer connection created with production optimizations`);
    return pc;
  }

  public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.ensureInitialized();
    
    const pc = this.connectionManager!.getPeerConnection();
    if (!pc) {
      throw new Error('Peer connection not available');
    }

    await pc.setLocalDescription(description);
    this.connectionManager!.setLocalDescriptionComplete();
    
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 📝 Local description set: ${description.type}`);
  }

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.ensureInitialized();
    
    const pc = this.connectionManager!.getPeerConnection();
    if (!pc) {
      throw new Error('Peer connection not available');
    }

    await pc.setRemoteDescription(description);
    this.connectionManager!.setRemoteDescriptionComplete();
    
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 📝 Remote description set: ${description.type}`);
  }

  // Event Handlers
  private handleConnectionEstablished(): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🎉 Connection established successfully`);
    
    this.config.onConnectionStateChange?.(ConnectionState.CONNECTED);
    
    // Signal readiness to coordinator
    if (this.signalingCoordinator) {
      this.signalingCoordinator.signalReady();
    }
  }

  private handleConnectionFailed(): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.error(`${context} ❌ Connection failed`);
    
    this.config.onConnectionStateChange?.(ConnectionState.FAILED);
    
    // Attempt recovery if enabled
    if (this.config.enableAutoRecovery && this.recoveryManager) {
      this.attemptConnectionRecovery(FailureType.PEER_CONNECTION_FAILED);
    }
  }

  private handleReconnecting(): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🔄 Connection is reconnecting...`);
    
    this.config.onConnectionStateChange?.(ConnectionState.RECONNECTING);
  }

  private handleMonitoringAlert(alert: any): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.warn(`${context} ⚠️ Monitoring alert: ${alert.message}`);
    
    // Trigger quality degradation for critical alerts
    if (alert.level === 'critical' && this.degradationManager) {
      this.degradationManager.executeEmergencyFallback();
    }
  }

  private handleMonitoringError(error: any): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.error(`${context} 📊 Monitoring error:`, error);
    
    this.config.onError?.(new Error(`Monitoring error: ${error.message}`));
  }

  private handleQualityChange(level: QualityLevel, settings: any): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 📈 Quality changed to: ${level}`);
    
    this.config.onQualityChange?.(level);
    
    // Apply settings to peer connection if needed
    // This would involve renegotiation in a real implementation
  }

  private handlePerformanceSettingsUpdate(settings: any): void {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} ⚡ Performance settings updated`);
    
    // Apply performance settings to degradation manager
    if (this.degradationManager) {
      // Update quality thresholds based on performance settings
    }
  }

  // Recovery Management
  private async attemptConnectionRecovery(failureType: FailureType): Promise<void> {
    if (!this.recoveryManager || !this.connectionManager) {
      return;
    }

    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🔄 Attempting connection recovery for: ${failureType}`);

    const pc = this.connectionManager.getPeerConnection();
    if (!pc) {
      return;
    }

    const success = await this.recoveryManager.initiateRecovery(failureType, {
      peerConnection: pc,
      participantId: this.config.participantId,
      tourId: this.config.tourId,
      language: this.config.language,
      role: this.config.role
    });

    if (success) {
      console.log(`${context} ✅ Connection recovery successful`);
    } else {
      console.error(`${context} ❌ Connection recovery failed`);
      this.config.onError?.(new Error('Connection recovery failed'));
    }
  }

  // Quality Management
  public async setQualityLevel(level: QualityLevel): Promise<boolean> {
    this.ensureInitialized();
    
    if (!this.degradationManager) {
      throw new Error('Graceful degradation not enabled');
    }

    return await this.degradationManager.setQualityLevel(level, 'manual');
  }

  public getCurrentQualityLevel(): QualityLevel {
    this.ensureInitialized();
    
    return this.degradationManager?.getCurrentQualityLevel() || QualityLevel.HIGH;
  }

  // Status and Diagnostics
  public getStatus(): ProductionWebRTCStatus {
    this.ensureInitialized();

    const connectionState = this.connectionManager?.getState() || ConnectionState.CLOSED;
    const qualityLevel = this.degradationManager?.getCurrentQualityLevel() || QualityLevel.HIGH;
    const isHealthy = this.monitoringSystem?.isHealthy() || false;
    const performanceScore = this.performanceOptimizer?.getLatestMetrics()?.performanceScore || 0;
    const connectionDuration = this.monitoringSystem?.getConnectionDuration() || 0;
    const recoveryStats = this.recoveryManager?.getRecoveryStatistics();
    const recommendations = this.performanceOptimizer?.getOptimizationRecommendations() || [];

    return {
      connectionState,
      qualityLevel,
      isHealthy,
      performanceScore,
      connectionDuration,
      recoveryAttempts: recoveryStats?.totalRecoveries || 0,
      recommendations
    };
  }

  public async generateDiagnosticReport(): Promise<any> {
    this.ensureInitialized();
    
    const report = {
      timestamp: Date.now(),
      connectionId: this.connectionId,
      config: this.config,
      status: this.getStatus(),
      monitoring: this.monitoringSystem?.generateDiagnosticReport(),
      performance: this.performanceOptimizer?.getLatestMetrics(),
      recovery: this.recoveryManager?.getRecoveryStatistics(),
      adaptation: this.degradationManager?.getAdaptationStatistics()
    };

    return report;
  }

  // Utility Methods
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    if (this.isDestroyed) {
      throw new Error('Manager has been destroyed.');
    }
  }

  private getTargetParticipantId(): string {
    // In a real implementation, this would determine the target participant
    // For now, return a placeholder
    return this.config.role === 'guide' ? 'attendee' : 'guide';
  }

  // Cleanup
  private async cleanup(): Promise<void> {
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🧹 Cleaning up Production WebRTC Manager...`);

    // Clean up all components
    if (this.performanceOptimizer) {
      this.performanceOptimizer.destroy();
      this.performanceOptimizer = null;
    }

    if (this.degradationManager) {
      this.degradationManager.destroy();
      this.degradationManager = null;
    }

    if (this.recoveryManager) {
      this.recoveryManager.destroy();
      this.recoveryManager = null;
    }

    if (this.monitoringSystem) {
      this.monitoringSystem.destroy();
      this.monitoringSystem = null;
    }

    if (this.signalingCoordinator) {
      await this.signalingCoordinator.cleanup();
      this.signalingCoordinator = null;
    }

    if (this.connectionManager) {
      this.connectionManager.destroy();
      this.connectionManager = null;
    }
  }

  public async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    await this.cleanup();
    this.isDestroyed = true;
    
    const context = `[ProductionWebRTC:${this.connectionId}]`;
    console.log(`${context} 🏁 Production WebRTC Manager destroyed`);
  }
}

// Factory function with sensible defaults
export function createProductionWebRTCManager(config: Partial<ProductionWebRTCConfig> & {
  tourId: string;
  language: string;
  role: 'guide' | 'attendee';
  participantId: string;
}): ProductionWebRTCManager {
  const defaultConfig: ProductionWebRTCConfig = {
    // Required fields from input
    tourId: config.tourId,
    language: config.language,
    role: config.role,
    participantId: config.participantId,
    
    // Feature flags - enable all by default for production
    enableSignalingCoordination: true,
    enableConnectionRecovery: true,
    enableQualityMonitoring: true,
    enableGracefulDegradation: true,
    enablePerformanceOptimization: true,
    
    // Quality settings
    initialQualityLevel: QualityLevel.HIGH,
    autoQualityAdaptation: true,
    
    // Recovery settings
    enableAutoRecovery: true,
    maxRecoveryAttempts: 3,
    
    // Monitoring settings
    enableDetailedMetrics: false, // Disable for performance in production
    metricsRetentionTime: 300000, // 5 minutes
    
    // Override with provided config
    ...config
  };

  return new ProductionWebRTCManager(defaultConfig);
}