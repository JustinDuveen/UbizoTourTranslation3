#!/usr/bin/env node

// Docker Environment Simulation Test
// Tests the application as if running in Docker containers
const http = require('http');
const fs = require('fs');
const path = require('path');

class DockerSimulationTest {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            environment: 'docker-simulation',
            tests: {},
            summary: { total: 0, passed: 0, failed: 0 },
            recommendations: []
        };
        this.baseUrl = 'http://localhost:3000';
    }

    async log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    async addTestResult(name, status, details = {}) {
        this.results.tests[name] = { status, details, timestamp: new Date().toISOString() };
        this.results.summary.total++;
        
        if (status === 'PASS') {
            this.results.summary.passed++;
            await this.log(`✅ ${name}`);
        } else {
            this.results.summary.failed++;
            await this.log(`❌ ${name}: ${details.error || 'Unknown error'}`);
        }
    }

    async makeRequest(path, options = {}) {
        return new Promise((resolve, reject) => {
            const url = `${this.baseUrl}${path}`;
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

    async testApplicationHealth() {
        try {
            const response = await this.makeRequest('/');
            
            if (response.status === 200) {
                await this.addTestResult('Application Health', 'PASS', {
                    status: response.status,
                    hasContent: response.data.length > 0,
                    containsReact: response.data.includes('React') || response.data.includes('Next')
                });
            } else {
                await this.addTestResult('Application Health', 'FAIL', {
                    error: `HTTP ${response.status}`
                });
            }
        } catch (error) {
            await this.addTestResult('Application Health', 'FAIL', {
                error: error.message
            });
        }
    }

    async testCORSConfiguration() {
        try {
            const response = await this.makeRequest('/socket.io/');
            
            // Check if CORS headers are present
            const corsHeaders = {
                'access-control-allow-origin': response.headers['access-control-allow-origin'],
                'access-control-allow-credentials': response.headers['access-control-allow-credentials']
            };
            
            const hasCORS = corsHeaders['access-control-allow-origin'] !== undefined;
            
            await this.addTestResult('CORS Configuration', hasCORS ? 'PASS' : 'FAIL', {
                corsHeaders,
                socketIOStatus: response.status,
                hasCORSSupport: hasCORS
            });
        } catch (error) {
            await this.addTestResult('CORS Configuration', 'FAIL', {
                error: error.message
            });
        }
    }

    async testWebSocketEndpoint() {
        try {
            const response = await this.makeRequest('/socket.io/');
            
            // Socket.IO endpoint should return 400 with Socket.IO message
            const isSocketIOEndpoint = response.status === 400 || 
                                     response.data.includes('socket.io') ||
                                     response.data.includes('Socket.IO');
            
            await this.addTestResult('WebSocket Endpoint', isSocketIOEndpoint ? 'PASS' : 'FAIL', {
                status: response.status,
                responseContainsSocketIO: response.data.includes('socket.io'),
                responseSnippet: response.data.substring(0, 100)
            });
        } catch (error) {
            await this.addTestResult('WebSocket Endpoint', 'FAIL', {
                error: error.message
            });
        }
    }

    async testAPIEndpoints() {
        const endpoints = [
            { path: '/api/session', expectedStatus: [200, 401, 403] },
            { path: '/api/auth/check', expectedStatus: [200, 401, 403] },
            { path: '/api/tour/languages', expectedStatus: [200, 401, 403] }
        ];

        let passedEndpoints = 0;

        for (const endpoint of endpoints) {
            try {
                const response = await this.makeRequest(endpoint.path);
                
                const statusOK = endpoint.expectedStatus.includes(response.status);
                const hasJSONResponse = response.data.startsWith('{') || response.data.startsWith('[');
                
                if (statusOK) {
                    passedEndpoints++;
                    await this.addTestResult(`API ${endpoint.path}`, 'PASS', {
                        status: response.status,
                        hasJSONResponse
                    });
                } else {
                    await this.addTestResult(`API ${endpoint.path}`, 'FAIL', {
                        error: `Unexpected status ${response.status}`,
                        expectedStatuses: endpoint.expectedStatus
                    });
                }
            } catch (error) {
                await this.addTestResult(`API ${endpoint.path}`, 'FAIL', {
                    error: error.message
                });
            }
        }

        const allEndpointsWorking = passedEndpoints === endpoints.length;
        await this.addTestResult('API Endpoints Overall', allEndpointsWorking ? 'PASS' : 'PARTIAL', {
            passedEndpoints,
            totalEndpoints: endpoints.length
        });
    }

    async testAuthenticationPages() {
        const authPages = [
            { path: '/login', shouldRedirect: false },
            { path: '/register', shouldRedirect: false },
            { path: '/guide', shouldRedirect: true },
            { path: '/attendee', shouldRedirect: true }
        ];

        for (const page of authPages) {
            try {
                const response = await this.makeRequest(page.path);
                
                if (page.shouldRedirect) {
                    // Should redirect to login (307 or 302)
                    const isRedirect = response.status === 307 || response.status === 302;
                    const redirectsToLogin = response.headers.location && response.headers.location.includes('/login');
                    
                    await this.addTestResult(`Auth Page ${page.path}`, isRedirect ? 'PASS' : 'FAIL', {
                        status: response.status,
                        redirectLocation: response.headers.location,
                        redirectsToLogin
                    });
                } else {
                    // Should be accessible (200)
                    const isAccessible = response.status === 200;
                    
                    await this.addTestResult(`Auth Page ${page.path}`, isAccessible ? 'PASS' : 'FAIL', {
                        status: response.status,
                        hasLoginForm: response.data.includes('email') && response.data.includes('password')
                    });
                }
            } catch (error) {
                await this.addTestResult(`Auth Page ${page.path}`, 'FAIL', {
                    error: error.message
                });
            }
        }
    }

    async testEnvironmentConfiguration() {
        try {
            // Check if environment variables would work in Docker
            const envFile = '.env.docker';
            const hasEnvFile = fs.existsSync(envFile);
            
            let envConfig = {};
            if (hasEnvFile) {
                const envContent = fs.readFileSync(envFile, 'utf8');
                envConfig = {
                    hasFile: true,
                    hasCORSOrigins: envContent.includes('CORS_ORIGINS'),
                    hasXirsysConfig: envContent.includes('XIRSYS_CHANNEL'),
                    hasJWTSecret: envContent.includes('JWT_SECRET'),
                    hasRedisURL: envContent.includes('REDIS_URL')
                };
            }

            await this.addTestResult('Environment Configuration', hasEnvFile ? 'PASS' : 'FAIL', {
                envFile,
                ...envConfig
            });
        } catch (error) {
            await this.addTestResult('Environment Configuration', 'FAIL', {
                error: error.message
            });
        }
    }

    async testDockerFiles() {
        const dockerFiles = [
            'Dockerfile',
            'docker-compose.yml',
            'Dockerfile.test',
            '.dockerignore'
        ];

        let dockerFilesFound = 0;
        const fileDetails = {};

        for (const file of dockerFiles) {
            try {
                const exists = fs.existsSync(file);
                if (exists) {
                    dockerFilesFound++;
                    const stats = fs.statSync(file);
                    fileDetails[file] = {
                        exists: true,
                        size: stats.size,
                        modified: stats.mtime
                    };
                } else {
                    fileDetails[file] = { exists: false };
                }
            } catch (error) {
                fileDetails[file] = { exists: false, error: error.message };
            }
        }

        const allDockerFilesPresent = dockerFilesFound === dockerFiles.length;
        await this.addTestResult('Docker Files', allDockerFilesPresent ? 'PASS' : 'PARTIAL', {
            filesFound: dockerFilesFound,
            totalFiles: dockerFiles.length,
            fileDetails
        });
    }

    async analyzeWebRTCReadiness() {
        try {
            // Check WebRTC-related files
            const webrtcFiles = [
                'lib/webrtc.ts',
                'lib/guideWebRTC.ts',
                'components/GuideWebRTCManager.tsx'
            ];

            let webrtcFilesFound = 0;
            const analysisResults = {};

            for (const file of webrtcFiles) {
                if (fs.existsSync(file)) {
                    webrtcFilesFound++;
                    const content = fs.readFileSync(file, 'utf8');
                    analysisResults[file] = {
                        exists: true,
                        hasSocketIO: content.includes('socket.io') || content.includes('Socket.IO'),
                        hasICEHandling: content.includes('ice-candidate') || content.includes('ICE'),
                        hasXirsysConfig: content.includes('xirsys') || content.includes('XIRSYS'),
                        hasTURNServers: content.includes('turn:') || content.includes('TURN')
                    };
                } else {
                    analysisResults[file] = { exists: false };
                }
            }

            await this.addTestResult('WebRTC Implementation', webrtcFilesFound > 0 ? 'PASS' : 'FAIL', {
                webrtcFilesFound,
                totalExpected: webrtcFiles.length,
                analysisResults
            });
        } catch (error) {
            await this.addTestResult('WebRTC Implementation', 'FAIL', {
                error: error.message
            });
        }
    }

    async generateDockerReadinessReport() {
        const dockerReady = this.results.tests['Docker Files']?.status === 'PASS' || 
                           this.results.tests['Docker Files']?.status === 'PARTIAL';
        
        const envReady = this.results.tests['Environment Configuration']?.status === 'PASS';
        
        const appHealthy = this.results.tests['Application Health']?.status === 'PASS';
        
        const corsConfigured = this.results.tests['CORS Configuration']?.status === 'PASS';

        await this.log('\n🐳 DOCKER READINESS ANALYSIS');
        await this.log('============================');

        if (dockerReady && envReady && appHealthy && corsConfigured) {
            await this.log('🎉 DOCKER READY: Application should work correctly in Docker!');
            this.results.recommendations.push('Ready for Docker deployment');
            this.results.recommendations.push('Configure Xirsys credentials in .env.docker for production WebRTC');
        } else {
            await this.log('⚠️  DOCKER ISSUES: Some configurations need attention');
            
            if (!dockerReady) {
                this.results.recommendations.push('Ensure all Docker files are present and configured');
            }
            if (!envReady) {
                this.results.recommendations.push('Configure .env.docker with required environment variables');
            }
            if (!appHealthy) {
                this.results.recommendations.push('Fix application health issues before Docker deployment');
            }
            if (!corsConfigured) {
                this.results.recommendations.push('Verify CORS configuration for Docker containers');
            }
        }
    }

    async run() {
        await this.log('🔍 Starting Docker Simulation Test Suite...');
        await this.log('===========================================');

        // Test application components
        await this.testApplicationHealth();
        await this.testCORSConfiguration();
        await this.testWebSocketEndpoint();
        await this.testAPIEndpoints();
        await this.testAuthenticationPages();
        
        // Test Docker readiness
        await this.testEnvironmentConfiguration();
        await this.testDockerFiles();
        await this.analyzeWebRTCReadiness();

        // Generate analysis
        await this.generateDockerReadinessReport();

        await this.generateFinalReport();
    }

    async generateFinalReport() {
        await this.log('\n📊 DOCKER SIMULATION TEST REPORT');
        await this.log('=================================');
        
        await this.log(`Environment: ${this.results.environment}`);
        await this.log(`Total Tests: ${this.results.summary.total}`);
        await this.log(`Passed: ${this.results.summary.passed}`);
        await this.log(`Failed: ${this.results.summary.failed}`);
        await this.log(`Success Rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);

        // Critical issues
        const criticalFailures = Object.entries(this.results.tests)
            .filter(([name, result]) => result.status === 'FAIL' && 
                    ['Application Health', 'CORS Configuration', 'WebSocket Endpoint'].includes(name));

        if (criticalFailures.length === 0) {
            await this.log('\n✅ NO CRITICAL ISSUES: Application core functionality working');
        } else {
            await this.log('\n🚨 CRITICAL ISSUES FOUND:');
            criticalFailures.forEach(([name, result]) => {
                console.log(`   ❌ ${name}: ${result.details.error || 'Unknown error'}`);
            });
        }

        // Recommendations
        await this.log('\n💡 RECOMMENDATIONS:');
        this.results.recommendations.forEach(rec => {
            console.log(`   • ${rec}`);
        });

        // Docker deployment guidance
        await this.log('\n🐳 DOCKER DEPLOYMENT GUIDANCE:');
        const successRate = (this.results.summary.passed / this.results.summary.total) * 100;
        
        if (successRate >= 90) {
            await this.log('🟢 HIGH CONFIDENCE: Docker deployment should work well');
            await this.log('   → Run: docker compose up --build');
            await this.log('   → Test WebRTC connections between guide and attendee');
        } else if (successRate >= 70) {
            await this.log('🟡 MEDIUM CONFIDENCE: Some issues need attention');
            await this.log('   → Fix issues above before Docker deployment');
            await this.log('   → Test thoroughly in Docker environment');
        } else {
            await this.log('🔴 LOW CONFIDENCE: Major issues need resolution');
            await this.log('   → Address critical failures first');
            await this.log('   → Consider local testing before Docker');
        }

        // Save results
        const reportFile = `./test-results/docker-simulation-${Date.now()}.json`;
        if (!fs.existsSync('./test-results')) {
            fs.mkdirSync('./test-results', { recursive: true });
        }
        fs.writeFileSync(reportFile, JSON.stringify(this.results, null, 2));
        await this.log(`\n💾 Report saved to: ${reportFile}`);

        process.exit(this.results.summary.failed > 0 ? 1 : 0);
    }
}

if (require.main === module) {
    const tester = new DockerSimulationTest();
    tester.run().catch(console.error);
}

module.exports = DockerSimulationTest;