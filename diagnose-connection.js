/**
 * Manual Connection Diagnostics Script
 * Run this to diagnose WebRTC connection issues
 * 
 * Usage: node diagnose-connection.js [TOUR_ID] [LANGUAGE] [ATTENDEE_ID]
 */

const Redis = require('redis');

// Configuration
const REDIS_CONFIG = {
  host: 'localhost',
  port: 6379
};

// Language normalization function (matches the app)
function normalizeLanguageForStorage(language) {
  return language.toLowerCase().trim();
}

class ConnectionDiagnostics {
  constructor() {
    this.redis = null;
  }

  async initialize() {
    this.redis = Redis.createClient(REDIS_CONFIG);
    await this.redis.connect();
    console.log('✅ Connected to Redis');
  }

  async diagnose(tourId, language, attendeeId = null) {
    const normalizedLanguage = normalizeLanguageForStorage(language);
    
    console.log('\n🔍 ===== CONNECTION DIAGNOSTIC REPORT =====');
    console.log(`📊 Tour ID: ${tourId}`);
    console.log(`🌐 Language: ${language} (normalized: ${normalizedLanguage})`);
    console.log(`👤 Attendee: ${attendeeId || 'All'}`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    
    const issues = [];
    const fixes = [];
    
    // Check 1: WebRTC Offer
    console.log('\n🔍 Checking WebRTC Offer...');
    const offerKey = `tour:${tourId}:offer:${normalizedLanguage}`;
    const offerExists = await this.redis.exists(offerKey);
    
    if (offerExists) {
      const offerData = await this.redis.get(offerKey);
      console.log(`✅ Offer exists: ${offerKey}`);
      try {
        const parsed = JSON.parse(offerData);
        console.log(`   Type: ${parsed.type}, SDP length: ${parsed.sdp?.length || 0}`);
        fixes.push('WebRTC offer is available');
      } catch (e) {
        console.log(`   Raw data length: ${offerData.length}`);
      }
    } else {
      console.log(`❌ No offer found: ${offerKey}`);
      issues.push('No WebRTC offer - guide has not started broadcasting');
    }
    
    // Check 2: Guide Status
    console.log('\n🔍 Checking Guide Status...');
    const statusKey = `tour:${tourId}:guide_status`;
    const statusExists = await this.redis.exists(statusKey);
    
    if (statusExists) {
      const statusData = await this.redis.get(statusKey);
      console.log(`✅ Guide status exists: ${statusKey}`);
      try {
        const parsed = JSON.parse(statusData);
        console.log(`   Status: ${parsed.status}, Language: ${parsed.language}, Timestamp: ${new Date(parsed.timestamp).toISOString()}`);
        if (parsed.status === 'broadcasting') {
          fixes.push('Guide status is broadcasting');
        } else {
          issues.push(`Guide status is "${parsed.status}" instead of "broadcasting"`);
        }
      } catch (e) {
        console.log(`   Raw status: ${statusData}`);
      }
    } else {
      console.log(`❌ No guide status found: ${statusKey}`);
      issues.push('No guide status - guide readiness unknown');
    }
    
    // Check 3: Attendee Answers
    console.log('\n🔍 Checking Attendee Answers...');
    const answersKey = `tour:${tourId}:${normalizedLanguage}:answers`;
    const answersExist = await this.redis.exists(answersKey);
    
    if (answersExist) {
      const answers = await this.redis.lrange(answersKey, 0, -1);
      console.log(`✅ Answers exist: ${answersKey}`);
      console.log(`   Count: ${answers.length}`);
      
      if (answers.length > 0) {
        fixes.push(`Found ${answers.length} attendee answers`);
        
        // Show first few answers
        answers.slice(0, 3).forEach((answer, index) => {
          try {
            const parsed = JSON.parse(answer);
            console.log(`   Answer ${index + 1}: attendeeId=${parsed.attendeeId}, timestamp=${parsed.timestamp || 'unknown'}`);
          } catch (e) {
            console.log(`   Answer ${index + 1}: ${answer.substring(0, 50)}...`);
          }
        });
        
        if (answers.length > 3) {
          console.log(`   ... and ${answers.length - 3} more answers`);
        }
        
        // Check for specific attendee
        if (attendeeId) {
          const attendeeAnswer = answers.find(answer => {
            try {
              const parsed = JSON.parse(answer);
              return parsed.attendeeId === attendeeId;
            } catch {
              return false;
            }
          });
          
          if (attendeeAnswer) {
            console.log(`✅ Found answer for attendee ${attendeeId}`);
            fixes.push(`Answer found for attendee ${attendeeId}`);
          } else {
            console.log(`❌ No answer found for attendee ${attendeeId}`);
            issues.push(`No answer found for specific attendee ${attendeeId}`);
          }
        }
      } else {
        issues.push('Answer list exists but is empty');
      }
    } else {
      console.log(`❌ No answers found: ${answersKey}`);
      issues.push('No attendee answers - no attendees have joined');
    }
    
    // Check 4: ICE Candidates (if attendeeId provided)
    if (attendeeId) {
      console.log('\n🔍 Checking ICE Candidates...');
      
      const iceGuideKey = `ice:guide:${tourId}:${attendeeId}:${normalizedLanguage}`;
      const iceAttendeeKey = `ice:attendee:${tourId}:${attendeeId}:${normalizedLanguage}`;
      
      const iceGuideExists = await this.redis.exists(iceGuideKey);
      const iceAttendeeExists = await this.redis.exists(iceAttendeeKey);
      
      if (iceGuideExists) {
        const guideCount = await this.redis.llen(iceGuideKey);
        console.log(`✅ Guide ICE candidates: ${iceGuideKey} (${guideCount} candidates)`);
        fixes.push(`Found ${guideCount} guide ICE candidates`);
        
        if (guideCount > 20) {
          issues.push(`Too many guide ICE candidates (${guideCount}) - may indicate connection issues`);
        }
      } else {
        console.log(`❌ No guide ICE candidates: ${iceGuideKey}`);
        issues.push(`No guide ICE candidates for attendee ${attendeeId}`);
      }
      
      if (iceAttendeeExists) {
        const attendeeCount = await this.redis.llen(iceAttendeeKey);
        console.log(`✅ Attendee ICE candidates: ${iceAttendeeKey} (${attendeeCount} candidates)`);
        fixes.push(`Found ${attendeeCount} attendee ICE candidates`);
        
        if (attendeeCount > 20) {
          issues.push(`Too many attendee ICE candidates (${attendeeCount}) - may indicate connection issues`);
        }
      } else {
        console.log(`❌ No attendee ICE candidates: ${iceAttendeeKey}`);
        issues.push(`No attendee ICE candidates for attendee ${attendeeId}`);
      }
    }
    
    // Check 5: All Redis Keys for this tour
    console.log('\n🔍 Checking All Tour-Related Keys...');
    const allKeys = await this.redis.keys(`*${tourId}*`);
    console.log(`📋 Found ${allKeys.length} total keys for tour ${tourId}:`);
    
    const keysByType = {};
    allKeys.forEach(key => {
      const type = key.split(':')[0];
      if (!keysByType[type]) keysByType[type] = [];
      keysByType[type].push(key);
    });
    
    Object.entries(keysByType).forEach(([type, keys]) => {
      console.log(`   ${type}: ${keys.length} keys`);
      keys.slice(0, 3).forEach(key => console.log(`     - ${key}`));
      if (keys.length > 3) {
        console.log(`     ... and ${keys.length - 3} more`);
      }
    });
    
    // Summary
    console.log('\n✅ WORKING COMPONENTS:');
    if (fixes.length === 0) {
      console.log('   (none)');
    } else {
      fixes.forEach(fix => console.log(`   ✓ ${fix}`));
    }
    
    console.log('\n❌ ISSUES FOUND:');
    if (issues.length === 0) {
      console.log('   (none - everything looks good!)');
    } else {
      issues.forEach(issue => console.log(`   ✗ ${issue}`));
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    if (issues.length === 0) {
      console.log('   → Connection should work properly');
    } else {
      if (issues.some(i => i.includes('No WebRTC offer'))) {
        console.log('   → Guide must start the tour and begin broadcasting');
      }
      if (issues.some(i => i.includes('No attendee answers'))) {
        console.log('   → Attendees need to join the tour');
      }
      if (issues.some(i => i.includes('guide status'))) {
        console.log('   → Guide should ensure broadcasting status is set');
      }
      if (issues.some(i => i.includes('ICE candidates'))) {
        console.log('   → Check WebRTC connection establishment process');
      }
    }
    
    console.log('\n==========================================\n');
    
    return { issues, fixes, allKeys };
  }

  async repair(tourId, language, attendeeId = null) {
    const normalizedLanguage = normalizeLanguageForStorage(language);
    const repairs = [];
    
    console.log('\n🔧 ===== CONNECTION REPAIR =====');
    
    // Repair 1: Clean up excessive ICE candidates
    if (attendeeId) {
      const iceGuideKey = `ice:guide:${tourId}:${attendeeId}:${normalizedLanguage}`;
      const iceAttendeeKey = `ice:attendee:${tourId}:${attendeeId}:${normalizedLanguage}`;
      
      const guideCount = await this.redis.llen(iceGuideKey);
      const attendeeCount = await this.redis.llen(iceAttendeeKey);
      
      if (guideCount > 20) {
        await this.redis.ltrim(iceGuideKey, -10, -1);
        repairs.push(`Trimmed guide ICE candidates from ${guideCount} to 10`);
      }
      
      if (attendeeCount > 20) {
        await this.redis.ltrim(iceAttendeeKey, -10, -1);
        repairs.push(`Trimmed attendee ICE candidates from ${attendeeCount} to 10`);
      }
    }
    
    // Repair 2: Update guide status if offer exists but status is wrong
    const offerKey = `tour:${tourId}:offer:${normalizedLanguage}`;
    const statusKey = `tour:${tourId}:guide_status`;
    
    const offerExists = await this.redis.exists(offerKey);
    const statusExists = await this.redis.exists(statusKey);
    
    if (offerExists && (!statusExists || true)) { // Always update status for repair
      const statusData = {
        status: 'broadcasting',
        language: normalizedLanguage,
        timestamp: Date.now(),
        repaired: true
      };
      await this.redis.set(statusKey, JSON.stringify(statusData), 'EX', 3600);
      repairs.push('Updated guide status to broadcasting');
    }
    
    if (repairs.length > 0) {
      console.log('🔧 Applied repairs:');
      repairs.forEach(repair => console.log(`   ✓ ${repair}`));
    } else {
      console.log('ℹ️  No repairs needed');
    }
    
    console.log('===============================\n');
    
    return repairs;
  }

  async cleanup() {
    if (this.redis) {
      await this.redis.disconnect();
      console.log('✅ Disconnected from Redis');
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node diagnose-connection.js [TOUR_ID] [LANGUAGE] [ATTENDEE_ID]');
    console.log('Example: node diagnose-connection.js tour_1748895806249_sezombdca0l French');
    console.log('Example: node diagnose-connection.js tour_1748895806249_sezombdca0l French attendee_123');
    process.exit(1);
  }
  
  const [tourId, language, attendeeId] = args;
  
  const diagnostics = new ConnectionDiagnostics();
  
  try {
    await diagnostics.initialize();
    
    // Run diagnosis
    const result = await diagnostics.diagnose(tourId, language, attendeeId);
    
    // Run repairs if issues found
    if (result.issues.length > 0) {
      console.log('🔧 Issues detected, running repairs...');
      await diagnostics.repair(tourId, language, attendeeId);
      
      // Re-run diagnosis to see if issues were fixed
      console.log('🔍 Re-running diagnosis after repairs...');
      await diagnostics.diagnose(tourId, language, attendeeId);
    }
    
  } catch (error) {
    console.error('❌ Error running diagnostics:', error);
  } finally {
    await diagnostics.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ConnectionDiagnostics, normalizeLanguageForStorage };
