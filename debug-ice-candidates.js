#!/usr/bin/env node

/**
 * ICE Candidate Debugging Script
 * 
 * This script helps debug the "1 of 2 candidates" issue by monitoring
 * Redis ICE candidate storage and retrieval in real-time.
 * 
 * Usage: node debug-ice-candidates.js [tourId] [attendeeId] [language]
 */

const Redis = require('ioredis');

// Redis configuration
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
});

async function debugIceCandidates(tourId, attendeeId, language) {
  console.log('🔍 ICE Candidate Debugging Tool');
  console.log('================================');
  console.log(`Tour ID: ${tourId}`);
  console.log(`Attendee ID: ${attendeeId}`);
  console.log(`Language: ${language}`);
  console.log('');

  // Define Redis keys
  const guideKey = `ice:guide:${tourId}:${attendeeId}:${language}`;
  const attendeeKey = `ice:attendee:${tourId}:${attendeeId}:${language}`;

  console.log('🔑 Redis Keys:');
  console.log(`Guide ICE: ${guideKey}`);
  console.log(`Attendee ICE: ${attendeeKey}`);
  console.log('');

  try {
    // Check guide ICE candidates
    console.log('📡 GUIDE ICE CANDIDATES:');
    console.log('========================');
    const guideCount = await redis.llen(guideKey);
    console.log(`Total guide candidates: ${guideCount}`);

    if (guideCount > 0) {
      const guideCandidates = await redis.lrange(guideKey, 0, -1);
      guideCandidates.forEach((candidateStr, index) => {
        try {
          const candidate = JSON.parse(candidateStr);
          console.log(`  ${index + 1}. ${candidate.candidate ? candidate.candidate.substring(0, 80) + '...' : 'empty candidate'}`);
        } catch (e) {
          console.log(`  ${index + 1}. [Parse Error] ${candidateStr.substring(0, 50)}...`);
        }
      });
    } else {
      console.log('  ❌ No guide candidates found!');
    }

    console.log('');

    // Check attendee ICE candidates
    console.log('📱 ATTENDEE ICE CANDIDATES:');
    console.log('===========================');
    const attendeeCount = await redis.llen(attendeeKey);
    console.log(`Total attendee candidates: ${attendeeCount}`);

    if (attendeeCount > 0) {
      const attendeeCandidates = await redis.lrange(attendeeKey, 0, -1);
      attendeeCandidates.forEach((candidateStr, index) => {
        try {
          const candidate = JSON.parse(candidateStr);
          console.log(`  ${index + 1}. ${candidate.candidate ? candidate.candidate.substring(0, 80) + '...' : 'empty candidate'}`);
        } catch (e) {
          console.log(`  ${index + 1}. [Parse Error] ${candidateStr.substring(0, 50)}...`);
        }
      });
    } else {
      console.log('  ❌ No attendee candidates found!');
    }

    console.log('');

    // Analysis
    console.log('📊 ANALYSIS:');
    console.log('============');
    if (guideCount === 0) {
      console.log('🚨 CRITICAL: Guide has not sent any ICE candidates!');
      console.log('   - Check if guide WebRTC connection is established');
      console.log('   - Check if guide ICE candidate sending is working');
    } else if (guideCount === 1) {
      console.log('⚠️  WARNING: Guide has only sent 1 ICE candidate');
      console.log('   - Expected 2 candidates (typically host + srflx)');
      console.log('   - Guide may still be generating candidates');
    } else if (guideCount === 2) {
      console.log('✅ GOOD: Guide has sent 2 ICE candidates (expected)');
    } else {
      console.log(`ℹ️  INFO: Guide has sent ${guideCount} ICE candidates`);
    }

    if (attendeeCount === 0) {
      console.log('⚠️  Attendee has not sent any ICE candidates yet');
    } else {
      console.log(`✅ Attendee has sent ${attendeeCount} ICE candidates`);
    }

    console.log('');

    // Simulate attendee polling
    console.log('🔄 SIMULATING ATTENDEE POLLING:');
    console.log('===============================');
    
    for (let lastKnownIndex = -1; lastKnownIndex < guideCount; lastKnownIndex++) {
      const startIndex = lastKnownIndex + 1;
      const polledCandidates = await redis.lrange(guideKey, startIndex, -1);
      
      console.log(`Poll with lastKnownIndex=${lastKnownIndex}:`);
      console.log(`  - Fetching from index ${startIndex} to end`);
      console.log(`  - Retrieved ${polledCandidates.length} candidates`);
      
      if (polledCandidates.length > 0) {
        polledCandidates.forEach((candidateStr, index) => {
          try {
            const candidate = JSON.parse(candidateStr);
            console.log(`    ${startIndex + index}. ${candidate.candidate ? candidate.candidate.substring(0, 50) + '...' : 'empty'}`);
          } catch (e) {
            console.log(`    ${startIndex + index}. [Parse Error]`);
          }
        });
      }
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error debugging ICE candidates:', error);
  } finally {
    redis.disconnect();
  }
}

// Real-time monitoring function
async function monitorIceCandidates(tourId, attendeeId, language) {
  console.log('🔄 Starting real-time ICE candidate monitoring...');
  console.log('Press Ctrl+C to stop');
  console.log('');

  const guideKey = `ice:guide:${tourId}:${attendeeId}:${language}`;
  const attendeeKey = `ice:attendee:${tourId}:${attendeeId}:${language}`;

  let lastGuideCount = 0;
  let lastAttendeeCount = 0;

  const monitor = setInterval(async () => {
    try {
      const guideCount = await redis.llen(guideKey);
      const attendeeCount = await redis.llen(attendeeKey);

      if (guideCount !== lastGuideCount) {
        console.log(`📡 Guide candidates changed: ${lastGuideCount} → ${guideCount}`);
        if (guideCount > lastGuideCount) {
          // New guide candidates added
          const newCandidates = await redis.lrange(guideKey, lastGuideCount, guideCount - 1);
          newCandidates.forEach((candidateStr, index) => {
            try {
              const candidate = JSON.parse(candidateStr);
              console.log(`  🆕 New guide candidate ${lastGuideCount + index + 1}: ${candidate.candidate ? candidate.candidate.substring(0, 50) + '...' : 'empty'}`);
            } catch (e) {
              console.log(`  🆕 New guide candidate ${lastGuideCount + index + 1}: [Parse Error]`);
            }
          });
        }
        lastGuideCount = guideCount;
      }

      if (attendeeCount !== lastAttendeeCount) {
        console.log(`📱 Attendee candidates changed: ${lastAttendeeCount} → ${attendeeCount}`);
        lastAttendeeCount = attendeeCount;
      }

    } catch (error) {
      console.error('❌ Monitoring error:', error);
    }
  }, 1000); // Check every second

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping monitor...');
    clearInterval(monitor);
    redis.disconnect();
    process.exit(0);
  });
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node debug-ice-candidates.js <tourId> <attendeeId> <language> [--monitor]');
    console.log('');
    console.log('Examples:');
    console.log('  node debug-ice-candidates.js tour123 attendee456 french');
    console.log('  node debug-ice-candidates.js tour123 attendee456 french --monitor');
    process.exit(1);
  }

  const [tourId, attendeeId, language] = args;
  const isMonitor = args.includes('--monitor');

  if (isMonitor) {
    await monitorIceCandidates(tourId, attendeeId, language);
  } else {
    await debugIceCandidates(tourId, attendeeId, language);
  }
}

// Run the script
main().catch(console.error);
