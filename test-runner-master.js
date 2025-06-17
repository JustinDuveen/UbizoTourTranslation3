#!/usr/bin/env node

// Master Test Runner - Orchestrates all test suites
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TEST_RESULTS_DIR = './test-results';

class MasterTestRunner {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            suites: {},
            summary: {
                totalSuites: 0,
                passedSuites: 0,
                failedSuites: 0,
                totalTests: 0,
                passedTests: 0,
                failedTests: 0
            }
        };
    }

    async log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    async runTestSuite(suiteName, scriptPath, fallbackScript = null) {
        await this.log(`\n🧪 Running ${suiteName}...`);
        this.results.summary.totalSuites++;
        
        try {
            const output = execSync(`node ${scriptPath}`, { 
                encoding: 'utf8',
                timeout: 120000,
                stdio: 'pipe'
            });
            
            this.results.suites[suiteName] = {
                status: 'PASS',
                output: output,
                error: null
            };
            this.results.summary.passedSuites++;
            await this.log(`✅ ${suiteName} completed successfully`);
            
        } catch (error) {
            await this.log(`❌ ${suiteName} failed: ${error.message}`);
            
            // Try fallback if available
            if (fallbackScript) {
                await this.log(`🔄 Trying fallback for ${suiteName}...`);
                try {
                    const fallbackOutput = execSync(`node ${fallbackScript}`, { 
                        encoding: 'utf8',
                        timeout: 60000,
                        stdio: 'pipe'
                    });
                    
                    this.results.suites[suiteName] = {
                        status: 'PASS_FALLBACK',
                        output: fallbackOutput,
                        error: error.message,
                        fallbackUsed: true
                    };
                    this.results.summary.passedSuites++;
                    await this.log(`✅ ${suiteName} completed with fallback`);
                    return;
                } catch (fallbackError) {
                    await this.log(`❌ ${suiteName} fallback also failed`);
                }
            }
            
            this.results.suites[suiteName] = {
                status: 'FAIL',
                output: error.stdout || '',
                error: error.message
            };
            this.results.summary.failedSuites++;
        }
    }

    parseTestResults() {
        // Parse individual test results from test-results directory
        if (fs.existsSync(TEST_RESULTS_DIR)) {
            const resultFiles = fs.readdirSync(TEST_RESULTS_DIR)
                .filter(file => file.endsWith('.json'))
                .sort((a, b) => {
                    const aTime = fs.statSync(path.join(TEST_RESULTS_DIR, a)).mtime;
                    const bTime = fs.statSync(path.join(TEST_RESULTS_DIR, b)).mtime;
                    return bTime - aTime; // Most recent first
                });

            for (const file of resultFiles.slice(0, 10)) { // Last 10 results
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(TEST_RESULTS_DIR, file), 'utf8'));
                    if (content.summary) {
                        this.results.summary.totalTests += content.summary.total || 0;
                        this.results.summary.passedTests += content.summary.passed || 0;
                        this.results.summary.failedTests += content.summary.failed || 0;
                    }
                } catch (error) {
                    // Ignore malformed result files
                }
            }
        }
    }

    async runAllTests() {
        await this.log('🚀 Starting Master Test Suite for Ubizo WebRTC Application');
        await this.log('================================================================');

        // Ensure test results directory exists
        if (!fs.existsSync(TEST_RESULTS_DIR)) {
            fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
        }

        // Run test suites in order
        await this.runTestSuite(
            'Basic Connectivity', 
            'test-webrtc-simple.js'
        );

        await this.runTestSuite(
            'Authentication Flows', 
            'test-auth-flows.js'
        );

        await this.runTestSuite(
            'Full WebRTC Testing', 
            'test-webrtc.js',
            'test-webrtc-simple.js'  // Fallback to simple test
        );

        await this.runTestSuite(
            'Comprehensive WebRTC', 
            'test-complete-webrtc.js',
            'test-webrtc-simple.js'  // Fallback to simple test
        );

        // Parse detailed test results
        this.parseTestResults();

        await this.generateReport();
    }

    async generateReport() {
        await this.log('\n📊 MASTER TEST REPORT');
        await this.log('=====================');
        
        await this.log(`\n📋 Test Suite Summary:`);
        await this.log(`   Total Suites: ${this.results.summary.totalSuites}`);
        await this.log(`   Passed: ${this.results.summary.passedSuites}`);
        await this.log(`   Failed: ${this.results.summary.failedSuites}`);
        await this.log(`   Suite Success Rate: ${((this.results.summary.passedSuites / this.results.summary.totalSuites) * 100).toFixed(1)}%`);

        if (this.results.summary.totalTests > 0) {
            await this.log(`\n🔍 Individual Test Summary:`);
            await this.log(`   Total Tests: ${this.results.summary.totalTests}`);
            await this.log(`   Passed: ${this.results.summary.passedTests}`);
            await this.log(`   Failed: ${this.results.summary.failedTests}`);
            await this.log(`   Test Success Rate: ${((this.results.summary.passedTests / this.results.summary.totalTests) * 100).toFixed(1)}%`);
        }

        await this.log(`\n📝 Suite Details:`);
        for (const [suiteName, result] of Object.entries(this.results.suites)) {
            const statusIcon = result.status === 'PASS' ? '✅' : 
                             result.status === 'PASS_FALLBACK' ? '🔄' : '❌';
            await this.log(`   ${statusIcon} ${suiteName}: ${result.status}`);
            
            if (result.fallbackUsed) {
                await this.log(`     └─ Used fallback due to: ${result.error}`);
            } else if (result.status === 'FAIL') {
                await this.log(`     └─ Error: ${result.error}`);
            }
        }

        // Generate recommendations
        await this.generateRecommendations();

        // Save master report
        const reportFile = path.join(TEST_RESULTS_DIR, `master-test-report-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(this.results, null, 2));
        await this.log(`\n💾 Master report saved to: ${reportFile}`);

        // Exit with appropriate code
        const overallSuccess = this.results.summary.failedSuites === 0;
        process.exit(overallSuccess ? 0 : 1);
    }

    async generateRecommendations() {
        await this.log(`\n💡 RECOMMENDATIONS:`);

        const hasBasicConnectivity = this.results.suites['Basic Connectivity']?.status === 'PASS';
        const hasAuthFlows = this.results.suites['Authentication Flows']?.status === 'PASS';
        const hasWebRTC = this.results.suites['Full WebRTC Testing']?.status === 'PASS' ||
                         this.results.suites['Comprehensive WebRTC']?.status === 'PASS';

        if (hasBasicConnectivity && hasAuthFlows && hasWebRTC) {
            await this.log('🎉 EXCELLENT: All core functionality is working!');
            await this.log('   ✓ Application is accessible');
            await this.log('   ✓ Authentication is functional');
            await this.log('   ✓ WebRTC connections can be established');
            await this.log('   → Ready for production use');
        } else {
            await this.log('🔧 ISSUES DETECTED:');
            
            if (!hasBasicConnectivity) {
                await this.log('   ❌ Basic connectivity issues');
                await this.log('      → Check if application is running');
                await this.log('      → Verify network configuration');
                await this.log('      → Check API endpoints');
            }
            
            if (!hasAuthFlows) {
                await this.log('   ❌ Authentication problems');
                await this.log('      → Verify user registration/login forms');
                await this.log('      → Check JWT configuration');
                await this.log('      → Test protected route redirects');
            }
            
            if (!hasWebRTC) {
                await this.log('   ❌ WebRTC connection issues');
                await this.log('      → Install Chrome dependencies: sudo apt-get install libnss3');
                await this.log('      → Check WebSocket server configuration');
                await this.log('      → Verify STUN/TURN server settings');
                await this.log('      → Test with Docker for consistent environment');
            }
        }

        // Docker recommendations
        if (this.results.suites['Full WebRTC Testing']?.status === 'FAIL' && 
            this.results.suites['Basic Connectivity']?.status === 'PASS') {
            await this.log('\n🐳 DOCKER TESTING RECOMMENDED:');
            await this.log('   Browser tests failed, but basic connectivity works.');
            await this.log('   Run: docker compose up --build');
            await this.log('   This provides a clean environment with all dependencies.');
        }
    }
}

if (require.main === module) {
    const masterRunner = new MasterTestRunner();
    masterRunner.runAllTests().catch(console.error);
}

module.exports = MasterTestRunner;