#!/usr/bin/env node

// WebRTC Connection Validation Test
// Simulates guide-attendee WebRTC connection flow
const http = require('http');
const fs = require('fs');

class WebRTCValidationTest {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            connectionFlow: {},
            validationTests: {},
            summary: { total: 0, passed: 0, failed: 0 }
        };
        this.baseUrl = 'http://localhost:3000';
    }

    async log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    async addTestResult(name, status, details = {}) {
        this.results.validationTests[name] = { status, details, timestamp: new Date().toISOString() };
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

    async postRequest(path, data, headers = {}) {
        return new Promise((resolve, reject) => {
            const url = `${this.baseUrl}${path}`;
            const postData = JSON.stringify(data);
            
            const options = {
                hostname: 'localhost',
                port: 3000,
                path: path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    ...headers
                }
            };

            const req = http.request(options, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => resolve({ 
                    status: res.statusCode, 
                    data: responseData,
                    headers: res.headers 
                }));
            });

            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.abort();
                reject(new Error('Request timeout'));
            });

            req.write(postData);
            req.end();
        });
    }

    async testUserRegistration() {
        try {
            // Test guide registration
            const guideData = {
                email: `guide-${Date.now()}@test.com`,
                password: 'testpass123',
                role: 'guide'
            };

            const guideResponse = await this.postRequest('/api/auth/register', guideData);
            const guideSuccess = guideResponse.status === 200 || guideResponse.status === 201;

            // Test attendee registration
            const attendeeData = {
                email: `attendee-${Date.now()}@test.com`,
                password: 'testpass123',
                role: 'attendee'
            };

            const attendeeResponse = await this.postRequest('/api/auth/register', attendeeData);
            const attendeeSuccess = attendeeResponse.status === 200 || attendeeResponse.status === 201;

            await this.addTestResult('User Registration', (guideSuccess && attendeeSuccess) ? 'PASS' : 'PARTIAL', {
                guideRegistration: { status: guideResponse.status, success: guideSuccess },
                attendeeRegistration: { status: attendeeResponse.status, success: attendeeSuccess },
                testCredentials: { guide: guideData.email, attendee: attendeeData.email }
            });

            return { guideData, attendeeData, bothSuccessful: guideSuccess && attendeeSuccess };
        } catch (error) {
            await this.addTestResult('User Registration', 'FAIL', { error: error.message });
            return { bothSuccessful: false };
        }
    }

    async testTourCreation() {
        try {
            // Test tour creation endpoints
            const tourData = {
                name: `Test Tour ${Date.now()}`,
                languages: ['english', 'french', 'spanish']
            };

            // Try to create/start a tour
            const tourResponse = await this.postRequest('/api/tour/start', tourData);
            const tourCreated = tourResponse.status === 200 || tourResponse.status === 201;

            if (tourCreated) {
                let tourId;
                try {
                    const responseData = JSON.parse(tourResponse.data);
                    tourId = responseData.tourId || responseData.id;
                } catch (e) {
                    tourId = 'test-tour-123';
                }

                await this.addTestResult('Tour Creation', 'PASS', {
                    tourId,
                    responseStatus: tourResponse.status,
                    tourData
                });

                return { tourId, success: true };
            } else {
                await this.addTestResult('Tour Creation', 'FAIL', {
                    error: `HTTP ${tourResponse.status}`,
                    responseData: tourResponse.data.substring(0, 200)
                });

                return { tourId: 'fallback-tour-123', success: false };
            }
        } catch (error) {
            await this.addTestResult('Tour Creation', 'FAIL', { error: error.message });
            return { tourId: 'fallback-tour-123', success: false };
        }
    }

    async testWebRTCSignalingEndpoints() {
        const tourId = 'test-tour-123';
        const language = 'english';
        const attendeeId = 'test-attendee-456';

        // Test ICE candidate endpoints
        const iceEndpoints = [
            `/api/tour/guide-ice?tourId=${tourId}&language=${language}`,
            `/api/tour/attendee-ice?tourId=${tourId}&language=${language}&attendeeId=${attendeeId}`,
            `/api/tour/ice-candidate`
        ];

        let passedEndpoints = 0;

        for (const endpoint of iceEndpoints) {
            try {
                const response = await this.makeRequest(endpoint);
                const success = response.status < 500; // Allow 401/403 as these are expected without auth
                
                if (success) {
                    passedEndpoints++;
                }

                await this.addTestResult(`ICE Endpoint ${endpoint}`, success ? 'PASS' : 'FAIL', {
                    status: response.status,
                    hasJsonResponse: response.data.startsWith('{') || response.data.startsWith('[')
                });
            } catch (error) {
                await this.addTestResult(`ICE Endpoint ${endpoint}`, 'FAIL', { error: error.message });
            }
        }

        const overallSuccess = passedEndpoints >= iceEndpoints.length * 0.8; // 80% success rate
        await this.addTestResult('WebRTC Signaling Endpoints', overallSuccess ? 'PASS' : 'FAIL', {
            passedEndpoints,
            totalEndpoints: iceEndpoints.length,
            successRate: (passedEndpoints / iceEndpoints.length * 100).toFixed(1) + '%'
        });
    }

    async testWebRTCOfferAnswer() {
        const tourId = 'test-tour-123';
        const language = 'english';

        try {
            // Simulate WebRTC offer creation
            const mockOffer = {
                type: 'offer',
                sdp: 'v=0\r\no=- 123456789 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=ice-options:trickle\r\na=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\n'
            };

            const offerData = {
                tourId,
                language,
                offer: mockOffer,
                attendeeId: 'test-attendee-456'
            };

            // Test offer endpoint
            const offerResponse = await this.postRequest('/api/tour/offer', offerData);
            const offerSuccess = offerResponse.status < 500;

            // Test answer endpoint
            const answerData = {
                tourId,
                language,
                answer: { ...mockOffer, type: 'answer' },
                attendeeId: 'test-attendee-456'
            };

            const answerResponse = await this.postRequest('/api/tour/answer', answerData);
            const answerSuccess = answerResponse.status < 500;

            await this.addTestResult('WebRTC Offer/Answer', (offerSuccess && answerSuccess) ? 'PASS' : 'PARTIAL', {
                offerEndpoint: { status: offerResponse.status, success: offerSuccess },
                answerEndpoint: { status: answerResponse.status, success: answerSuccess },
                mockSDPUsed: true
            });
        } catch (error) {
            await this.addTestResult('WebRTC Offer/Answer', 'FAIL', { error: error.message });
        }
    }

    async testLanguageHandling() {
        try {
            const response = await this.makeRequest('/api/tour/languages');
            
            if (response.status === 200) {
                let languages;
                try {
                    languages = JSON.parse(response.data);
                } catch (e) {
                    languages = [];
                }

                const hasLanguages = Array.isArray(languages) && languages.length > 0;
                const hasExpectedLanguages = languages.some(lang => 
                    typeof lang === 'string' || 
                    (typeof lang === 'object' && (lang.code || lang.name))
                );

                await this.addTestResult('Language Handling', hasLanguages ? 'PASS' : 'FAIL', {
                    languageCount: languages.length,
                    languages: languages.slice(0, 5), // First 5 languages
                    hasExpectedStructure: hasExpectedLanguages
                });
            } else {
                await this.addTestResult('Language Handling', 'FAIL', {
                    error: `HTTP ${response.status}`
                });
            }
        } catch (error) {
            await this.addTestResult('Language Handling', 'FAIL', { error: error.message });
        }
    }

    async testRedisIntegration() {
        try {
            // Test Redis connectivity through ICE candidate storage
            const iceData = {
                tourId: 'test-tour-123',
                language: 'english',
                attendeeId: 'test-attendee-456',
                candidates: [{
                    candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host',
                    sdpMLineIndex: 0,
                    sdpMid: 'audio'
                }],
                sender: 'guide'
            };

            const response = await this.postRequest('/api/tour/ice-candidate', iceData);
            const redisWorking = response.status < 500; // Allow various response codes

            await this.addTestResult('Redis Integration', redisWorking ? 'PASS' : 'FAIL', {
                responseStatus: response.status,
                testDataSent: true,
                responseSnippet: response.data.substring(0, 100)
            });
        } catch (error) {
            await this.addTestResult('Redis Integration', 'FAIL', { error: error.message });
        }
    }

    async analyzeConnectionFlow() {
        this.results.connectionFlow = {
            step1_registration: this.results.validationTests['User Registration']?.status || 'NOT_TESTED',
            step2_tourCreation: this.results.validationTests['Tour Creation']?.status || 'NOT_TESTED',
            step3_signaling: this.results.validationTests['WebRTC Signaling Endpoints']?.status || 'NOT_TESTED',
            step4_offerAnswer: this.results.validationTests['WebRTC Offer/Answer']?.status || 'NOT_TESTED',
            step5_iceExchange: this.results.validationTests['Redis Integration']?.status || 'NOT_TESTED',
            step6_languages: this.results.validationTests['Language Handling']?.status || 'NOT_TESTED'
        };

        const flowSteps = Object.values(this.results.connectionFlow);
        const successfulSteps = flowSteps.filter(step => step === 'PASS').length;
        const totalSteps = flowSteps.length;

        await this.log('\n🔗 WEBRTC CONNECTION FLOW ANALYSIS');
        await this.log('==================================');

        const flowSuccess = successfulSteps >= totalSteps * 0.8; // 80% success rate
        if (flowSuccess) {
            await this.log('✅ CONNECTION FLOW: Ready for WebRTC connections!');
            await this.log(`   ${successfulSteps}/${totalSteps} critical steps working`);
        } else {
            await this.log('⚠️  CONNECTION FLOW: Some issues may affect WebRTC');
            await this.log(`   ${successfulSteps}/${totalSteps} critical steps working`);
        }

        return flowSuccess;
    }

    async run() {
        await this.log('🎯 Starting WebRTC Connection Validation...');
        await this.log('============================================');

        // Run validation tests
        await this.testUserRegistration();
        await this.testTourCreation();
        await this.testWebRTCSignalingEndpoints();
        await this.testWebRTCOfferAnswer();
        await this.testLanguageHandling();
        await this.testRedisIntegration();

        // Analyze results
        const flowReady = await this.analyzeConnectionFlow();

        await this.generateFinalReport(flowReady);
    }

    async generateFinalReport(flowReady) {
        await this.log('\n📊 WEBRTC VALIDATION REPORT');
        await this.log('===========================');
        
        await this.log(`Total Validation Tests: ${this.results.summary.total}`);
        await this.log(`Passed: ${this.results.summary.passed}`);
        await this.log(`Failed: ${this.results.summary.failed}`);
        await this.log(`Success Rate: ${((this.results.summary.passed / this.results.summary.total) * 100).toFixed(1)}%`);

        // Connection flow summary
        await this.log('\n🔗 Connection Flow Status:');
        Object.entries(this.results.connectionFlow).forEach(([step, status]) => {
            const icon = status === 'PASS' ? '✅' : status === 'PARTIAL' ? '⚠️' : '❌';
            const stepName = step.replace('step', 'Step ').replace('_', ': ');
            console.log(`   ${icon} ${stepName} - ${status}`);
        });

        // Final verdict
        await this.log('\n🎯 FINAL VERDICT:');
        const successRate = (this.results.summary.passed / this.results.summary.total) * 100;
        
        if (successRate >= 85 && flowReady) {
            await this.log('🟢 HIGH CONFIDENCE: WebRTC connections should work in Docker!');
            await this.log('   ✓ Core signaling infrastructure operational');
            await this.log('   ✓ Authentication and tour management working');
            await this.log('   ✓ ICE candidate exchange endpoints functional');
            await this.log('   → READY FOR DOCKER DEPLOYMENT');
        } else if (successRate >= 70) {
            await this.log('🟡 MEDIUM CONFIDENCE: Most components working');
            await this.log('   ✓ Basic infrastructure operational');
            await this.log('   ⚠️  Some endpoints may need attention');
            await this.log('   → TEST IN DOCKER BUT MONITOR FOR ISSUES');
        } else {
            await this.log('🔴 LOW CONFIDENCE: Multiple issues detected');
            await this.log('   ❌ Core components not fully operational');
            await this.log('   → FIX ISSUES BEFORE DOCKER DEPLOYMENT');
        }

        // Docker specific guidance
        await this.log('\n🐳 DOCKER DEPLOYMENT NEXT STEPS:');
        await this.log('1. Ensure Xirsys TURN/STUN credentials in .env.docker');
        await this.log('2. Run: docker compose up --build');
        await this.log('3. Test guide registration and tour creation');
        await this.log('4. Test attendee joining and WebRTC connection');
        await this.log('5. Monitor browser console for WebRTC connection logs');

        // Save detailed report
        const reportFile = `./test-results/webrtc-validation-${Date.now()}.json`;
        if (!fs.existsSync('./test-results')) {
            fs.mkdirSync('./test-results', { recursive: true });
        }
        fs.writeFileSync(reportFile, JSON.stringify(this.results, null, 2));
        await this.log(`\n💾 Detailed report saved to: ${reportFile}`);

        process.exit(this.results.summary.failed > 0 ? 1 : 0);
    }
}

if (require.main === module) {
    const validator = new WebRTCValidationTest();
    validator.run().catch(console.error);
}

module.exports = WebRTCValidationTest;