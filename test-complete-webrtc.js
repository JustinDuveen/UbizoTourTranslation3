#!/usr/bin/env node

// Comprehensive WebRTC Testing Suite with Authentication
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_RESULTS_DIR = './test-results';

// Test credentials
const GUIDE_CREDENTIALS = {
    email: 'guide@test.com',
    password: 'password123',
    role: 'guide'
};

const ATTENDEE_CREDENTIALS = {
    email: 'attendee@test.com', 
    password: 'password123',
    role: 'attendee'
};

// Ensure test results directory exists
if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
}

class ComprehensiveWebRTCTestRunner {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            tests: [],
            summary: {
                total: 0,
                passed: 0,
                failed: 0
            },
            webrtcMetrics: {},
            authFlows: {}
        };
        this.browser = null;
    }

    async log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    async addTestResult(name, status, details = {}) {
        const result = {
            name,
            status,
            details,
            timestamp: new Date().toISOString()
        };
        
        this.results.tests.push(result);
        this.results.summary.total++;
        
        if (status === 'PASS') {
            this.results.summary.passed++;
            await this.log(`✅ ${name}`);
        } else {
            this.results.summary.failed++;
            await this.log(`❌ ${name}: ${details.error || 'Unknown error'}`);
        }
    }

    async setupBrowser() {
        try {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--use-fake-ui-for-media-stream',
                    '--use-fake-device-for-media-stream',
                    '--allow-running-insecure-content',
                    '--autoplay-policy=no-user-gesture-required'
                ]
            });
            await this.log('Browser launched successfully');
            return true;
        } catch (error) {
            await this.addTestResult('Browser Setup', 'FAIL', { error: error.message });
            return false;
        }
    }

    async createTestUsers() {
        try {
            const page = await this.browser.newPage();
            
            // Register guide user
            await page.goto(`${TEST_BASE_URL}/register`);
            await page.waitForSelector('input[name="email"]', { timeout: 10000 });
            
            await page.type('input[name="email"]', GUIDE_CREDENTIALS.email);
            await page.type('input[name="password"]', GUIDE_CREDENTIALS.password);
            await page.select('select[name="role"]', GUIDE_CREDENTIALS.role);
            await page.click('button[type="submit"]');
            
            // Wait for success or error
            await page.waitForTimeout(2000);
            
            // Register attendee user
            await page.goto(`${TEST_BASE_URL}/register`);
            await page.waitForSelector('input[name="email"]', { timeout: 10000 });
            
            await page.type('input[name="email"]', ATTENDEE_CREDENTIALS.email);
            await page.type('input[name="password"]', ATTENDEE_CREDENTIALS.password);
            await page.select('select[name="role"]', ATTENDEE_CREDENTIALS.role);
            await page.click('button[type="submit"]');
            
            await page.waitForTimeout(2000);
            await page.close();
            
            await this.addTestResult('Test User Creation', 'PASS');
            return true;
        } catch (error) {
            await this.addTestResult('Test User Creation', 'FAIL', { error: error.message });
            return false;
        }
    }

    async loginUser(credentials) {
        const page = await this.browser.newPage();
        
        try {
            await page.goto(`${TEST_BASE_URL}/login`);
            await page.waitForSelector('input[name="email"]', { timeout: 10000 });
            
            await page.type('input[name="email"]', credentials.email);
            await page.type('input[name="password"]', credentials.password);
            await page.click('button[type="submit"]');
            
            // Wait for redirect or success
            await page.waitForTimeout(3000);
            
            const currentUrl = page.url();
            if (currentUrl.includes('/guide') || currentUrl.includes('/attendee') || currentUrl.includes('/dashboard')) {
                await this.addTestResult(`Login ${credentials.role}`, 'PASS', { redirectUrl: currentUrl });
                return page;
            } else {
                await this.addTestResult(`Login ${credentials.role}`, 'FAIL', { 
                    error: 'No redirect after login',
                    currentUrl 
                });
                await page.close();
                return null;
            }
        } catch (error) {
            await this.addTestResult(`Login ${credentials.role}`, 'FAIL', { error: error.message });
            await page.close();
            return null;
        }
    }

    async testWebRTCSetup(page, userType) {
        try {
            // Setup console monitoring
            const consoleMessages = [];
            page.on('console', msg => {
                const text = msg.text();
                consoleMessages.push({
                    type: msg.type(),
                    text,
                    timestamp: new Date().toISOString()
                });
                
                if (text.includes('WebSocket') || text.includes('ICE') || text.includes('WebRTC')) {
                    console.log(`${userType} Console: ${text}`);
                }
            });

            // Navigate to appropriate page
            const targetPath = userType === 'guide' ? '/guide' : '/attendee';
            await page.goto(`${TEST_BASE_URL}${targetPath}`, { waitUntil: 'networkidle2' });
            
            // Wait for WebRTC initialization
            await page.waitForTimeout(5000);

            // Check for WebSocket connection
            const webSocketStatus = await page.evaluate(() => {
                return {
                    hasSignalingClient: typeof window.signalingClient !== 'undefined',
                    isConnected: window.signalingClient?.isConnected || false,
                    hasWebRTC: typeof window.RTCPeerConnection !== 'undefined'
                };
            });

            // Check for WebRTC components
            const webrtcElements = await page.evaluate(() => {
                return {
                    hasAudioElements: document.querySelectorAll('audio').length > 0,
                    hasWebRTCButtons: document.querySelectorAll('[class*="webrtc"], [id*="webrtc"]').length > 0,
                    hasLanguageSelector: document.querySelector('select') !== null
                };
            });

            const testResult = {
                consoleMessages: consoleMessages.filter(msg => 
                    msg.text.includes('WebSocket') || 
                    msg.text.includes('ICE') || 
                    msg.text.includes('WebRTC')
                ),
                webSocketStatus,
                webrtcElements
            };

            if (webSocketStatus.hasSignalingClient && webSocketStatus.hasWebRTC) {
                await this.addTestResult(`${userType} WebRTC Setup`, 'PASS', testResult);
                return { page, success: true, details: testResult };
            } else {
                await this.addTestResult(`${userType} WebRTC Setup`, 'FAIL', {
                    error: 'WebRTC components not found',
                    ...testResult
                });
                return { page, success: false, details: testResult };
            }
        } catch (error) {
            await this.addTestResult(`${userType} WebRTC Setup`, 'FAIL', { error: error.message });
            return { page, success: false, error: error.message };
        }
    }

    async testWebRTCConnection(guidePage, attendeePage) {
        try {
            await this.log('Starting WebRTC connection test...');
            
            // Set up monitoring on both pages
            const connectionEvents = {
                guide: [],
                attendee: []
            };

            const setupMonitoring = (page, userType) => {
                page.on('console', msg => {
                    const text = msg.text();
                    if (text.includes('ICE') || text.includes('connection')) {
                        connectionEvents[userType].push({
                            message: text,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            };

            setupMonitoring(guidePage, 'guide');
            setupMonitoring(attendeePage, 'attendee');

            // Start a tour session
            await guidePage.evaluate(() => {
                if (window.startTour) {
                    window.startTour();
                }
                // Try alternative ways to start tour
                const startButton = document.querySelector('button[id*="start"], button[class*="start"]');
                if (startButton) startButton.click();
            });

            await guidePage.waitForTimeout(2000);

            // Join the tour from attendee side
            await attendeePage.evaluate(() => {
                if (window.joinTour) {
                    window.joinTour();
                }
                // Try alternative ways to join tour
                const joinButton = document.querySelector('button[id*="join"], button[class*="join"]');
                if (joinButton) joinButton.click();
            });

            // Wait for connection establishment
            await Promise.all([
                guidePage.waitForTimeout(15000),
                attendeePage.waitForTimeout(15000)
            ]);

            // Check connection status
            const [guideStatus, attendeeStatus] = await Promise.all([
                guidePage.evaluate(() => {
                    const status = {
                        iceMonitor: window.iceMonitor?.getStatus() || null,
                        signalingConnected: window.signalingClient?.isConnected || false,
                        peerConnection: window.peerConnection?.connectionState || 'unknown'
                    };
                    
                    // Try to get more connection info
                    if (window.peerConnection) {
                        status.iceConnectionState = window.peerConnection.iceConnectionState;
                        status.iceGatheringState = window.peerConnection.iceGatheringState;
                    }
                    
                    return status;
                }),
                attendeePage.evaluate(() => {
                    const status = {
                        iceMonitor: window.iceMonitor?.getStatus() || null,
                        signalingConnected: window.signalingClient?.isConnected || false,
                        peerConnection: window.peerConnection?.connectionState || 'unknown'
                    };
                    
                    // Try to get more connection info
                    if (window.peerConnection) {
                        status.iceConnectionState = window.peerConnection.iceConnectionState;
                        status.iceGatheringState = window.peerConnection.iceGatheringState;
                    }
                    
                    return status;
                })
            ]);

            const connectionResult = {
                guideStatus,
                attendeeStatus,
                connectionEvents,
                timeline: {
                    testStart: new Date().toISOString(),
                    duration: '15 seconds'
                }
            };

            // Determine if connection was successful
            const guideConnected = guideStatus.iceConnectionState === 'connected' || 
                                 guideStatus.peerConnection === 'connected' ||
                                 guideStatus.iceMonitor?.connected;
                                 
            const attendeeConnected = attendeeStatus.iceConnectionState === 'connected' || 
                                    attendeeStatus.peerConnection === 'connected' ||
                                    attendeeStatus.iceMonitor?.connected;

            if (guideConnected && attendeeConnected) {
                await this.addTestResult('WebRTC P2P Connection', 'PASS', connectionResult);
                this.results.webrtcMetrics = connectionResult;
                return true;
            } else {
                await this.addTestResult('WebRTC P2P Connection', 'FAIL', {
                    error: 'Connection not established',
                    ...connectionResult
                });
                this.results.webrtcMetrics = connectionResult;
                return false;
            }
            
        } catch (error) {
            await this.addTestResult('WebRTC P2P Connection', 'FAIL', { error: error.message });
            return false;
        }
    }

    async runTests() {
        await this.log('Starting Comprehensive WebRTC Test Suite...');

        try {
            // Setup browser
            if (!(await this.setupBrowser())) {
                return;
            }

            // Create test users
            await this.createTestUsers();

            // Login both users
            const guidePage = await this.loginUser(GUIDE_CREDENTIALS);
            const attendeePage = await this.loginUser(ATTENDEE_CREDENTIALS);

            if (!guidePage || !attendeePage) {
                await this.addTestResult('User Authentication', 'FAIL', { 
                    error: 'Failed to login one or both users' 
                });
                return;
            }

            // Test WebRTC setup for both users
            const guideSetup = await this.testWebRTCSetup(guidePage, 'guide');
            const attendeeSetup = await this.testWebRTCSetup(attendeePage, 'attendee');

            if (guideSetup.success && attendeeSetup.success) {
                // Test actual WebRTC connection
                await this.testWebRTCConnection(guidePage, attendeePage);
            }

            // Store auth flow details
            this.results.authFlows = {
                guideAuth: guideSetup.success,
                attendeeAuth: attendeeSetup.success,
                guideDetails: guideSetup.details,
                attendeeDetails: attendeeSetup.details
            };

            // Close pages
            await guidePage.close();
            await attendeePage.close();

        } catch (error) {
            await this.addTestResult('Test Suite Execution', 'FAIL', { 
                error: error.message 
            });
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }

        await this.saveResults();
        await this.printSummary();
    }

    async saveResults() {
        const resultsFile = path.join(TEST_RESULTS_DIR, `comprehensive-webrtc-test-${Date.now()}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
        await this.log(`Test results saved to: ${resultsFile}`);
    }

    async printSummary() {
        await this.log('\n=== COMPREHENSIVE TEST SUMMARY ===');
        await this.log(`Total Tests: ${this.results.summary.total}`);
        await this.log(`Passed: ${this.results.summary.passed}`);
        await this.log(`Failed: ${this.results.summary.failed}`);
        await this.log(`Success Rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);

        // WebRTC specific summary
        if (this.results.webrtcMetrics) {
            await this.log('\n=== WEBRTC CONNECTION ANALYSIS ===');
            await this.log(`Guide ICE State: ${this.results.webrtcMetrics.guideStatus?.iceConnectionState || 'unknown'}`);
            await this.log(`Attendee ICE State: ${this.results.webrtcMetrics.attendeeStatus?.iceConnectionState || 'unknown'}`);
            await this.log(`Guide Signaling: ${this.results.webrtcMetrics.guideStatus?.signalingConnected ? 'Connected' : 'Disconnected'}`);
            await this.log(`Attendee Signaling: ${this.results.webrtcMetrics.attendeeStatus?.signalingConnected ? 'Connected' : 'Disconnected'}`);
        }

        if (this.results.summary.failed > 0) {
            await this.log('\n=== FAILED TESTS ===');
            this.results.tests
                .filter(test => test.status === 'FAIL')
                .forEach(test => {
                    console.log(`❌ ${test.name}: ${test.details.error || 'Unknown error'}`);
                });
        }

        await this.log('\n=== RECOMMENDATIONS ===');
        if (this.results.summary.passed === this.results.summary.total) {
            await this.log('🎉 All tests passed! WebRTC connection is working correctly.');
        } else {
            await this.log('🔧 Issues found. Check the detailed results for debugging information.');
            await this.log('📋 Common fixes:');
            await this.log('   1. Ensure users are registered with correct roles');
            await this.log('   2. Check WebSocket server is running');
            await this.log('   3. Verify STUN/TURN server configuration');
            await this.log('   4. Check browser permissions for media access');
        }

        // Exit with error code if tests failed
        process.exit(this.results.summary.failed > 0 ? 1 : 0);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    const testRunner = new ComprehensiveWebRTCTestRunner();
    testRunner.runTests().catch(console.error);
}

module.exports = ComprehensiveWebRTCTestRunner;