#!/usr/bin/env node

/**
 * Debug script to examine real Redis ICE candidate data
 */

const { createClient } = require('redis');

async function debugRealRedisData() {
  console.log('🔍 Examining real Redis ICE candidate data...');
  
  const redis = createClient({
    url: `redis://localhost:6379`,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 5000)
    }
  });

  try {
    await redis.connect();
    console.log('✅ Connected to Redis');

    // Get all ICE-related keys
    const allIceKeys = await redis.keys('ice:*');
    console.log(`\n📋 Found ${allIceKeys.length} ICE-related keys in Redis:`);

    for (const key of allIceKeys) {
      const keyParts = key.split(':');
      const sender = keyParts[1];
      const tourId = keyParts[2];
      const attendeeId = keyParts[3];
      const language = keyParts[4];
      
      const count = await redis.lLen(key);
      console.log(`\n🔑 Key: ${key}`);
      console.log(`   Sender: ${sender}`);
      console.log(`   Tour ID: ${tourId}`);
      console.log(`   Attendee ID: ${attendeeId}`);
      console.log(`   Language: ${language}`);
      console.log(`   Candidate Count: ${count}`);

      // Show a sample of the actual candidates
      if (count > 0) {
        const sampleCandidates = await redis.lRange(key, 0, Math.min(2, count - 1));
        console.log(`   Sample candidates:`);
        sampleCandidates.forEach((candidate, index) => {
          try {
            const parsed = JSON.parse(candidate);
            console.log(`     #${index + 1}: ${parsed.candidate ? parsed.candidate.substring(0, 60) + '...' : 'null candidate'}`);
            console.log(`         Type: ${parsed.type || 'unknown'}, Protocol: ${parsed.protocol || 'unknown'}`);
          } catch (error) {
            console.log(`     #${index + 1}: Failed to parse candidate - ${error.message}`);
          }
        });
      }

      // For guide candidates, check if there's a corresponding attendee polling endpoint
      if (sender === 'guide') {
        console.log(`\n   🔍 GUIDE CANDIDATE ANALYSIS:`);
        console.log(`     This key contains guide ICE candidates for attendee ${attendeeId}`);
        console.log(`     Attendees should poll: GET /api/tour/guide-ice?tourId=${tourId}&language=${language}&attendeeId=${attendeeId}`);
        
        // Check if attendee candidates exist for comparison
        const attendeeKey = `ice:attendee:${tourId}:${attendeeId}:${language}`;
        const attendeeCount = await redis.lLen(attendeeKey);
        console.log(`     Corresponding attendee candidates: ${attendeeCount} (key: ${attendeeKey})`);
        
        if (attendeeCount > 0) {
          console.log(`     ⚖️  Guide:Attendee ratio = ${count}:${attendeeCount}`);
          if (count < attendeeCount) {
            console.log(`     ⚠️  Guide has fewer candidates than attendee - possible connection issue`);
          }
        }
      }
    }

    // Check for recent activity patterns
    console.log(`\n📊 ICE Candidate Statistics:`);
    const guideKeys = allIceKeys.filter(key => key.includes(':guide:'));
    const attendeeKeys = allIceKeys.filter(key => key.includes(':attendee:'));
    
    console.log(`   Guide candidate keys: ${guideKeys.length}`);
    console.log(`   Attendee candidate keys: ${attendeeKeys.length}`);
    
    if (guideKeys.length > 0) {
      let totalGuideCandidates = 0;
      for (const key of guideKeys) {
        totalGuideCandidates += await redis.lLen(key);
      }
      console.log(`   Total guide candidates: ${totalGuideCandidates}`);
      console.log(`   Average candidates per guide connection: ${(totalGuideCandidates / guideKeys.length).toFixed(1)}`);
    }

    if (attendeeKeys.length > 0) {
      let totalAttendeeCandidates = 0;
      for (const key of attendeeKeys) {
        totalAttendeeCandidates += await redis.lLen(key);
      }
      console.log(`   Total attendee candidates: ${totalAttendeeCandidates}`);
      console.log(`   Average candidates per attendee connection: ${(totalAttendeeCandidates / attendeeKeys.length).toFixed(1)}`);
    }

    // Look for matching tour/attendee pairs
    console.log(`\n🔗 Connection Pair Analysis:`);
    const connectionPairs = new Map();
    
    for (const key of allIceKeys) {
      const keyParts = key.split(':');
      const sender = keyParts[1];
      const tourId = keyParts[2];
      const attendeeId = keyParts[3];
      const language = keyParts[4];
      const pairKey = `${tourId}:${attendeeId}:${language}`;
      
      if (!connectionPairs.has(pairKey)) {
        connectionPairs.set(pairKey, { guide: 0, attendee: 0 });
      }
      
      const count = await redis.lLen(key);
      connectionPairs.get(pairKey)[sender] = count;
    }

    for (const [pairKey, counts] of connectionPairs.entries()) {
      const [tourId, attendeeId, language] = pairKey.split(':');
      console.log(`   ${tourId}/${attendeeId}/${language}:`);
      console.log(`     Guide candidates: ${counts.guide}`);
      console.log(`     Attendee candidates: ${counts.attendee}`);
      
      if (counts.guide === 0 && counts.attendee > 0) {
        console.log(`     ❌ Missing guide candidates - attendee won't receive any!`);
      } else if (counts.guide > 0 && counts.attendee === 0) {
        console.log(`     ❌ Missing attendee candidates - guide can't connect!`);
      } else if (counts.guide > 0 && counts.attendee > 0) {
        console.log(`     ✅ Both sides have candidates`);
      }
    }

  } catch (error) {
    console.error('❌ Error during debug:', error);
  } finally {
    await redis.disconnect();
    console.log('\n🔌 Disconnected from Redis');
  }
}

// Run the debug script
debugRealRedisData().catch(console.error);