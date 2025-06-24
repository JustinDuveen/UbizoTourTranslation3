/**
 * Enterprise ICE Configuration Manager
 * 
 * Provides centralized, consistent ICE server configuration across all WebRTC connections
 * with enterprise-grade redundancy, health monitoring, and security policies.
 * 
 * @author Senior WebRTC Developer
 * @version 1.0.0
 */

export interface ICEServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
}

export interface EnterpriseICEConfig {
  iceServers: ICEServerConfig[];
  iceCandidatePoolSize: number;
  bundlePolicy: RTCBundlePolicy;
  rtcpMuxPolicy: RTCRtcpMuxPolicy;
  iceTransportPolicy: RTCIceTransportPolicy;
  certificates?: RTCCertificate[];
}

export interface ICEServerHealth {
  url: string;
  isHealthy: boolean;
  lastChecked: number;
  responseTime: number;
  errorCount: number;
}

/**
 * Enterprise-grade ICE server health monitoring
 */
class ICEServerHealthMonitor {
  private healthStatus: Map<string, ICEServerHealth> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60000; // 60 seconds (less aggressive)
  private readonly MAX_ERROR_COUNT = 5; // More lenient threshold

  constructor() {
    this.startHealthChecking();
  }

  private startHealthChecking(): void {
    this.checkInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.CHECK_INTERVAL_MS);
  }

  private async performHealthChecks(): Promise<void> {
    const stunServers = [
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:global.stun.twilio.com:3478',
      'stun:stun.cloudflare.com:3478'
    ];

    for (const server of stunServers) {
      await this.checkSTUNServer(server);
    }
  }

  private async checkSTUNServer(url: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Create a temporary peer connection to test STUN server
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: url }],
        iceCandidatePoolSize: 1 // Minimal pool for health check
      });

      // Set up a promise that resolves when we get ICE candidates
      const icePromise = new Promise<boolean>((resolve, reject) => {
        let candidateReceived = false;
        let timeoutId: NodeJS.Timeout;

        pc.onicecandidate = (event) => {
          if (event.candidate && !candidateReceived) {
            candidateReceived = true;
            clearTimeout(timeoutId);
            resolve(true);
          }
        };

        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete' && !candidateReceived) {
            clearTimeout(timeoutId);
            resolve(false);
          }
        };

        // More lenient timeout for health checks (10 seconds)
        timeoutId = setTimeout(() => {
          if (!candidateReceived) {
            resolve(false);
          }
        }, 10000);
      });

      // Create a dummy offer to trigger ICE gathering
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const success = await icePromise;

      pc.close();

      const responseTime = Date.now() - startTime;
      const currentStatus = this.healthStatus.get(url);

      // More lenient error counting - only increment on consecutive failures
      let newErrorCount = 0;
      if (!success) {
        newErrorCount = (currentStatus?.errorCount || 0) + 1;
      } else {
        // Reset error count on success
        newErrorCount = 0;
      }

      this.updateHealthStatus(url, {
        url,
        isHealthy: success || newErrorCount < this.MAX_ERROR_COUNT, // Keep healthy if under threshold
        lastChecked: Date.now(),
        responseTime,
        errorCount: newErrorCount
      });

    } catch (error) {
      console.error(`Health check failed for STUN server ${url}:`, error);

      const currentStatus = this.healthStatus.get(url);
      const newErrorCount = (currentStatus?.errorCount || 0) + 1;

      this.updateHealthStatus(url, {
        url,
        isHealthy: newErrorCount < this.MAX_ERROR_COUNT, // Keep healthy if under threshold
        lastChecked: Date.now(),
        responseTime: Date.now() - startTime,
        errorCount: newErrorCount
      });
    }
  }

  private updateHealthStatus(url: string, status: ICEServerHealth): void {
    const previousStatus = this.healthStatus.get(url);
    this.healthStatus.set(url, status);

    // Log health status changes only when status actually changes
    if (!status.isHealthy && status.errorCount >= this.MAX_ERROR_COUNT) {
      if (!previousStatus || previousStatus.isHealthy) {
        console.warn(`ICE server ${url} marked as unhealthy after ${status.errorCount} consecutive failures`);
      }
    } else if (status.isHealthy && previousStatus && !previousStatus.isHealthy) {
      console.info(`ICE server ${url} recovered and marked as healthy (response time: ${status.responseTime}ms)`);
    }
  }

  getHealthyServers(): ICEServerConfig[] {
    const healthyServers: ICEServerConfig[] = [];
    
    // Always include primary STUN servers if healthy
    const primarySTUN = [
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302'
    ];

    const healthySTUN = primarySTUN.filter(url => {
      const status = this.healthStatus.get(url);
      return !status || (status.isHealthy && status.errorCount < this.MAX_ERROR_COUNT);
    });

    if (healthySTUN.length > 0) {
      healthyServers.push({ urls: healthySTUN });
    }

    // Add backup STUN servers if primary ones are failing
    if (healthySTUN.length === 0) {
      const backupSTUN = [
        'stun:global.stun.twilio.com:3478',
        'stun:stun.cloudflare.com:3478'
      ];
      
      const healthyBackup = backupSTUN.filter(url => {
        const status = this.healthStatus.get(url);
        return !status || (status.isHealthy && status.errorCount < this.MAX_ERROR_COUNT);
      });

      if (healthyBackup.length > 0) {
        healthyServers.push({ urls: healthyBackup });
      }
    }

    // Add TURN servers (these would be configured with actual credentials in production)
    healthyServers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    });

    return healthyServers;
  }

  getHealthStatus(): Map<string, ICEServerHealth> {
    return new Map(this.healthStatus);
  }

  cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

/**
 * Enterprise ICE Configuration Manager
 * Singleton pattern for consistent configuration across the application
 */
export class EnterpriseICEManager {
  private static instance: EnterpriseICEManager;
  private healthMonitor: ICEServerHealthMonitor;
  private certificates: RTCCertificate[] = [];

  private constructor() {
    this.healthMonitor = new ICEServerHealthMonitor();
    this.initializeCertificates();
  }

  static getInstance(): EnterpriseICEManager {
    if (!EnterpriseICEManager.instance) {
      EnterpriseICEManager.instance = new EnterpriseICEManager();
    }
    return EnterpriseICEManager.instance;
  }

  private async initializeCertificates(): Promise<void> {
    try {
      // Generate enterprise-grade certificates for DTLS
      const certificate = await RTCPeerConnection.generateCertificate({
        name: 'ECDSA',
        namedCurve: 'P-256'
      } as any);
      
      this.certificates.push(certificate);
      console.log('Enterprise ICE Manager: DTLS certificate generated successfully');
    } catch (error) {
      console.warn('Enterprise ICE Manager: Failed to generate certificate:', error);
    }
  }

  /**
   * Get standardized ICE configuration for WebRTC connections
   * Consistent across all connection types (guide/attendee)
   */
  getConfiguration(role: 'guide' | 'attendee'): EnterpriseICEConfig {
    const baseConfig: EnterpriseICEConfig = {
      iceServers: this.healthMonitor.getHealthyServers(),
      iceCandidatePoolSize: 10, // Consistent across all connections
      bundlePolicy: 'max-bundle', // Bundle all media on single transport
      rtcpMuxPolicy: 'require', // Multiplex RTP and RTCP for efficiency
      iceTransportPolicy: 'all', // Allow all candidate types
      certificates: this.certificates.length > 0 ? this.certificates : undefined
    };

    // Role-specific optimizations
    if (role === 'guide') {
      // Guide typically has more stable connection, can afford slightly larger pool
      baseConfig.iceCandidatePoolSize = 12;
    }

    return baseConfig;
  }

  /**
   * Get RTCConfiguration object for direct use with RTCPeerConnection
   */
  getRTCConfiguration(role: 'guide' | 'attendee'): RTCConfiguration {
    const config = this.getConfiguration(role);
    
    return {
      iceServers: config.iceServers,
      iceCandidatePoolSize: config.iceCandidatePoolSize,
      bundlePolicy: config.bundlePolicy,
      rtcpMuxPolicy: config.rtcpMuxPolicy,
      iceTransportPolicy: config.iceTransportPolicy,
      certificates: config.certificates
    };
  }

  /**
   * Get current health status of ICE servers
   */
  getHealthStatus(): Map<string, ICEServerHealth> {
    return this.healthMonitor.getHealthStatus();
  }

  /**
   * Force a health check of all ICE servers
   */
  async performHealthCheck(): Promise<void> {
    await (this.healthMonitor as any).performHealthChecks();
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.healthMonitor.cleanup();
  }
}

// Export singleton instance for easy access
export const enterpriseICE = EnterpriseICEManager.getInstance();
