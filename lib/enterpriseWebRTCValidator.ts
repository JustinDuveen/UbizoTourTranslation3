/**
 * Enterprise WebRTC Validation System
 * 
 * Comprehensive validation and testing framework for enterprise WebRTC components.
 * Validates ICE configuration, SDP optimization, audio pipeline, and connection management.
 * 
 * @author Senior WebRTC Developer
 * @version 1.0.0
 */

import { EnterpriseICEManager } from './enterpriseICEManager';
import { EnterpriseSDPManager } from './enterpriseSDPManager';
import { EnterpriseAudioPipeline } from './enterpriseAudioPipeline';
import { EnterpriseConnectionManager, ConnectionState } from './enterpriseConnectionManager';

export interface ValidationResult {
  component: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  metrics?: Record<string, any>;
}

export interface SystemValidationReport {
  overallStatus: 'PASS' | 'FAIL' | 'WARNING';
  results: ValidationResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  timestamp: number;
}

/**
 * Enterprise WebRTC System Validator
 */
export class EnterpriseWebRTCValidator {
  private static instance: EnterpriseWebRTCValidator;

  static getInstance(): EnterpriseWebRTCValidator {
    if (!EnterpriseWebRTCValidator.instance) {
      EnterpriseWebRTCValidator.instance = new EnterpriseWebRTCValidator();
    }
    return EnterpriseWebRTCValidator.instance;
  }

  /**
   * Run comprehensive validation of all enterprise WebRTC components
   */
  async validateSystem(): Promise<SystemValidationReport> {
    console.log('🔍 Starting Enterprise WebRTC System Validation...');

    const results: ValidationResult[] = [];

    // Validate ICE Manager
    results.push(await this.validateICEManager());

    // Validate SDP Manager
    results.push(await this.validateSDPManager());

    // Validate Audio Pipeline
    results.push(await this.validateAudioPipeline());

    // Validate Connection Manager
    results.push(await this.validateConnectionManager());

    // Validate Integration
    results.push(await this.validateIntegration());

    // Generate summary
    const summary = {
      totalTests: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      warnings: results.reduce((sum, r) => sum + r.warnings.length, 0)
    };

    const overallStatus = summary.failed > 0 ? 'FAIL' : 
                         summary.warnings > 0 ? 'WARNING' : 'PASS';

    const report: SystemValidationReport = {
      overallStatus,
      results,
      summary,
      timestamp: Date.now()
    };

    this.logValidationReport(report);
    return report;
  }

  /**
   * Validate ICE Manager functionality
   */
  private async validateICEManager(): Promise<ValidationResult> {
    const result: ValidationResult = {
      component: 'ICE Manager',
      passed: true,
      errors: [],
      warnings: [],
      metrics: {}
    };

    try {
      const iceManager = EnterpriseICEManager.getInstance();

      // Test configuration retrieval
      const guideConfig = iceManager.getConfiguration('guide');
      const attendeeConfig = iceManager.getConfiguration('attendee');

      // Validate configuration structure
      if (!guideConfig.iceServers || guideConfig.iceServers.length === 0) {
        result.errors.push('Guide ICE configuration has no servers');
        result.passed = false;
      }

      if (!attendeeConfig.iceServers || attendeeConfig.iceServers.length === 0) {
        result.errors.push('Attendee ICE configuration has no servers');
        result.passed = false;
      }

      // Validate consistency
      if (guideConfig.bundlePolicy !== attendeeConfig.bundlePolicy) {
        result.warnings.push('Bundle policy differs between guide and attendee');
      }

      if (guideConfig.rtcpMuxPolicy !== attendeeConfig.rtcpMuxPolicy) {
        result.warnings.push('RTCP mux policy differs between guide and attendee');
      }

      // Test health monitoring
      const healthStatus = iceManager.getHealthStatus();
      result.metrics!.healthyServers = Array.from(healthStatus.values())
        .filter(status => status.isHealthy).length;
      result.metrics!.totalServers = healthStatus.size;

      if (result.metrics!.healthyServers === 0 && healthStatus.size > 0) {
        result.warnings.push('No healthy ICE servers detected');
      }

      // Test RTCConfiguration generation
      const rtcConfig = iceManager.getRTCConfiguration('guide');
      if (!rtcConfig.iceServers || rtcConfig.iceServers.length === 0) {
        result.errors.push('RTCConfiguration has no ICE servers');
        result.passed = false;
      }

      result.metrics!.iceServerCount = rtcConfig.iceServers?.length || 0;
      result.metrics!.iceCandidatePoolSize = rtcConfig.iceCandidatePoolSize;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`ICE Manager validation failed: ${errorMessage}`);
      result.passed = false;
    }

    return result;
  }

  /**
   * Validate SDP Manager functionality
   */
  private async validateSDPManager(): Promise<ValidationResult> {
    const result: ValidationResult = {
      component: 'SDP Manager',
      passed: true,
      errors: [],
      warnings: [],
      metrics: {}
    };

    try {
      // Create a test peer connection for SDP validation
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      // Test SDP validation
      const testSDP = {
        type: 'offer' as RTCSdpType,
        sdp: 'v=0\r\no=- 123456789 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n'
      };

      const validation = EnterpriseSDPManager.validateSDP(testSDP);
      if (!validation.isValid) {
        result.errors.push(`SDP validation failed: ${validation.errors.join(', ')}`);
        result.passed = false;
      }

      result.metrics!.sdpValidationErrors = validation.errors.length;
      result.metrics!.sdpValidationWarnings = validation.warnings.length;

      // Test SDP optimization
      const optimizedSDP = EnterpriseSDPManager.optimizeSDPForEnterprise(testSDP);
      if (!optimizedSDP.sdp || optimizedSDP.sdp === testSDP.sdp) {
        result.warnings.push('SDP optimization may not be working correctly');
      }

      // Test offer/answer creation (requires actual peer connection)
      try {
        const offer = await pc.createOffer();
        const optimizedOffer = await EnterpriseSDPManager.createOptimizedOffer(pc);
        
        if (optimizedOffer.sdp && optimizedOffer.sdp.includes('opus')) {
          result.metrics!.opusOptimization = true;
        } else {
          result.warnings.push('Opus codec optimization not detected in SDP');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.warnings.push(`Could not test offer creation: ${errorMessage}`);
      }

      pc.close();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`SDP Manager validation failed: ${errorMessage}`);
      result.passed = false;
    }

    return result;
  }

  /**
   * Validate Audio Pipeline functionality
   */
  private async validateAudioPipeline(): Promise<ValidationResult> {
    const result: ValidationResult = {
      component: 'Audio Pipeline',
      passed: true,
      errors: [],
      warnings: [],
      metrics: {}
    };

    try {
      const audioPipeline = EnterpriseAudioPipeline.getInstance();

      // Test pipeline status
      const status = audioPipeline.getStatus();
      result.metrics!.activeConnections = status.activeConnections;
      result.metrics!.processingChains = status.processingChains;
      result.metrics!.supportedLanguages = status.languages.length;

      // Test attendee connection management
      const testConnectionId = 'test-connection-123';
      const testLanguage = 'en';

      // Register a test attendee connection
      const mockConnection = {
        pc: { getSenders: () => [], addTrack: () => {} }
      };

      audioPipeline.registerAttendeeConnection(testLanguage, testConnectionId, mockConnection);
      
      const attendeeConnections = audioPipeline.getAttendeeConnections(testLanguage);
      if (!attendeeConnections.has(testConnectionId)) {
        result.errors.push('Failed to register attendee connection');
        result.passed = false;
      }

      // Test cleanup
      audioPipeline.unregisterAttendeeConnection(testLanguage, testConnectionId);
      const connectionsAfterCleanup = audioPipeline.getAttendeeConnections(testLanguage);
      if (connectionsAfterCleanup.has(testConnectionId)) {
        result.errors.push('Failed to unregister attendee connection');
        result.passed = false;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Audio Pipeline validation failed: ${errorMessage}`);
      result.passed = false;
    }

    return result;
  }

  /**
   * Validate Connection Manager functionality
   */
  private async validateConnectionManager(): Promise<ValidationResult> {
    const result: ValidationResult = {
      component: 'Connection Manager',
      passed: true,
      errors: [],
      warnings: [],
      metrics: {}
    };

    try {
      const connectionManager = EnterpriseConnectionManager.getInstance();

      // Test connection creation
      const testConnection = await connectionManager.createConnection({
        role: 'attendee',
        language: 'en',
        tourId: 'test-tour-123',
        timeout: 5000
      });

      if (!testConnection) {
        result.errors.push('Failed to create test connection');
        result.passed = false;
        return result;
      }

      result.metrics!.connectionId = testConnection.id;
      result.metrics!.connectionRole = testConnection.role;
      result.metrics!.connectionLanguage = testConnection.language;

      // Test connection retrieval
      const retrievedConnection = connectionManager.getConnection(testConnection.id);
      if (!retrievedConnection) {
        result.errors.push('Failed to retrieve created connection');
        result.passed = false;
      }

      // Test connection stats
      const stats = connectionManager.getConnectionStats();
      result.metrics!.totalConnections = stats.total;
      result.metrics!.connectedConnections = stats.connected;

      // Test connection cleanup
      connectionManager.closeConnection(testConnection.id);
      const connectionAfterClose = connectionManager.getConnection(testConnection.id);
      if (connectionAfterClose) {
        result.warnings.push('Connection may not have been properly cleaned up');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Connection Manager validation failed: ${errorMessage}`);
      result.passed = false;
    }

    return result;
  }

  /**
   * Validate integration between components
   */
  private async validateIntegration(): Promise<ValidationResult> {
    const result: ValidationResult = {
      component: 'Integration',
      passed: true,
      errors: [],
      warnings: [],
      metrics: {}
    };

    try {
      // Test ICE Manager + Connection Manager integration
      const iceManager = EnterpriseICEManager.getInstance();
      const connectionManager = EnterpriseConnectionManager.getInstance();

      const iceConfig = iceManager.getRTCConfiguration('guide');
      const connection = await connectionManager.createConnection({
        role: 'guide',
        language: 'en',
        tourId: 'integration-test'
      });

      // Verify connection uses ICE configuration
      const pcConfig = connection.peerConnection.getConfiguration();
      if (!pcConfig.iceServers || !iceConfig.iceServers || pcConfig.iceServers.length !== iceConfig.iceServers.length) {
        result.warnings.push('Connection may not be using ICE Manager configuration');
      }

      result.metrics!.integrationTest = 'ICE-Connection';
      result.metrics!.iceServersMatch = pcConfig.iceServers?.length === (iceConfig.iceServers?.length || 0);

      // Cleanup
      connectionManager.closeConnection(connection.id);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Integration validation failed: ${errorMessage}`);
      result.passed = false;
    }

    return result;
  }

  /**
   * Log validation report to console
   */
  private logValidationReport(report: SystemValidationReport): void {
    console.log('\n🔍 Enterprise WebRTC Validation Report');
    console.log('=====================================');
    console.log(`Overall Status: ${report.overallStatus}`);
    console.log(`Timestamp: ${new Date(report.timestamp).toISOString()}`);
    console.log(`\nSummary:`);
    console.log(`  Total Tests: ${report.summary.totalTests}`);
    console.log(`  Passed: ${report.summary.passed}`);
    console.log(`  Failed: ${report.summary.failed}`);
    console.log(`  Warnings: ${report.summary.warnings}`);

    console.log('\nComponent Results:');
    report.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`  ${status} ${result.component}`);
      
      if (result.errors.length > 0) {
        result.errors.forEach(error => console.log(`    ❌ ${error}`));
      }
      
      if (result.warnings.length > 0) {
        result.warnings.forEach(warning => console.log(`    ⚠️  ${warning}`));
      }

      if (result.metrics && Object.keys(result.metrics).length > 0) {
        console.log(`    📊 Metrics:`, result.metrics);
      }
    });

    console.log('\n=====================================\n');
  }
}

// Export singleton instance
export const enterpriseValidator = EnterpriseWebRTCValidator.getInstance();
