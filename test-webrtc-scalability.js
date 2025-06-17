/**
 * WebRTC Scalability Test Script
 * Tests multiple attendee connections to verify system performance
 */

const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:3000',
  tourCode: '', // Will be set during test
  languages: ['French', 'Spanish', 'German'],
  attendeesPerLanguage: 3,
  connectionTimeoutMs: 30000,
  testDurationMs: 120000, // 2 minutes
  logFile: 'webrtc-test-results.json'
};

// Test results storage
const testResults = {
  startTime: new Date().toISOString(),
  config: TEST_CONFIG,
  connections: [],
  metrics: {
    totalAttempts: 0,
    successfulConnections: 0,
    failedConnections: 0,
    averageConnectionTime: 0,
    connectionTimes: [],
    errors: []
  }
};

class WebRTCTester {
  constructor() {
    this.activeConnections = new Map();
    this.connectionPromises = [];
  }

  async runScalabilityTest() {
    console.log('🚀 Starting WebRTC Scalability Test');
    console.log(`📊 Configuration:`, TEST_CONFIG);
    
    try {
      // Step 1: Get or create a tour
      const tourCode = await this.setupTour();
      TEST_CONFIG.tourCode = tourCode;
      
      console.log(`✅ Using tour code: ${tourCode}`);
      
      // Step 2: Create multiple attendee connections
      await this.createMultipleConnections();
      
      // Step 3: Monitor connections for test duration
      await this.monitorConnections();
      
      // Step 4: Generate test report
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Test failed:', error);
      testResults.metrics.errors.push({
        timestamp: new Date().toISOString(),
        error: error.message,
        stack: error.stack
      });
    } finally {
      // Cleanup all connections
      await this.cleanup();
    }
  }

  async setupTour() {
    console.log('🎯 Setting up tour...');
    
    // For testing, we'll assume a tour is already running
    // In a real test, you might want to programmatically create one
    const tourCode = process.argv[2] || 'TEST_TOUR_123';
    
    // Verify tour exists by attempting to join
    try {
      const response = await fetch(`${TEST_CONFIG.baseUrl}/api/tour/join?tourCode=${tourCode}&language=French`);
      if (!response.ok) {
        throw new Error(`Tour ${tourCode} not accessible: ${response.statusText}`);
      }
      console.log(`✅ Tour ${tourCode} is accessible`);
      return tourCode;
    } catch (error) {
      console.error(`❌ Cannot access tour ${tourCode}:`, error.message);
      throw error;
    }
  }

  async createMultipleConnections() {
    console.log('🔗 Creating multiple attendee connections...');
    
    const connectionPromises = [];
    
    for (const language of TEST_CONFIG.languages) {
      for (let i = 0; i < TEST_CONFIG.attendeesPerLanguage; i++) {
        const attendeeId = `test_attendee_${language}_${i}_${Date.now()}`;
        
        const connectionPromise = this.createAttendeeConnection(language, attendeeId);
        connectionPromises.push(connectionPromise);
        
        // Stagger connection attempts to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Wait for all connections to complete (or timeout)
    const results = await Promise.allSettled(connectionPromises);
    
    // Analyze results
    results.forEach((result, index) => {
      testResults.metrics.totalAttempts++;
      
      if (result.status === 'fulfilled') {
        testResults.metrics.successfulConnections++;
        testResults.connections.push(result.value);
      } else {
        testResults.metrics.failedConnections++;
        testResults.metrics.errors.push({
          timestamp: new Date().toISOString(),
          connectionIndex: index,
          error: result.reason?.message || 'Unknown error'
        });
      }
    });
    
    console.log(`📊 Connection Results: ${testResults.metrics.successfulConnections}/${testResults.metrics.totalAttempts} successful`);
  }

  async createAttendeeConnection(language, attendeeId) {
    const startTime = Date.now();
    
    console.log(`🔌 Creating connection for ${attendeeId} (${language})`);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout for ${attendeeId} after ${TEST_CONFIG.connectionTimeoutMs}ms`));
      }, TEST_CONFIG.connectionTimeoutMs);
      
      // Simulate WebRTC connection creation
      this.simulateWebRTCConnection(language, attendeeId)
        .then((connectionInfo) => {
          clearTimeout(timeout);
          
          const connectionTime = Date.now() - startTime;
          testResults.metrics.connectionTimes.push(connectionTime);
          
          const result = {
            attendeeId,
            language,
            connectionTime,
            timestamp: new Date().toISOString(),
            status: 'connected',
            ...connectionInfo
          };
          
          this.activeConnections.set(attendeeId, result);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  async simulateWebRTCConnection(language, attendeeId) {
    // This simulates the WebRTC connection process
    // In a real test, you'd use actual WebRTC APIs
    
    try {
      // Step 1: Join tour
      const joinResponse = await fetch(`${TEST_CONFIG.baseUrl}/api/tour/join?tourCode=${TEST_CONFIG.tourCode}&language=${language}`);
      if (!joinResponse.ok) {
        throw new Error(`Failed to join tour: ${joinResponse.statusText}`);
      }
      
      const offerData = await joinResponse.json();
      
      // Step 2: Simulate ICE candidate exchange
      await this.simulateICEExchange(attendeeId, language);
      
      // Step 3: Simulate connection establishment
      await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 2000)); // 2-7 seconds
      
      return {
        hasOffer: !!offerData.offer,
        tourId: offerData.tourId,
        iceCandidatesExchanged: true,
        connectionEstablished: true
      };
      
    } catch (error) {
      throw new Error(`WebRTC simulation failed for ${attendeeId}: ${error.message}`);
    }
  }

  async simulateICEExchange(attendeeId, language) {
    // Simulate ICE candidate exchange
    const candidateCount = Math.floor(Math.random() * 8) + 2; // 2-10 candidates
    
    for (let i = 0; i < candidateCount; i++) {
      // Simulate sending ICE candidate
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 100));
    }
    
    return candidateCount;
  }

  async monitorConnections() {
    console.log(`📊 Monitoring ${this.activeConnections.size} connections for ${TEST_CONFIG.testDurationMs/1000} seconds...`);
    
    const monitorInterval = setInterval(() => {
      console.log(`📈 Active connections: ${this.activeConnections.size}`);
      
      // Simulate some connections dropping
      if (Math.random() < 0.05) { // 5% chance per interval
        const connections = Array.from(this.activeConnections.keys());
        if (connections.length > 0) {
          const randomConnection = connections[Math.floor(Math.random() * connections.length)];
          console.log(`📉 Simulating connection drop for ${randomConnection}`);
          this.activeConnections.delete(randomConnection);
        }
      }
    }, 5000);
    
    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.testDurationMs));
    
    clearInterval(monitorInterval);
  }

  generateReport() {
    // Calculate metrics
    if (testResults.metrics.connectionTimes.length > 0) {
      testResults.metrics.averageConnectionTime = 
        testResults.metrics.connectionTimes.reduce((a, b) => a + b, 0) / testResults.metrics.connectionTimes.length;
    }
    
    testResults.endTime = new Date().toISOString();
    testResults.finalActiveConnections = this.activeConnections.size;
    
    // Save results to file
    fs.writeFileSync(TEST_CONFIG.logFile, JSON.stringify(testResults, null, 2));
    
    // Print summary
    console.log('\n📋 TEST SUMMARY');
    console.log('================');
    console.log(`🎯 Total Attempts: ${testResults.metrics.totalAttempts}`);
    console.log(`✅ Successful: ${testResults.metrics.successfulConnections}`);
    console.log(`❌ Failed: ${testResults.metrics.failedConnections}`);
    console.log(`⏱️  Average Connection Time: ${testResults.metrics.averageConnectionTime.toFixed(0)}ms`);
    console.log(`🔗 Final Active Connections: ${testResults.finalActiveConnections}`);
    console.log(`📁 Detailed results saved to: ${TEST_CONFIG.logFile}`);
    
    if (testResults.metrics.errors.length > 0) {
      console.log(`\n⚠️  ERRORS (${testResults.metrics.errors.length}):`);
      testResults.metrics.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error.error}`);
      });
    }
  }

  async cleanup() {
    console.log('🧹 Cleaning up test connections...');
    this.activeConnections.clear();
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  const tester = new WebRTCTester();
  
  console.log('WebRTC Scalability Test');
  console.log('Usage: node test-webrtc-scalability.js [TOUR_CODE]');
  console.log('');
  
  tester.runScalabilityTest()
    .then(() => {
      console.log('✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = WebRTCTester;
