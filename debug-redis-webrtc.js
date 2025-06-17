const redis = require("redis");

// Create a Redis client
const client = redis.createClient({
  url: "redis://127.0.0.1:6379", // Default Redis address
});

// Connect to Redis
client.connect();

client.on("connect", () => {
  console.log("✅ Connected to Redis");
});

client.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

// Comprehensive Redis debugging
(async () => {
  try {
    console.log("\n🔍 REDIS WEBRTC DEBUGGING SCRIPT");
    console.log("=====================================\n");

    // 1. Check all tour codes
    console.log("1️⃣ CHECKING TOUR CODES:");
    const tourCodeKeys = await client.keys("tour_codes:*");
    console.log(`Found ${tourCodeKeys.length} tour codes:`, tourCodeKeys);

    for (const codeKey of tourCodeKeys) {
      const tourId = await client.get(codeKey);
      const tourCode = codeKey.replace('tour_codes:', '');
      console.log(`   📋 Tour Code: ${tourCode} → Tour ID: ${tourId}`);
    }

    // 2. Check all tours
    console.log("\n2️⃣ CHECKING TOURS:");
    const tourKeys = await client.keys("tour:*");
    const mainTourKeys = tourKeys.filter(key => {
      // Only include main tour keys (not sub-keys like :offer:, :attendees:, etc.)
      const parts = key.split(':');
      return parts.length === 2 && parts[0] === 'tour' && parts[1].includes('tour_');
    });
    console.log(`Found ${mainTourKeys.length} main tours out of ${tourKeys.length} total tour keys`);

    for (const tourKey of mainTourKeys) {
      const tourData = await client.get(tourKey);
      if (tourData) {
        try {
          const tour = JSON.parse(tourData);
          const tourId = tourKey.replace('tour:', '');
          console.log(`   🎯 Tour ID: ${tourId}`);
          console.log(`      Status: ${tour.status}`);
          console.log(`      Primary Language: ${tour.primaryLanguage}`);
          console.log(`      Languages: ${JSON.stringify(tour.languages)}`);
          console.log(`      Start Time: ${tour.startTime}`);

          // Check supported languages
          const supportedLangs = await client.smembers(`tour:${tourId}:supported_languages`);
          console.log(`      Supported Languages in Redis: ${JSON.stringify(supportedLangs)}`);
        } catch (parseError) {
          const tourId = tourKey.replace('tour:', '');
          console.log(`   ⚠️ Tour ID: ${tourId} - JSON Parse Error: ${parseError.message}`);
          console.log(`      Raw data: ${tourData.substring(0, 100)}...`);
        }
      }
    }

    // 3. Check WebRTC offers
    console.log("\n3️⃣ CHECKING WEBRTC OFFERS:");
    const offerKeys = await client.keys("tour:*:offer:*");
    console.log(`Found ${offerKeys.length} WebRTC offers:`, offerKeys);

    for (const offerKey of offerKeys) {
      const offerData = await client.get(offerKey);
      if (offerData) {
        try {
          const offer = JSON.parse(offerData);
          const parts = offerKey.split(':');
          const tourId = parts[1];
          const language = parts[3];

          console.log(`   🎙️ Offer: ${offerKey}`);
          console.log(`      Tour ID: ${tourId}`);
          console.log(`      Language: ${language}`);
          console.log(`      Offer Type: ${offer.type || 'unknown'}`);

          // Check if it's a placeholder
          const isPlaceholder =
            (offer.status === 'pending') ||
            (offer.offer && typeof offer.offer === 'string' && offer.offer.includes('Initialized offer for')) ||
            (offer.sdp && typeof offer.sdp === 'string' && !offer.sdp.includes('v='));

          console.log(`      Is Placeholder: ${isPlaceholder}`);

          if (offer.sdp) {
            console.log(`      SDP Preview: ${offer.sdp.substring(0, 100)}...`);
            console.log(`      Has v= marker: ${offer.sdp.includes('v=')}`);
            console.log(`      SDP Length: ${offer.sdp.length} chars`);
          } else {
            console.log(`      ⚠️ No SDP content found`);
          }
        } catch (e) {
          console.log(`   ❌ Error parsing offer ${offerKey}:`, e.message);
        }
      }
    }

    // 4. Check attendees
    console.log("\n4️⃣ CHECKING ATTENDEES:");
    const attendeeKeys = await client.keys("tour:*:attendees:*");
    console.log(`Found ${attendeeKeys.length} attendee groups:`, attendeeKeys);

    for (const attendeeKey of attendeeKeys) {
      const attendees = await client.smembers(attendeeKey);
      const parts = attendeeKey.split(':');
      const tourId = parts[1];
      const language = parts[3];

      console.log(`   👥 Attendees: ${attendeeKey}`);
      console.log(`      Tour ID: ${tourId}`);
      console.log(`      Language: ${language}`);
      console.log(`      Count: ${attendees.length}`);
      console.log(`      Names: ${JSON.stringify(attendees)}`);
    }

    // 5. Check answers
    console.log("\n5️⃣ CHECKING ATTENDEE ANSWERS:");
    const answerKeys = await client.keys("tour:*:*:answers");
    console.log(`Found ${answerKeys.length} answer queues:`, answerKeys);

    for (const answerKey of answerKeys) {
      const answers = await client.lRange(answerKey, 0, -1);
      const parts = answerKey.split(':');
      const tourId = parts[1];
      const language = parts[2];

      console.log(`   📝 Answers: ${answerKey}`);
      console.log(`      Tour ID: ${tourId}`);
      console.log(`      Language: ${language}`);
      console.log(`      Count: ${answers.length}`);

      answers.forEach((answer, index) => {
        try {
          const parsedAnswer = JSON.parse(answer);
          console.log(`      Answer ${index + 1}: Type=${parsedAnswer.type}, SDP Length=${parsedAnswer.sdp?.length || 0}`);
        } catch (e) {
          console.log(`      Answer ${index + 1}: Parse error - ${e.message}`);
        }
      });
    }

    // 6. Check ICE candidates
    console.log("\n6️⃣ CHECKING ICE CANDIDATES:");
    const iceKeys = await client.keys("tour:*:ice:*");
    console.log(`Found ${iceKeys.length} ICE candidate stores:`, iceKeys);

    for (const iceKey of iceKeys) {
      const candidates = await client.lRange(iceKey, 0, -1);
      console.log(`   🧊 ICE: ${iceKey}`);
      console.log(`      Count: ${candidates.length}`);

      if (candidates.length > 0) {
        try {
          const firstCandidate = JSON.parse(candidates[0]);
          console.log(`      First candidate: ${firstCandidate.candidate?.substring(0, 50) || 'No candidate string'}...`);
        } catch (e) {
          console.log(`      First candidate parse error: ${e.message}`);
        }
      }
    }

    // 7. Test attendee flow simulation
    console.log("\n7️⃣ SIMULATING ATTENDEE FLOW:");
    if (tourCodeKeys.length > 0) {
      const testTourCode = tourCodeKeys[0].replace('tour_codes:', '');
      const testTourId = await client.get(tourCodeKeys[0]);

      console.log(`🧪 Testing with tour code: ${testTourCode}, tour ID: ${testTourId}`);

      // Check what languages are available
      const supportedLangs = await client.smembers(`tour:${testTourId}:supported_languages`);
      console.log(`   Available languages: ${JSON.stringify(supportedLangs)}`);

      if (supportedLangs.length > 0) {
        const testLang = supportedLangs[0];
        const offerKey = `tour:${testTourId}:offer:${testLang}`;
        const hasOffer = await client.exists(offerKey);

        console.log(`   Testing language: ${testLang}`);
        console.log(`   Offer exists at ${offerKey}: ${hasOffer ? '✅' : '❌'}`);

        if (hasOffer) {
          const offerData = await client.get(offerKey);
          try {
            const offer = JSON.parse(offerData);
            console.log(`   Offer type: ${offer.type || 'unknown'}`);
            console.log(`   Has SDP: ${!!offer.sdp}`);
            console.log(`   SDP valid: ${offer.sdp && offer.sdp.includes('v=') ? '✅' : '❌'}`);
          } catch (e) {
            console.log(`   ❌ Offer parse error: ${e.message}`);
          }
        }

        // Check for attendee answers
        const answerKey = `tour:${testTourId}:${testLang}:answers`;
        const answerCount = await client.lLen(answerKey);
        console.log(`   Attendee answers: ${answerCount}`);
      }
    }

    console.log("\n✅ REDIS DEBUGGING COMPLETE");
    console.log("=====================================");
    console.log("\n📋 SUMMARY:");
    console.log(`   Tours: ${mainTourKeys.length}`);
    console.log(`   Offers: ${offerKeys.length}`);
    console.log(`   Attendee Groups: ${attendeeKeys.length}`);
    console.log(`   Answer Queues: ${answerKeys.length}`);
    console.log(`   ICE Stores: ${iceKeys.length}`);

  } catch (error) {
    console.error("❌ Error during debugging:", error);
  } finally {
    // Close connection
    await client.quit();
    console.log("🔌 Redis connection closed");
  }
})();
