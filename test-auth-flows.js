#!/usr/bin/env node

// Authentication Flow Testing
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_RESULTS_DIR = './test-results';

class AuthFlowTester {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            tests: [],
            authFlows: {},
            summary: { total: 0, passed: 0, failed: 0 }
        };
        this.browser = null;
    }

    async log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    async addTestResult(name, status, details = {}) {
        const result = { name, status, details, timestamp: new Date().toISOString() };
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
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            return true;
        } catch (error) {
            await this.addTestResult('Browser Setup', 'FAIL', { error: error.message });
            return false;
        }
    }

    async testRegistrationFlow() {
        const page = await this.browser.newPage();
        
        try {
            await page.goto(`${TEST_BASE_URL}/register`);
            await page.waitForSelector('form', { timeout: 10000 });
            
            // Check if registration form exists
            const formElements = await page.evaluate(() => {
                const form = document.querySelector('form');
                if (!form) return null;
                
                return {
                    hasEmailField: !!form.querySelector('input[name="email"], input[type="email"]'),
                    hasPasswordField: !!form.querySelector('input[name="password"], input[type="password"]'),
                    hasRoleSelector: !!form.querySelector('select[name="role"], select'),
                    hasSubmitButton: !!form.querySelector('button[type="submit"], input[type="submit"]'),
                    formAction: form.action,
                    formMethod: form.method
                };
            });

            if (formElements && formElements.hasEmailField && formElements.hasPasswordField) {
                await this.addTestResult('Registration Form Available', 'PASS', formElements);
                
                // Test actual registration
                const testEmail = `test-${Date.now()}@example.com`;
                const testPassword = 'testpass123';
                
                await page.type('input[name="email"], input[type="email"]', testEmail);
                await page.type('input[name="password"], input[type="password"]', testPassword);
                
                // Select role if available
                if (formElements.hasRoleSelector) {
                    await page.select('select[name="role"], select', 'guide');
                }
                
                await page.click('button[type="submit"], input[type="submit"]');
                await page.waitForTimeout(3000);
                
                const currentUrl = page.url();
                const isRedirected = !currentUrl.includes('/register');
                
                await this.addTestResult('Registration Process', isRedirected ? 'PASS' : 'FAIL', {
                    testEmail,
                    currentUrl,
                    redirected: isRedirected
                });
                
            } else {
                await this.addTestResult('Registration Form Available', 'FAIL', {
                    error: 'Required form elements not found',
                    foundElements: formElements
                });
            }
            
        } catch (error) {
            await this.addTestResult('Registration Flow', 'FAIL', { error: error.message });
        } finally {
            await page.close();
        }
    }

    async testLoginFlow() {
        const page = await this.browser.newPage();
        
        try {
            await page.goto(`${TEST_BASE_URL}/login`);
            await page.waitForSelector('form', { timeout: 10000 });
            
            // Check login form
            const formElements = await page.evaluate(() => {
                const form = document.querySelector('form');
                if (!form) return null;
                
                return {
                    hasEmailField: !!form.querySelector('input[name="email"], input[type="email"]'),
                    hasPasswordField: !!form.querySelector('input[name="password"], input[type="password"]'),
                    hasSubmitButton: !!form.querySelector('button[type="submit"], input[type="submit"]'),
                    formAction: form.action,
                    formMethod: form.method
                };
            });

            if (formElements && formElements.hasEmailField && formElements.hasPasswordField) {
                await this.addTestResult('Login Form Available', 'PASS', formElements);
                
                // Test invalid login
                await page.type('input[name="email"], input[type="email"]', 'invalid@test.com');
                await page.type('input[name="password"], input[type="password"]', 'wrongpassword');
                await page.click('button[type="submit"], input[type="submit"]');
                await page.waitForTimeout(3000);
                
                const currentUrl = page.url();
                const stayedOnLogin = currentUrl.includes('/login');
                
                await this.addTestResult('Invalid Login Handling', stayedOnLogin ? 'PASS' : 'FAIL', {
                    currentUrl,
                    stayedOnLogin
                });
                
            } else {
                await this.addTestResult('Login Form Available', 'FAIL', {
                    error: 'Required form elements not found',
                    foundElements: formElements
                });
            }
            
        } catch (error) {
            await this.addTestResult('Login Flow', 'FAIL', { error: error.message });
        } finally {
            await page.close();
        }
    }

    async testProtectedRoutes() {
        const protectedRoutes = ['/guide', '/attendee', '/dashboard'];
        
        for (const route of protectedRoutes) {
            const page = await this.browser.newPage();
            
            try {
                const response = await page.goto(`${TEST_BASE_URL}${route}`, { 
                    waitUntil: 'networkidle2',
                    timeout: 10000 
                });
                
                const currentUrl = page.url();
                const redirectedToLogin = currentUrl.includes('/login');
                
                await this.addTestResult(`Protected Route ${route}`, redirectedToLogin ? 'PASS' : 'FAIL', {
                    originalRoute: route,
                    currentUrl,
                    responseStatus: response.status(),
                    redirectedToLogin
                });
                
            } catch (error) {
                await this.addTestResult(`Protected Route ${route}`, 'FAIL', { error: error.message });
            } finally {
                await page.close();
            }
        }
    }

    async testSessionManagement() {
        const page = await this.browser.newPage();
        
        try {
            // Check session endpoint
            await page.goto(`${TEST_BASE_URL}/api/session`);
            const sessionContent = await page.content();
            
            // Should return session info or error for unauthenticated user
            const hasValidResponse = sessionContent.includes('authenticated') || 
                                   sessionContent.includes('user') ||
                                   sessionContent.includes('error') ||
                                   sessionContent.includes('unauthorized');
            
            await this.addTestResult('Session Endpoint', hasValidResponse ? 'PASS' : 'FAIL', {
                responseIncludesSessionInfo: hasValidResponse,
                responseSnippet: sessionContent.substring(0, 200)
            });
            
            // Check auth check endpoint
            await page.goto(`${TEST_BASE_URL}/api/auth/check`);
            const authContent = await page.content();
            
            const hasAuthResponse = authContent.includes('authenticated') ||
                                  authContent.includes('valid') ||
                                  authContent.includes('false') ||
                                  authContent.includes('error');
            
            await this.addTestResult('Auth Check Endpoint', hasAuthResponse ? 'PASS' : 'FAIL', {
                responseIncludesAuthInfo: hasAuthResponse,
                responseSnippet: authContent.substring(0, 200)
            });
            
        } catch (error) {
            await this.addTestResult('Session Management', 'FAIL', { error: error.message });
        } finally {
            await page.close();
        }
    }

    async runTests() {
        await this.log('Starting Authentication Flow Tests...');
        
        if (!(await this.setupBrowser())) {
            return;
        }

        try {
            await this.testRegistrationFlow();
            await this.testLoginFlow();
            await this.testProtectedRoutes();
            await this.testSessionManagement();
            
        } catch (error) {
            await this.addTestResult('Test Suite', 'FAIL', { error: error.message });
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }

        await this.saveResults();
        await this.printSummary();
    }

    async saveResults() {
        const resultsFile = path.join(TEST_RESULTS_DIR, `auth-flow-test-${Date.now()}.json`);
        fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
        await this.log(`Test results saved to: ${resultsFile}`);
    }

    async printSummary() {
        await this.log('\n=== AUTHENTICATION FLOW SUMMARY ===');
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

        process.exit(this.results.summary.failed > 0 ? 1 : 0);
    }
}

if (require.main === module) {
    const tester = new AuthFlowTester();
    tester.runTests().catch(console.error);
}

module.exports = AuthFlowTester;