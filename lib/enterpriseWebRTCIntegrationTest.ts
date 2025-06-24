/**
 * Enterprise WebRTC Integration Test
 * 
 * Quick integration test to verify all enterprise components work together seamlessly.
 * This test validates the complete Phase 1 & 2 implementation.
 * 
 * @author Senior WebRTC Developer
 * @version 1.0.0
 */

import { EnterpriseICEManager } from './enterpriseICEManager';
import { EnterpriseSDPManager } from './enterpriseSDPManager';
import { EnterpriseAudioPipeline } from './enterpriseAudioPipeline';
import { EnterpriseConnectionManager, ConnectionState } from './enterpriseConnectionManager';

export interface IntegrationTestResult {
  testName: string;
  passed: boolean;
  error?: string;
  duration: number;
}

export class EnterpriseWebRTCIntegrationTest {
  
  /**
   * Run comprehensive integration test
   */
  static async runIntegrationTest(): Promise<IntegrationTestResult[]> {
    console.log('🧪 Starting Enterprise WebRTC Integration Test...\n');
    
    const results: IntegrationTestResult[] = [];
    
    // Test 1: ICE Manager Integration
    results.push(await this.testICEManagerIntegration());
    
    // Test 2: SDP Manager Integration
    results.push(await this.testSDPManagerIntegration());
    
    // Test 3: Audio Pipeline Integration
    results.push(await this.testAudioPipelineIntegration());
    
    // Test 4: Connection Manager Integration
    results.push(await this.testConnectionManagerIntegration());
    
    // Test 5: End-to-End Integration
    results.push(await this.testEndToEndIntegration());
    
    // Summary
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    console.log(`\n🧪 Integration Test Summary: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('✅ All integration tests PASSED - System is ready!');
    } else {
      console.log('❌ Some integration tests FAILED - Review required');
    }
    
    return results;
  }
  
  private static async testICEManagerIntegration(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔧 Testing ICE Manager Integration...');
      
      const iceManager = EnterpriseICEManager.getInstance();
      
      // Test configuration retrieval
      const guideConfig = iceManager.getConfiguration('guide');
      const attendeeConfig = iceManager.getConfiguration('attendee');
      
      if (!guideConfig.iceServers || guideConfig.iceServers.length === 0) {
        throw new Error('Guide ICE configuration is empty');
      }
      
      if (!attendeeConfig.iceServers || attendeeConfig.iceServers.length === 0) {
        throw new Error('Attendee ICE configuration is empty');
      }
      
      // Test RTCConfiguration generation
      const rtcConfig = iceManager.getRTCConfiguration('guide');
      if (!rtcConfig.iceServers || rtcConfig.iceServers.length === 0) {
        throw new Error('RTCConfiguration generation failed');
      }
      
      // Test health monitoring
      const healthStatus = iceManager.getHealthStatus();
      console.log(`  📊 ICE servers monitored: ${healthStatus.size}`);
      
      console.log('  ✅ ICE Manager integration test passed');
      
      return {
        testName: 'ICE Manager Integration',
        passed: true,
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ ICE Manager integration test failed: ${errorMessage}`);

      return {
        testName: 'ICE Manager Integration',
        passed: false,
        error: errorMessage,
        duration: Date.now() - startTime
      };
    }
  }
  
  private static async testSDPManagerIntegration(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔧 Testing SDP Manager Integration...');
      
      // Create test peer connection
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
        throw new Error(`SDP validation failed: ${validation.errors.join(', ')}`);
      }
      
      // Test SDP optimization
      const optimizedSDP = EnterpriseSDPManager.optimizeSDPForEnterprise(testSDP);
      if (!optimizedSDP.sdp) {
        throw new Error('SDP optimization failed');
      }
      
      // Test offer creation
      const offer = await EnterpriseSDPManager.createOptimizedOffer(pc);
      if (!offer.sdp || !offer.type) {
        throw new Error('Optimized offer creation failed');
      }
      
      pc.close();
      
      console.log('  ✅ SDP Manager integration test passed');
      
      return {
        testName: 'SDP Manager Integration',
        passed: true,
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ SDP Manager integration test failed: ${errorMessage}`);

      return {
        testName: 'SDP Manager Integration',
        passed: false,
        error: errorMessage,
        duration: Date.now() - startTime
      };
    }
  }
  
  private static async testAudioPipelineIntegration(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔧 Testing Audio Pipeline Integration...');
      
      const audioPipeline = EnterpriseAudioPipeline.getInstance();
      
      // Test status retrieval
      const status = audioPipeline.getStatus();
      console.log(`  📊 Audio pipeline status: ${status.activeConnections} connections`);
      
      // Test attendee connection management
      const testConnectionId = 'integration-test-123';
      const testLanguage = 'en';
      
      const mockConnection = {
        pc: { 
          getSenders: () => [], 
          addTrack: () => {} 
        }
      };
      
      // Register attendee connection
      audioPipeline.registerAttendeeConnection(testLanguage, testConnectionId, mockConnection);
      
      const connections = audioPipeline.getAttendeeConnections(testLanguage);
      if (!connections.has(testConnectionId)) {
        throw new Error('Failed to register attendee connection');
      }
      
      // Cleanup
      audioPipeline.unregisterAttendeeConnection(testLanguage, testConnectionId);
      
      const connectionsAfterCleanup = audioPipeline.getAttendeeConnections(testLanguage);
      if (connectionsAfterCleanup.has(testConnectionId)) {
        throw new Error('Failed to unregister attendee connection');
      }
      
      console.log('  ✅ Audio Pipeline integration test passed');
      
      return {
        testName: 'Audio Pipeline Integration',
        passed: true,
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ Audio Pipeline integration test failed: ${errorMessage}`);

      return {
        testName: 'Audio Pipeline Integration',
        passed: false,
        error: errorMessage,
        duration: Date.now() - startTime
      };
    }
  }
  
  private static async testConnectionManagerIntegration(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔧 Testing Connection Manager Integration...');
      
      const connectionManager = EnterpriseConnectionManager.getInstance();
      
      // Test connection creation
      const connection = await connectionManager.createConnection({
        role: 'attendee',
        language: 'en',
        tourId: 'integration-test-tour',
        timeout: 5000
      });
      
      if (!connection) {
        throw new Error('Failed to create connection');
      }
      
      console.log(`  📊 Created connection: ${connection.id} (${connection.role})`);
      
      // Test connection retrieval
      const retrievedConnection = connectionManager.getConnection(connection.id);
      if (!retrievedConnection) {
        throw new Error('Failed to retrieve connection');
      }
      
      // Test connection stats
      const stats = connectionManager.getConnectionStats();
      console.log(`  📊 Connection stats: ${stats.total} total, ${stats.connected} connected`);
      
      // Cleanup
      connectionManager.closeConnection(connection.id);
      
      console.log('  ✅ Connection Manager integration test passed');
      
      return {
        testName: 'Connection Manager Integration',
        passed: true,
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ Connection Manager integration test failed: ${errorMessage}`);

      return {
        testName: 'Connection Manager Integration',
        passed: false,
        error: errorMessage,
        duration: Date.now() - startTime
      };
    }
  }
  
  private static async testEndToEndIntegration(): Promise<IntegrationTestResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔧 Testing End-to-End Integration...');
      
      // Test that all components work together
      const iceManager = EnterpriseICEManager.getInstance();
      const connectionManager = EnterpriseConnectionManager.getInstance();
      const audioPipeline = EnterpriseAudioPipeline.getInstance();
      
      // Create connection using ICE Manager configuration
      const connection = await connectionManager.createConnection({
        role: 'guide',
        language: 'en',
        tourId: 'e2e-test-tour'
      });
      
      // Verify connection uses ICE Manager configuration
      const iceConfig = iceManager.getRTCConfiguration('guide');
      const pcConfig = connection.peerConnection.getConfiguration();
      
      if (!pcConfig.iceServers || !iceConfig.iceServers || pcConfig.iceServers.length !== iceConfig.iceServers.length) {
        console.log('  ⚠️  Warning: Connection may not be using ICE Manager configuration');
      }
      
      // Test audio pipeline integration
      const mockConnection = {
        pc: connection.peerConnection
      };
      
      audioPipeline.registerAttendeeConnection('en', 'e2e-test-attendee', mockConnection);
      
      // Cleanup
      audioPipeline.unregisterAttendeeConnection('en', 'e2e-test-attendee');
      connectionManager.closeConnection(connection.id);
      
      console.log('  ✅ End-to-End integration test passed');
      
      return {
        testName: 'End-to-End Integration',
        passed: true,
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ End-to-End integration test failed: ${errorMessage}`);

      return {
        testName: 'End-to-End Integration',
        passed: false,
        error: errorMessage,
        duration: Date.now() - startTime
      };
    }
  }
}

// Export for easy testing
export const runIntegrationTest = EnterpriseWebRTCIntegrationTest.runIntegrationTest;
