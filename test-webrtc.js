#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_RESULTS_DIR = './test-results';

// Ensure test results directory exists
if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
}

class WebRTCTestRunner {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            tests: [],
            summary: {
                total: 0,
                passed: 0,
                failed: 0
            }
        };
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

    async runTests() {
        await this.log('Starting WebRTC connectivity tests...');

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--use-fake-ui-for-media-stream',
                    '--use-fake-device-for-media-stream'
                ]
            });

            // Test 1: Application accessibility
            await this.testApplicationAccess(browser);

            // Test 2: Guide page functionality
            await this.testGuidePageSetup(browser);

            // Test 3: Attendee page functionality  
            await this.testAttendeePageSetup(browser);

            // Test 4: WebRTC connection between guide and attendee
            await this.testWebRTCConnection(browser);

        } catch (error) {
            await this.addTestResult('Test Suite Execution', 'FAIL', { 
                error: error.message 
            });
        } finally {
            if (browser) {
                await browser.close();
            }
        }

        await this.saveResults();
        await this.printSummary();
    }

    async testApplicationAccess(browser) {
        try {
            const page = await browser.newPage();
            
            const response = await page.goto(TEST_BASE_URL, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            if (response.status() === 200) {
                await this.addTestResult('Application Access', 'PASS', {
                    url: TEST_BASE_URL,
                    status: response.status()
                });
            } else {
                await this.addTestResult('Application Access', 'FAIL', {
                    error: `HTTP ${response.status()}`
                });
            }

            await page.close();
        } catch (error) {
            await this.addTestResult('Application Access', 'FAIL', {
                error: error.message
            });
        }
    }

    async testGuidePageSetup(browser) {
        try {
            const page = await browser.newPage();
            
            // Enable console logging
            page.on('console', msg => {
                if (msg.text().includes('WebSocket') || msg.text().includes('ICE')) {
                    console.log(`Guide Console: ${msg.text()}`);
                }
            });

            await page.goto(`${TEST_BASE_URL}/guide`, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Wait for WebRTC setup
            await page.waitForTimeout(5000);

            // Check for WebSocket connection
            const hasWebSocket = await page.evaluate(() => {
                return window.signalingClient && window.signalingClient.isConnected;
            });

            if (hasWebSocket) {
                await this.addTestResult('Guide WebSocket Setup', 'PASS');
            } else {
                await this.addTestResult('Guide WebSocket Setup', 'FAIL', {
                    error: 'WebSocket not connected'
                });
            }

            await page.close();
        } catch (error) {
            await this.addTestResult('Guide WebSocket Setup', 'FAIL', {
                error: error.message
            });
        }
    }

    async testAttendeePageSetup(browser) {
        try {
            const page = await browser.newPage();
            
            // Enable console logging
            page.on('console', msg => {
                if (msg.text().includes('WebSocket') || msg.text().includes('ICE')) {
                    console.log(`Attendee Console: ${msg.text()}`);
                }
            });

            await page.goto(`${TEST_BASE_URL}/attendee`, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Wait for WebRTC setup
            await page.waitForTimeout(5000);

            // Check for WebSocket connection
            const hasWebSocket = await page.evaluate(() => {
                return window.signalingClient && window.signalingClient.isConnected;
            });

            if (hasWebSocket) {
                await this.addTestResult('Attendee WebSocket Setup', 'PASS');
            } else {
                await this.addTestResult('Attendee WebSocket Setup', 'FAIL', {
                    error: 'WebSocket not connected'
                });
            }

            await page.close();
        } catch (error) {
            await this.addTestResult('Attendee WebSocket Setup', 'FAIL', {
                error: error.message
            });
        }
    }

    async testWebRTCConnection(browser) {
        let guidePage, attendeePage;
        
        try {
            // Create guide page
            guidePage = await browser.newPage();
            await guidePage.goto(`${TEST_BASE_URL}/guide`, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Create attendee page
            attendeePage = await browser.newPage();
            await attendeePage.goto(`${TEST_BASE_URL}/attendee`, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Wait for initial setup
            await Promise.all([
                guidePage.waitForTimeout(3000),
                attendeePage.waitForTimeout(3000)
            ]);

            // Start tour session on guide
            await guidePage.evaluate(() => {
                // Simulate starting a tour
                if (window.startTour) {
                    window.startTour();
                }
            });

            // Join tour on attendee
            await attendeePage.evaluate(() => {
                // Simulate joining a tour
                if (window.joinTour) {
                    window.joinTour();
                }
            });

            // Wait for WebRTC connection establishment
            await Promise.all([
                guidePage.waitForTimeout(10000),
                attendeePage.waitForTimeout(10000)
            ]);

            // Check connection status on both sides
            const guideConnectionStatus = await guidePage.evaluate(() => {
                if (window.iceMonitor) {
                    return window.iceMonitor.getStatus();
                }
                return { connected: false };
            });

            const attendeeConnectionStatus = await attendeePage.evaluate(() => {
                if (window.iceMonitor) {
                    return window.iceMonitor.getStatus();
                }
                return { connected: false };
            });

            if (guideConnectionStatus.connected && attendeeConnectionStatus.connected) {
                await this.addTestResult('WebRTC Connection', 'PASS', {
                    guideStatus: guideConnectionStatus,
                    attendeeStatus: attendeeConnectionStatus
                });
            } else {
                await this.addTestResult('WebRTC Connection', 'FAIL', {
                    error: 'Connection not established',
                    guideStatus: guideConnectionStatus,
                    attendeeStatus: attendeeConnectionStatus
                });
            }

        } catch (error) {
            await this.addTestResult('WebRTC Connection', 'FAIL', {
                error: error.message
            });
        } finally {
            if (guidePage) await guidePage.close();
            if (attendeePage) await attendeePage.close();
        }
    }

    async saveResults() {
        const resultsFile = path.join(TEST_RESULTS_DIR, `webrtc-test-${Date.now()}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
        await this.log(`Test results saved to: ${resultsFile}`);
    }

    async printSummary() {
        await this.log('\n=== TEST SUMMARY ===');
        await this.log(`Total Tests: ${this.results.summary.total}`);
        await this.log(`Passed: ${this.results.summary.passed}`);
        await this.log(`Failed: ${this.results.summary.failed}`);
        await this.log(`Success Rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);

        if (this.results.summary.failed > 0) {
            await this.log('\n=== FAILED TESTS ===');
            this.results.tests
                .filter(test => test.status === 'FAIL')
                .forEach(test => {
                    console.log(`❌ ${test.name}: ${test.details.error || 'Unknown error'}`);
                });
        }

        // Exit with error code if tests failed
        process.exit(this.results.summary.failed > 0 ? 1 : 0);
    }
}

// Add puppeteer to package.json if not present
async function ensurePuppeteerDependency() {
    const packageJsonPath = './package.json';
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    if (!packageJson.devDependencies) {
        packageJson.devDependencies = {};
    }
    
    if (!packageJson.devDependencies.puppeteer) {
        packageJson.devDependencies.puppeteer = '^21.0.0';
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log('Added puppeteer to devDependencies');
    }

    if (!packageJson.scripts['test:webrtc']) {
        packageJson.scripts['test:webrtc'] = 'node test-webrtc.js';
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log('Added test:webrtc script');
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    const testRunner = new WebRTCTestRunner();
    testRunner.runTests().catch(console.error);
}

module.exports = WebRTCTestRunner;