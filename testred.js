const redis = require("redis");

// Create a Redis client
const client = redis.createClient({
  url: "redis://127.0.0.1:6379", // Default Redis address
});

// Connect to Redis
client.connect();

client.on("connect", () => {
  console.log("Connected to Redis");
});

client.on("error", (err) => {
  console.error("Redis error:", err);
});

// List and Get tour offers
(async () => {
  const keys = await client.keys("tour:*:offer:*");
  console.log("Keys matching tour:*:offer:*:", keys);

  if (keys.length > 0) {
    const offerKey = keys[0]; // Get the first key
    const offerValue = await client.get(offerKey);
    console.log(`Value for key ${offerKey}:`, offerValue);
  } else {
    console.log("No tour offers found.");
  }

  // Close connection
  client.quit();
})();
