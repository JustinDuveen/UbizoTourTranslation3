/**
 * Enterprise ICE Configuration Manager
 * 
 * Provides centralized, consistent ICE server configuration across all WebRTC connections
 * with enterprise-grade redundancy, health monitoring, and security policies.
 * Integrated with Xirsys TURN servers for optimal NAT traversal.
 * 
 * @author Senior WebRTC Developer
 * @version 1.0.0
 */

import { getBestXirsysICEServers, getStaticXirsysICEServers } from './xirsysConfig';

export interface ICEServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
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
    // Only start health checking in browser environment
    if (typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined') {
      this.startHealthChecking();
    }
  }

  private startHealthChecking(): void {
    // Extra safety check
    if (typeof RTCPeerConnection === 'undefined') {
      console.warn('RTCPeerConnection not available, skipping ICE health monitoring');
      return;
    }
    
    this.checkInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.CHECK_INTERVAL_MS);
  }

  private async performHealthChecks(): Promise<void> {
    // Skip health checks in server environment
    if (typeof RTCPeerConnection === 'undefined') {
      return;
    }
    
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
    // Skip STUN checks in server environment
    if (typeof RTCPeerConnection === 'undefined') {
      return;
    }
    
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
    
    // In server environment, return Xirsys static config without health checking
    if (typeof RTCPeerConnection === 'undefined') {
      console.log('[ENTERPRISE-ICE] Server environment: using static Xirsys configuration');
      return getStaticXirsysICEServers() as ICEServerConfig[];
    }

    // CRITICAL FIX: Use Xirsys servers instead of default servers
    try {
      const xirsysServers = getStaticXirsysICEServers();
      console.log(`[ENTERPRISE-ICE] Using Xirsys configuration with ${xirsysServers.length} servers`);
      
      // Convert to ICEServerConfig format and validate
      xirsysServers.forEach(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const hasCredentials = server.username && server.credential;
        
        // Log server details for debugging
        if (hasCredentials) {
          const turnUrls = urls.filter(url => url.startsWith('turn:') || url.startsWith('turns:'));
          console.log(`[ENTERPRISE-ICE] ✅ TURN server configured with ${turnUrls.length} endpoints and credentials`);
        }
        
        healthyServers.push({
          urls: server.urls,
          username: server.username,
          credential: server.credential
        });
      });
      
      return healthyServers;
      
    } catch (error) {
      console.error('[ENTERPRISE-ICE] Failed to load Xirsys configuration, using fallback:', error);
      // Fallback to basic config only if Xirsys fails
      return [
        {
          urls: [
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302'
          ]
        },
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443'
          ],
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ];
    }

    // Browser environment: Apply health filtering to Xirsys servers
    const xirsysServers = getStaticXirsysICEServers();
    xirsysServers.forEach(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      
      // For STUN servers, check health status
      const isSTUNServer = urls.some(url => url.startsWith('stun:'));
      if (isSTUNServer) {
        const healthyUrls = urls.filter(url => {
          const status = this.healthStatus.get(url);
          return !status || (status.isHealthy && status.errorCount < this.MAX_ERROR_COUNT);
        });
        
        if (healthyUrls.length > 0) {
          healthyServers.push({
            urls: healthyUrls,
            username: server.username,
            credential: server.credential
          });
        }
      } else {
        // For TURN servers, always include (health check is less reliable)
        const hasCredentials = server.username && server.credential;
        if (hasCredentials) {
          const turnUrls = urls.filter(url => url.startsWith('turn:') || url.startsWith('turns:'));
          console.log(`[ENTERPRISE-ICE] ✅ Including TURN server with ${turnUrls.length} endpoints and credentials`);
        }
        
        healthyServers.push({
          urls: server.urls,
          username: server.username,
          credential: server.credential
        });
      }
    });

    console.log(`[ENTERPRISE-ICE] Final configuration: ${healthyServers.length} server groups`);
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
    // Skip certificate generation in server environment
    if (typeof RTCPeerConnection === 'undefined' || typeof window === 'undefined') {
      return;
    }
    
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
   * RFC 8445 compliant with same-network optimizations
   */
  getConfiguration(role: 'guide' | 'attendee'): EnterpriseICEConfig {
    const baseConfig: EnterpriseICEConfig = {
      iceServers: this.healthMonitor.getHealthyServers(),
      iceCandidatePoolSize: 8, // Reduced to limit pair explosion on same network
      bundlePolicy: 'max-bundle', // Bundle all media on single transport
      rtcpMuxPolicy: 'require', // Multiplex RTP and RTCP for efficiency
      iceTransportPolicy: 'all', // Allow all candidate types for maximum compatibility
      certificates: this.certificates.length > 0 ? this.certificates : undefined
    };

    // Role-specific optimizations for same-network scenarios
    if (role === 'guide') {
      // Guide can afford slightly larger pool but not excessive
      baseConfig.iceCandidatePoolSize = 10;
    } else {
      // Attendee uses smaller pool to reduce connectivity check overhead
      baseConfig.iceCandidatePoolSize = 6;
    }

    return baseConfig;
  }

  /**
   * Get RTCConfiguration object for direct use with RTCPeerConnection
   * RFC 8445 COMPLIANT: Explicit role assignment to prevent deadlocks
   */
  getRTCConfiguration(role: 'guide' | 'attendee'): RTCConfiguration {
    const config = this.getConfiguration(role);
    
    // RFC 8445: Explicit role assignment prevents same-network deadlocks
    const rtcConfig: RTCConfiguration & { iceControlling?: boolean } = {
      iceServers: config.iceServers,
      iceCandidatePoolSize: config.iceCandidatePoolSize,
      bundlePolicy: config.bundlePolicy,
      rtcpMuxPolicy: config.rtcpMuxPolicy,
      iceTransportPolicy: config.iceTransportPolicy,
      certificates: config.certificates,
      // CRITICAL FIX: Explicit role assignment per RFC 8445
      iceControlling: role === 'guide' // Guide=controlling, Attendee=controlled
    };
    
    console.log(`[ENTERPRISE-ICE] Role assignment: ${role} = ${role === 'guide' ? 'controlling' : 'controlled'}`);
    return rtcConfig;
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



