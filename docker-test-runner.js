#!/usr/bin/env node

// Docker-based Test Runner for environments without Chrome dependencies
const { execSync } = require('child_process');
const fs = require('fs');

class DockerTestRunner {
    constructor() {
        this.hasDocker = false;
        this.results = {
            timestamp: new Date().toISOString(),
            environment: 'unknown',
            tests: {},
            summary: { total: 0, passed: 0, failed: 0 }
        };
    }

    async log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    checkDocker() {
        try {
            execSync('docker --version', { stdio: 'pipe' });
            this.hasDocker = true;
            this.results.environment = 'docker';
            return true;
        } catch (error) {
            this.hasDocker = false;
            this.results.environment = 'local';
            return false;
        }
    }

    async runDockerTests() {
        await this.log('🐳 Running tests in Docker environment...');
        
        try {
            // Build containers
            await this.log('📦 Building Docker containers...');
            execSync('docker compose build', { stdio: 'inherit' });
            
            // Start services
            await this.log('🚀 Starting services...');
            execSync('docker compose up -d redis app', { stdio: 'inherit' });
            
            // Wait for health checks
            await this.log('⏳ Waiting for services to be healthy...');
            let attempts = 0;
            let healthy = false;
            
            while (attempts < 30 && !healthy) {
                try {
                    execSync('docker compose exec app curl -f http://localhost:3000/', { 
                        stdio: 'pipe',
                        timeout: 5000 
                    });
                    healthy = true;
                } catch (error) {
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            if (!healthy) {
                throw new Error('Services failed to become healthy');
            }
            
            await this.log('✅ Services are healthy');
            
            // Run the test container
            await this.log('🧪 Running WebRTC tests in container...');
            const testOutput = execSync('docker compose run --rm test-runner', { 
                encoding: 'utf8',
                timeout: 120000 
            });
            
            this.results.tests.dockerWebRTC = {
                status: 'PASS',
                output: testOutput
            };
            this.results.summary.total++;
            this.results.summary.passed++;
            
            await this.log('✅ Docker tests completed successfully');
            
        } catch (error) {
            this.results.tests.dockerWebRTC = {
                status: 'FAIL',
                error: error.message
            };
            this.results.summary.total++;
            this.results.summary.failed++;
            
            await this.log(`❌ Docker tests failed: ${error.message}`);
        } finally {
            try {
                await this.log('🧹 Cleaning up Docker containers...');
                execSync('docker compose down', { stdio: 'pipe' });
            } catch (cleanupError) {
                await this.log(`⚠️  Cleanup warning: ${cleanupError.message}`);
            }
        }
    }

    async runLocalFallbackTests() {
        await this.log('💻 Running local fallback tests...');
        
        // Test 1: Basic connectivity without browser
        try {
            const http = require('http');
            
            const testConnection = () => new Promise((resolve, reject) => {
                const req = http.get('http://localhost:3000/', (res) => {
                    resolve(res.statusCode === 200);
                });
                req.on('error', reject);
                req.setTimeout(5000, () => {
                    req.abort();
                    reject(new Error('Connection timeout'));
                });
            });
            
            const connected = await testConnection();
            
            this.results.tests.basicConnectivity = {
                status: connected ? 'PASS' : 'FAIL',
                details: { httpStatus: connected ? 200 : 'failed' }
            };
            this.results.summary.total++;
            if (connected) this.results.summary.passed++;
            else this.results.summary.failed++;
            
            await this.log(`${connected ? '✅' : '❌'} Basic connectivity test`);
            
        } catch (error) {
            this.results.tests.basicConnectivity = {
                status: 'FAIL',
                error: error.message
            };
            this.results.summary.total++;
            this.results.summary.failed++;
            await this.log(`❌ Basic connectivity failed: ${error.message}`);
        }
        
        // Test 2: API endpoints
        try {
            const testEndpoints = ['/api/session', '/api/auth/check', '/api/tour/languages'];
            let passedEndpoints = 0;
            
            for (const endpoint of testEndpoints) {
                try {
                    const http = require('http');
                    const testResult = await new Promise((resolve) => {
                        const req = http.get(`http://localhost:3000${endpoint}`, (res) => {
                            resolve(res.statusCode < 500);
                        });
                        req.on('error', () => resolve(false));
                        req.setTimeout(3000, () => {
                            req.abort();
                            resolve(false);
                        });
                    });
                    
                    if (testResult) passedEndpoints++;
                } catch (error) {
                    // Endpoint failed
                }
            }
            
            const allEndpointsPassed = passedEndpoints === testEndpoints.length;
            this.results.tests.apiEndpoints = {
                status: allEndpointsPassed ? 'PASS' : 'PARTIAL',
                details: { passed: passedEndpoints, total: testEndpoints.length }
            };
            this.results.summary.total++;
            if (allEndpointsPassed) this.results.summary.passed++;
            else this.results.summary.failed++;
            
            await this.log(`${allEndpointsPassed ? '✅' : '⚠️ '} API endpoints (${passedEndpoints}/${testEndpoints.length})`);
            
        } catch (error) {
            this.results.tests.apiEndpoints = {
                status: 'FAIL',
                error: error.message
            };
            this.results.summary.total++;
            this.results.summary.failed++;
        }
    }

    async run() {
        await this.log('🔍 Docker WebRTC Test Runner Starting...');
        
        if (this.checkDocker()) {
            await this.log('✅ Docker detected - using containerized testing');
            await this.runDockerTests();
        } else {
            await this.log('⚠️  Docker not available - using local fallback tests');
            await this.runLocalFallbackTests();
        }
        
        await this.generateReport();
    }

    async generateReport() {
        await this.log('\n📊 DOCKER TEST REPORT');
        await this.log('====================');
        
        await this.log(`Environment: ${this.results.environment}`);
        await this.log(`Total Tests: ${this.results.summary.total}`);
        await this.log(`Passed: ${this.results.summary.passed}`);
        await this.log(`Failed: ${this.results.summary.failed}`);
        await this.log(`Success Rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);
        
        await this.log('\n📝 Test Details:');
        for (const [testName, result] of Object.entries(this.results.tests)) {
            const statusIcon = result.status === 'PASS' ? '✅' : 
                             result.status === 'PARTIAL' ? '⚠️ ' : '❌';
            await this.log(`   ${statusIcon} ${testName}: ${result.status}`);
            
            if (result.error) {
                await this.log(`      └─ Error: ${result.error}`);
            }
            if (result.details) {
                await this.log(`      └─ Details: ${JSON.stringify(result.details)}`);
            }
        }
        
        await this.log('\n💡 RECOMMENDATIONS:');
        if (this.results.environment === 'docker' && this.results.summary.passed > 0) {
            await this.log('🎉 Docker environment working! This is the recommended testing approach.');
            await this.log('   → Use "docker compose up --build" for development');
            await this.log('   → All WebRTC dependencies are included in containers');
        } else if (this.results.environment === 'local') {
            await this.log('🔧 Local testing limitations detected:');
            await this.log('   → Install Docker for full WebRTC testing');
            await this.log('   → Or install Chrome dependencies: sudo apt-get install libnss3');
            await this.log('   → Current tests verify basic application functionality');
        }
        
        // Save results
        const reportFile = `./test-results/docker-test-report-${Date.now()}.json`;
        if (!fs.existsSync('./test-results')) {
            fs.mkdirSync('./test-results', { recursive: true });
        }
        fs.writeFileSync(reportFile, JSON.stringify(this.results, null, 2));
        await this.log(`\n💾 Report saved to: ${reportFile}`);
        
        process.exit(this.results.summary.failed > 0 ? 1 : 0);
    }
}

if (require.main === module) {
    const runner = new DockerTestRunner();
    runner.run().catch(console.error);
}

module.exports = DockerTestRunner;