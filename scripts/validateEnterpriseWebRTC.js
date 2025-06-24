#!/usr/bin/env node

/**
 * Enterprise WebRTC Validation Script
 * 
 * Runs comprehensive validation of the enterprise WebRTC implementation.
 * This script can be run independently to verify system integrity.
 * 
 * Usage: node scripts/validateEnterpriseWebRTC.js
 */

const { enterpriseValidator } = require('../lib/enterpriseWebRTCValidator');

async function main() {
  console.log('🚀 Starting Enterprise WebRTC Validation...\n');

  try {
    // Run comprehensive validation
    const report = await enterpriseValidator.validateSystem();

    // Exit with appropriate code
    if (report.overallStatus === 'FAIL') {
      console.error('❌ Validation FAILED - System has critical issues');
      process.exit(1);
    } else if (report.overallStatus === 'WARNING') {
      console.warn('⚠️  Validation completed with WARNINGS - Review recommended');
      process.exit(0);
    } else {
      console.log('✅ Validation PASSED - System is ready for production');
      process.exit(0);
    }

  } catch (error) {
    console.error('💥 Validation script failed:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run the validation
main();
