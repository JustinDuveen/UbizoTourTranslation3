#!/usr/bin/env node

/**
 * Debug script to investigate ICE candidate storage/retrieval mismatch
 * Tests the exact scenarios where guide stores ICE candidates and attendee retrieves them
 */

const { createClient } = require('redis');

async function debugICEMismatch() {
  console.log('🔍 Starting ICE candidate storage/retrieval mismatch investigation...');
  
  const redis = createClient({
    url: `redis://localhost:6379`,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 5000)
    }
  });

  try {
    await redis.connect();
    console.log('✅ Connected to Redis');

    // Test parameters matching the actual application flow
    const testParams = {
      tourId: 'test-tour-123',
      attendeeId: 'test-attendee-456', 
      language: 'French',
      sender: 'guide'
    };

    console.log('\n🧪 Test parameters:', testParams);

    // Import the Redis key generation functions
    const { getIceCandidateKey, normalizeLanguageForStorage } = require('./lib/redisKeys.ts');
    
    // Test 1: Generate storage key (what guide uses)
    const normalizedLanguage = normalizeLanguageForStorage(testParams.language);
    const storageKey = getIceCandidateKey(
      testParams.sender, 
      testParams.tourId, 
      testParams.attendeeId, 
      normalizedLanguage, 
      false
    );
    
    console.log('\n📦 STORAGE TEST (Guide sending ICE candidates):');
    console.log(`  Original language: "${testParams.language}"`);
    console.log(`  Normalized language: "${normalizedLanguage}"`);
    console.log(`  Storage key: "${storageKey}"`);

    // Test 2: Generate retrieval key (what attendee uses)
    const retrievalKey = getIceCandidateKey(
      'guide', 
      testParams.tourId, 
      testParams.attendeeId, 
      normalizedLanguage, 
      false
    );
    
    console.log('\n📥 RETRIEVAL TEST (Attendee fetching guide ICE candidates):');
    console.log(`  Retrieval key: "${retrievalKey}"`);
    console.log(`  Keys match: ${storageKey === retrievalKey ? '✅ YES' : '❌ NO'}`);

    // Test 3: Store some test ICE candidates
    console.log('\n🧪 Storing test ICE candidates...');
    const testCandidates = [
      { candidate: 'candidate:1 1 UDP 2113667326 192.168.1.100 54400 typ host', sdpMLineIndex: 0, sdpMid: 'audio' },
      { candidate: 'candidate:2 1 UDP 1677729535 8.8.8.8 54401 typ srflx raddr 192.168.1.100 rport 54400', sdpMLineIndex: 0, sdpMid: 'audio' },
      { candidate: 'candidate:3 1 UDP 1677729279 8.8.4.4 54402 typ relay raddr 8.8.8.8 rport 54401', sdpMLineIndex: 0, sdpMid: 'audio' }
    ];

    for (let i = 0; i < testCandidates.length; i++) {
      const candidate = testCandidates[i];
      await redis.rPush(storageKey, JSON.stringify(candidate));
      console.log(`  Stored candidate #${i + 1}: ${candidate.candidate.substring(0, 50)}...`);
    }

    // Test 4: Check if candidates can be retrieved
    console.log('\n📤 Retrieving ICE candidates...');
    const totalCount = await redis.lLen(retrievalKey);
    console.log(`  Total candidates in Redis: ${totalCount}`);

    if (totalCount > 0) {
      const candidates = await redis.lRange(retrievalKey, 0, -1);
      console.log(`  Successfully retrieved ${candidates.length} candidates`);
      candidates.forEach((candidate, index) => {
        const parsed = JSON.parse(candidate);
        console.log(`    #${index + 1}: ${parsed.candidate.substring(0, 50)}...`);
      });
    } else {
      console.log('  ❌ No candidates found - this indicates the mismatch!');
    }

    // Test 5: Check for alternative key patterns that might exist
    console.log('\n🔍 Checking for alternative key patterns...');
    const keyPatterns = [
      `ice:guide:${testParams.tourId}:${testParams.attendeeId}:*`,
      `ice:*:${testParams.tourId}:${testParams.attendeeId}:*`,
      `*:${testParams.tourId}:${testParams.attendeeId}:*`,
      `*ice*${testParams.tourId}*${testParams.attendeeId}*`
    ];

    for (const pattern of keyPatterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        console.log(`  Pattern "${pattern}" found keys:`, keys);
        for (const key of keys) {
          const count = await redis.lLen(key);
          console.log(`    ${key}: ${count} candidates`);
        }
      }
    }

    // Test 6: Test language normalization edge cases
    console.log('\n🔤 Testing language normalization edge cases...');
    const languageVariations = [
      'French',
      'french', 
      'FRENCH',
      ' French ',
      'French ',
      ' french',
      'français',
      'Français'
    ];

    languageVariations.forEach(lang => {
      const normalized = normalizeLanguageForStorage(lang);
      const key = getIceCandidateKey('guide', testParams.tourId, testParams.attendeeId, normalized, false);
      console.log(`  "${lang}" → "${normalized}" → "${key}"`);
    });

    // Test 7: Check actual Redis keys that exist
    console.log('\n📋 Checking all existing ICE-related keys in Redis...');
    const allIceKeys = await redis.keys('ice:*');
    console.log(`  Found ${allIceKeys.length} ICE-related keys:`);
    for (const key of allIceKeys) {
      const count = await redis.lLen(key);
      const type = await redis.type(key);
      console.log(`    ${key} (${type}): ${count} items`);
    }

    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await redis.del(storageKey);
    console.log('  Test data cleaned up');

  } catch (error) {
    console.error('❌ Error during debug:', error);
  } finally {
    await redis.disconnect();
    console.log('\n🔌 Disconnected from Redis');
  }
}

// Run the debug script
debugICEMismatch().catch(console.error);