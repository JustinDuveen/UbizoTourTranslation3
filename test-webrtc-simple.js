#!/usr/bin/env node

// Simple WebRTC connectivity test without Puppeteer
const http = require('http');
const fs = require('fs');
const path = require('path');

const TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_RESULTS_DIR = './test-results';

// Ensure test results directory exists
if (!fs.existsSync(TEST_RESULTS_DIR)) {
    fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
}

class SimpleWebRTCTestRunner {
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

    async makeHttpRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = http.get(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ 
                    status: res.statusCode, 
                    data,
                    headers: res.headers 
                }));
            });
            
            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.abort();
                reject(new Error('Request timeout'));
            });
        });
    }

    async runTests() {
        await this.log('Starting Simple WebRTC connectivity tests...');

        try {
            // Test 1: Application health check
            await this.testApplicationHealth();

            // Test 2: API endpoints
            await this.testAPIEndpoints();

            // Test 3: WebSocket connectivity
            await this.testWebSocketEndpoint();

            // Test 4: Static assets
            await this.testStaticAssets();

        } catch (error) {
            await this.addTestResult('Test Suite Execution', 'FAIL', { 
                error: error.message 
            });
        }

        await this.saveResults();
        await this.printSummary();
    }

    async testApplicationHealth() {
        try {
            const response = await this.makeHttpRequest(TEST_BASE_URL);
            
            if (response.status === 200) {
                await this.addTestResult('Application Health Check', 'PASS', {
                    status: response.status,
                    contentLength: response.data.length
                });
            } else {
                await this.addTestResult('Application Health Check', 'FAIL', {
                    error: `HTTP ${response.status}`
                });
            }
        } catch (error) {
            await this.addTestResult('Application Health Check', 'FAIL', {
                error: error.message
            });
        }
    }

    async testAPIEndpoints() {
        const endpoints = [
            '/api/auth/check',
            '/api/session',
            '/api/tour/languages'
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await this.makeHttpRequest(`${TEST_BASE_URL}${endpoint}`);
                
                if (response.status < 500) {
                    await this.addTestResult(`API Endpoint ${endpoint}`, 'PASS', {
                        status: response.status
                    });
                } else {
                    await this.addTestResult(`API Endpoint ${endpoint}`, 'FAIL', {
                        error: `HTTP ${response.status}`
                    });
                }
            } catch (error) {
                await this.addTestResult(`API Endpoint ${endpoint}`, 'FAIL', {
                    error: error.message
                });
            }
        }
    }

    async testWebSocketEndpoint() {
        try {
            // Test WebSocket endpoint availability (just check if it responds)
            const response = await this.makeHttpRequest(`${TEST_BASE_URL}/socket.io/`);
            
            if (response.status === 400 || response.data.includes('socket.io')) {
                await this.addTestResult('WebSocket Endpoint Available', 'PASS', {
                    status: response.status,
                    hasSocketIO: response.data.includes('socket.io')
                });
            } else {
                await this.addTestResult('WebSocket Endpoint Available', 'FAIL', {
                    error: `Unexpected response: ${response.status}`
                });
            }
        } catch (error) {
            await this.addTestResult('WebSocket Endpoint Available', 'FAIL', {
                error: error.message
            });
        }
    }

    async testStaticAssets() {
        const assets = [
            '/guide',
            '/attendee'
        ];

        for (const asset of assets) {
            try {
                const response = await this.makeHttpRequest(`${TEST_BASE_URL}${asset}`);
                
                if (response.status === 200) {
                    await this.addTestResult(`Page ${asset}`, 'PASS', {
                        status: response.status,
                        contentLength: response.data.length
                    });
                } else {
                    await this.addTestResult(`Page ${asset}`, 'FAIL', {
                        error: `HTTP ${response.status}`
                    });
                }
            } catch (error) {
                await this.addTestResult(`Page ${asset}`, 'FAIL', {
                    error: error.message
                });
            }
        }
    }

    async saveResults() {
        const resultsFile = path.join(TEST_RESULTS_DIR, `simple-webrtc-test-${Date.now()}.json`);
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

        await this.log('\n=== RECOMMENDATIONS ===');
        if (this.results.summary.passed === this.results.summary.total) {
            await this.log('✅ All basic connectivity tests passed!');
            await this.log('🔍 For full WebRTC testing, install Chrome dependencies:');
            await this.log('   sudo apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxss1 libgtk-3-0 libasound2');
            await this.log('   Then run: node test-webrtc.js');
        } else {
            await this.log('⚠️  Some tests failed. Check application configuration.');
        }

        // Exit with error code if tests failed
        process.exit(this.results.summary.failed > 0 ? 1 : 0);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    const testRunner = new SimpleWebRTCTestRunner();
    testRunner.runTests().catch(console.error);
}

module.exports = SimpleWebRTCTestRunner;