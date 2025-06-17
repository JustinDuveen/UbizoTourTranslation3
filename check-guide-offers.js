const redis = require("redis");

// Create a Redis client
const client = redis.createClient({
  url: "redis://127.0.0.1:6379",
});

// Connect to Redis
client.connect();

client.on("connect", () => {
  console.log("✅ Connected to Redis");
});

client.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

// Check specifically for guide WebRTC offers
(async () => {
  try {
    console.log("\n🔍 GUIDE WEBRTC OFFER ANALYSIS");
    console.log("=====================================\n");

    // 1. Get the most recent tour
    const tourCodeKeys = await client.keys("tour_codes:*");
    if (tourCodeKeys.length === 0) {
      console.log("❌ No tour codes found");
      return;
    }

    // Get the most recent tour code (last in the list)
    const latestTourCodeKey = tourCodeKeys[tourCodeKeys.length - 1];
    const latestTourCode = latestTourCodeKey.replace('tour_codes:', '');
    const latestTourId = await client.get(latestTourCodeKey);

    console.log(`🎯 Latest Tour Code: ${latestTourCode}`);
    console.log(`🎯 Latest Tour ID: ${latestTourId}`);

    // 2. Check tour details
    const tourData = await client.get(`tour:${latestTourId}`);
    if (tourData) {
      try {
        const tour = JSON.parse(tourData);
        console.log(`📊 Tour Status: ${tour.status}`);
        console.log(`📊 Primary Language: ${tour.primaryLanguage}`);
        console.log(`📊 Supported Languages: ${JSON.stringify(tour.languages)}`);
        console.log(`📊 Start Time: ${tour.startTime}`);
      } catch (e) {
        console.log(`⚠️ Tour data parse error: ${e.message}`);
      }
    }

    // 3. Check supported languages in Redis
    const supportedLangs = await client.sMembers(`tour:${latestTourId}:supported_languages`);
    console.log(`📊 Redis Supported Languages: ${JSON.stringify(supportedLangs)}`);

    // 4. Check for WebRTC offers for each language
    console.log(`\n🔍 CHECKING WEBRTC OFFERS FOR TOUR ${latestTourId}:`);

    if (supportedLangs.length === 0) {
      console.log("❌ No supported languages found in Redis");

      // Try common languages anyway
      const commonLangs = ['english', 'spanish', 'french', 'german', 'italian'];
      console.log("🔍 Checking common languages anyway...");

      for (const lang of commonLangs) {
        const offerKey = `tour:${latestTourId}:offer:${lang}`;
        const hasOffer = await client.exists(offerKey);
        console.log(`   ${lang}: ${hasOffer ? '✅ HAS OFFER' : '❌ NO OFFER'}`);

        if (hasOffer) {
          const offerData = await client.get(offerKey);
          try {
            const offer = JSON.parse(offerData);
            console.log(`      Type: ${offer.type || 'unknown'}`);
            console.log(`      Has SDP: ${!!offer.sdp}`);
            console.log(`      SDP Valid: ${offer.sdp && offer.sdp.includes('v=') ? '✅' : '❌'}`);
          } catch (e) {
            console.log(`      ❌ Parse error: ${e.message}`);
          }
        }
      }
    } else {
      for (const lang of supportedLangs) {
        const offerKey = `tour:${latestTourId}:offer:${lang}`;
        const hasOffer = await client.exists(offerKey);
        console.log(`   ${lang}: ${hasOffer ? '✅ HAS OFFER' : '❌ NO OFFER'}`);

        if (hasOffer) {
          const offerData = await client.get(offerKey);
          try {
            const offer = JSON.parse(offerData);
            console.log(`      Type: ${offer.type || 'unknown'}`);
            console.log(`      Has SDP: ${!!offer.sdp}`);
            console.log(`      SDP Valid: ${offer.sdp && offer.sdp.includes('v=') ? '✅' : '❌'}`);
            console.log(`      SDP Preview: ${offer.sdp ? offer.sdp.substring(0, 50) + '...' : 'N/A'}`);
          } catch (e) {
            console.log(`      ❌ Parse error: ${e.message}`);
          }
        }
      }
    }

    // 5. Check for any offers at all
    console.log(`\n🔍 CHECKING ALL WEBRTC OFFERS IN REDIS:`);
    const allOfferKeys = await client.keys("tour:*:offer:*");
    console.log(`Found ${allOfferKeys.length} total offers: ${JSON.stringify(allOfferKeys)}`);

    // 6. Check attendee answers
    console.log(`\n🔍 CHECKING ATTENDEE ANSWERS FOR TOUR ${latestTourId}:`);
    const answerKeys = await client.keys(`tour:${latestTourId}:*:answers`);
    console.log(`Found ${answerKeys.length} answer queues: ${JSON.stringify(answerKeys)}`);

    for (const answerKey of answerKeys) {
      const answerCount = await client.lLen(answerKey);
      console.log(`   ${answerKey}: ${answerCount} answers`);
    }

    // 7. Check attendees
    console.log(`\n🔍 CHECKING ATTENDEES FOR TOUR ${latestTourId}:`);
    const attendeeKeys = await client.keys(`tour:${latestTourId}:*:attendees`);
    console.log(`Found ${attendeeKeys.length} attendee groups: ${JSON.stringify(attendeeKeys)}`);

    for (const attendeeKey of attendeeKeys) {
      const attendees = await client.sMembers(attendeeKey);
      console.log(`   ${attendeeKey}: ${attendees.length} attendees - ${JSON.stringify(attendees)}`);
    }

    // 8. Summary and diagnosis
    console.log(`\n📋 DIAGNOSIS:`);
    console.log(`=====================================`);

    if (allOfferKeys.length === 0) {
      console.log(`❌ CRITICAL: No WebRTC offers found in Redis`);
      console.log(`   This means the guide is not storing SDP offers`);
      console.log(`   Possible causes:`);
      console.log(`   1. Guide's OpenAI connection is failing`);
      console.log(`   2. Guide's SDP offer creation is failing`);
      console.log(`   3. Guide's Redis storage is failing`);
      console.log(`   4. Guide WebRTC initialization is not completing`);
    } else {
      console.log(`✅ Found ${allOfferKeys.length} WebRTC offers`);
    }

    if (answerKeys.length > 0) {
      console.log(`⚠️ Found ${answerKeys.length} answer queues but no offers`);
      console.log(`   This suggests attendees are trying to connect but failing`);
    }

  } catch (error) {
    console.error("❌ Error during analysis:", error);
  } finally {
    await client.quit();
    console.log("🔌 Redis connection closed");
  }
})();
