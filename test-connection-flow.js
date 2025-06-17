/**
 * Test Connection Flow Script
 * Simulates the complete guide-to-attendee connection process
 * 
 * Usage: node test-connection-flow.js [TOUR_ID] [LANGUAGE]
 */

const Redis = require('redis');
const fetch = require('node-fetch');

// Configuration
const BASE_URL = 'http://localhost:3000';
const REDIS_CONFIG = {
  host: 'localhost',
  port: 6379
};

function normalizeLanguageForStorage(language) {
  return language.toLowerCase().trim();
}

class ConnectionFlowTester {
  constructor(tourId, language) {
    this.tourId = tourId;
    this.language = language;
    this.normalizedLanguage = normalizeLanguageForStorage(language);
    this.redis = null;
    this.attendeeId = `test_attendee_${Date.now()}`;
  }

  async initialize() {
    this.redis = Redis.createClient(REDIS_CONFIG);
    await this.redis.connect();
    console.log('✅ Connected to Redis');
  }

  async testCompleteFlow() {
    console.log('\n🧪 ===== TESTING COMPLETE CONNECTION FLOW =====');
    console.log(`📊 Tour ID: ${this.tourId}`);
    console.log(`🌐 Language: ${this.language} (normalized: ${this.normalizedLanguage})`);
    console.log(`👤 Test Attendee: ${this.attendeeId}`);
    console.log('================================================\n');

    try {
      // Step 1: Check if guide has started broadcasting
      await this.testStep1_CheckGuideReady();
      
      // Step 2: Simulate attendee joining
      await this.testStep2_AttendeeJoin();
      
      // Step 3: Simulate attendee sending answer
      await this.testStep3_AttendeeSendAnswer();
      
      // Step 4: Check if guide receives answer
      await this.testStep4_GuideReceivesAnswer();
      
      // Step 5: Simulate ICE candidate exchange
      await this.testStep5_ICECandidateExchange();
      
      // Step 6: Final verification
      await this.testStep6_FinalVerification();
      
      console.log('\n🎉 ===== CONNECTION FLOW TEST COMPLETE =====');
      console.log('✅ All steps completed successfully!');
      console.log('The guide-to-attendee connection flow is working correctly.');
      
    } catch (error) {
      console.error('\n❌ ===== CONNECTION FLOW TEST FAILED =====');
      console.error('Error:', error.message);
      console.error('The connection flow has issues that need to be addressed.');
    }
  }

  async testStep1_CheckGuideReady() {
    console.log('🔍 Step 1: Checking if guide is ready...');
    
    // Check for WebRTC offer
    const offerKey = `tour:${this.tourId}:offer:${this.normalizedLanguage}`;
    const offerExists = await this.redis.exists(offerKey);
    
    if (!offerExists) {
      throw new Error(`No WebRTC offer found at ${offerKey}. Guide must start broadcasting first.`);
    }
    
    const offerData = await this.redis.get(offerKey);
    const offer = JSON.parse(offerData);
    
    console.log(`✅ WebRTC offer found: type=${offer.type}, SDP length=${offer.sdp.length}`);
    
    // Check guide status
    const statusKey = `tour:${this.tourId}:guide_status`;
    const statusExists = await this.redis.exists(statusKey);
    
    if (statusExists) {
      const statusData = JSON.parse(await this.redis.get(statusKey));
      console.log(`✅ Guide status: ${statusData.status}`);
      
      if (statusData.status !== 'broadcasting') {
        console.warn(`⚠️  Guide status is "${statusData.status}" instead of "broadcasting"`);
      }
    } else {
      console.warn('⚠️  No guide status found');
    }
  }

  async testStep2_AttendeeJoin() {
    console.log('\n🔍 Step 2: Simulating attendee join...');
    
    const joinUrl = `${BASE_URL}/api/tour/join?tourCode=${this.tourId}&language=${this.language}`;
    console.log(`📞 Calling: ${joinUrl}`);
    
    const response = await fetch(joinUrl);
    
    if (!response.ok) {
      throw new Error(`Join request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.offer) {
      throw new Error(`No offer received in join response: ${JSON.stringify(data)}`);
    }
    
    console.log(`✅ Join successful: tourId=${data.tourId}, streamReady=${data.streamReady}`);
    console.log(`✅ Received offer: type=${data.offer.type}, SDP length=${data.offer.sdp.length}`);
    
    this.receivedOffer = data.offer;
  }

  async testStep3_AttendeeSendAnswer() {
    console.log('\n🔍 Step 3: Simulating attendee sending answer...');
    
    // Create a mock WebRTC answer
    const mockAnswer = {
      type: 'answer',
      sdp: `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=ice-options:trickle\r\na=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\r\na=setup:active\r\na=mid:0\r\na=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=recvonly\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:63 red/48000/2\r\na=fmtp:63 111/111\r\na=rtpmap:9 G722/8000\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:13 CN/8000\r\na=rtpmap:110 telephone-event/48000\r\na=rtpmap:126 telephone-event/8000\r\n`
    };
    
    const answerPayload = {
      tourId: this.tourId,
      language: this.normalizedLanguage,
      attendeeId: this.attendeeId,
      answer: JSON.stringify({ answer: mockAnswer }),
      timestamp: Date.now()
    };
    
    console.log(`📞 Sending answer for attendee ${this.attendeeId}...`);
    
    const response = await fetch(`${BASE_URL}/api/tour/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answerPayload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Answer submission failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`✅ Answer submitted successfully: ${JSON.stringify(result)}`);
  }

  async testStep4_GuideReceivesAnswer() {
    console.log('\n🔍 Step 4: Checking if guide receives answer...');
    
    // Wait a moment for the answer to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const answersKey = `tour:${this.tourId}:${this.normalizedLanguage}:answers`;
    const answersExist = await this.redis.exists(answersKey);
    
    if (!answersExist) {
      throw new Error(`No answers found at ${answersKey}`);
    }
    
    const answers = await this.redis.lrange(answersKey, 0, -1);
    console.log(`✅ Found ${answers.length} answers in Redis`);
    
    // Check if our specific answer is there
    const ourAnswer = answers.find(answer => {
      try {
        const parsed = JSON.parse(answer);
        return parsed.attendeeId === this.attendeeId;
      } catch {
        return false;
      }
    });
    
    if (!ourAnswer) {
      throw new Error(`Our attendee answer (${this.attendeeId}) not found in Redis answers`);
    }
    
    console.log(`✅ Our attendee answer found in Redis`);
    
    // Test the guide's answer polling endpoint
    const pollUrl = `${BASE_URL}/api/tour/answer?tourId=${this.tourId}&language=${this.normalizedLanguage}`;
    console.log(`📞 Testing guide polling: ${pollUrl}`);
    
    const pollResponse = await fetch(pollUrl);
    if (!pollResponse.ok) {
      throw new Error(`Guide polling failed: ${pollResponse.status} ${pollResponse.statusText}`);
    }
    
    const pollData = await pollResponse.json();
    console.log(`✅ Guide polling successful: ${pollData.answers.length} answers returned`);
    
    if (pollData.answers.length === 0) {
      throw new Error('Guide polling returned 0 answers despite Redis having answers');
    }
  }

  async testStep5_ICECandidateExchange() {
    console.log('\n🔍 Step 5: Simulating ICE candidate exchange...');
    
    // Simulate attendee sending ICE candidates
    const mockICECandidate = {
      candidate: 'candidate:1 1 UDP 2113667326 192.168.1.100 54400 typ host generation 0 ufrag test network-cost 999',
      sdpMLineIndex: 0,
      sdpMid: '0'
    };
    
    const iceCandidatePayload = {
      tourId: this.tourId,
      language: this.normalizedLanguage,
      candidate: mockICECandidate,
      attendeeId: this.attendeeId,
      sender: 'attendee'
    };
    
    console.log(`📞 Sending ICE candidate from attendee...`);
    
    const iceResponse = await fetch(`${BASE_URL}/api/tour/ice-candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(iceCandidatePayload)
    });
    
    if (!iceResponse.ok) {
      const errorText = await iceResponse.text();
      throw new Error(`ICE candidate submission failed: ${iceResponse.status} ${iceResponse.statusText} - ${errorText}`);
    }
    
    console.log(`✅ ICE candidate submitted successfully`);
    
    // Check if ICE candidate is stored correctly
    const iceKey = `ice:attendee:${this.tourId}:${this.attendeeId}:${this.normalizedLanguage}`;
    const iceExists = await this.redis.exists(iceKey);
    
    if (!iceExists) {
      throw new Error(`ICE candidate not found at ${iceKey}`);
    }
    
    const iceCount = await this.redis.llen(iceKey);
    console.log(`✅ ICE candidate stored in Redis: ${iceCount} candidates at ${iceKey}`);
  }

  async testStep6_FinalVerification() {
    console.log('\n🔍 Step 6: Final verification...');
    
    // Check all expected Redis keys exist
    const expectedKeys = [
      `tour:${this.tourId}:offer:${this.normalizedLanguage}`,
      `tour:${this.tourId}:${this.normalizedLanguage}:answers`,
      `ice:attendee:${this.tourId}:${this.attendeeId}:${this.normalizedLanguage}`
    ];
    
    for (const key of expectedKeys) {
      const exists = await this.redis.exists(key);
      if (!exists) {
        throw new Error(`Expected key missing: ${key}`);
      }
      console.log(`✅ Key exists: ${key}`);
    }
    
    // Test guide ICE candidate polling
    const guideIceUrl = `${BASE_URL}/api/tour/attendee-ice?tourId=${this.tourId}&language=${this.normalizedLanguage}&attendeeId=${this.attendeeId}&lastKnownIndex=-1`;
    console.log(`📞 Testing guide ICE polling: ${guideIceUrl}`);
    
    const guideIceResponse = await fetch(guideIceUrl);
    if (!guideIceResponse.ok) {
      throw new Error(`Guide ICE polling failed: ${guideIceResponse.status} ${guideIceResponse.statusText}`);
    }
    
    const guideIceData = await guideIceResponse.json();
    console.log(`✅ Guide ICE polling successful: ${guideIceData.candidates.length} candidates returned`);
    
    console.log('\n🎯 Connection flow verification complete!');
    console.log('All components are working correctly:');
    console.log('  ✓ Guide offer creation and storage');
    console.log('  ✓ Attendee join process');
    console.log('  ✓ Attendee answer submission');
    console.log('  ✓ Guide answer polling');
    console.log('  ✓ ICE candidate exchange');
    console.log('  ✓ Redis key consistency');
  }

  async cleanup() {
    if (this.redis) {
      // Clean up test data
      const keysToClean = [
        `tour:${this.tourId}:${this.normalizedLanguage}:answers`,
        `ice:attendee:${this.tourId}:${this.attendeeId}:${this.normalizedLanguage}`,
        `ice:guide:${this.tourId}:${this.attendeeId}:${this.normalizedLanguage}`
      ];
      
      for (const key of keysToClean) {
        const exists = await this.redis.exists(key);
        if (exists) {
          await this.redis.del(key);
          console.log(`🧹 Cleaned up: ${key}`);
        }
      }
      
      await this.redis.disconnect();
      console.log('✅ Disconnected from Redis');
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node test-connection-flow.js [TOUR_ID] [LANGUAGE]');
    console.log('Example: node test-connection-flow.js tour_1748895806249_sezombdca0l French');
    process.exit(1);
  }
  
  const [tourId, language] = args;
  
  const tester = new ConnectionFlowTester(tourId, language);
  
  try {
    await tester.initialize();
    await tester.testCompleteFlow();
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ConnectionFlowTester };
