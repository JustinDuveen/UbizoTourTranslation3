// lib/redis.js
import { createClient } from "redis"

// Initialize connection state and client
let isConnected = false
let client: any = null

// Function to get connected client
export async function getRedisClient() {
  // Check if client exists and is connected
  if (client && isConnected) {
    try {
      // Check if client is still connected by pinging
      await client.ping();
      return client;
    } catch (error) {
      console.log("Redis client disconnected, reconnecting...");
      // Client is disconnected, will create a new one
      isConnected = false;
      client = null;
    }
  }

  // Connect to Redis if not already connected or if previous connection is invalid
  if (!isConnected) {
    try {
      client = createClient({
        url: `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || "6379"}`,
        password: process.env.REDIS_PASSWORD || undefined,
        socket: {
          reconnectStrategy: (retries) => {
            // Exponential backoff with max delay of 10 seconds
            return Math.min(retries * 100, 10000);
          }
        }
      })

      client.on("error", (err: Error) => console.log("Redis Client Error", err))
      client.on("reconnecting", () => console.log("Redis client reconnecting..."))
      client.on("connect", () => console.log("Redis client connected"))
      
      await client.connect()
      isConnected = true
      console.log("Redis client connected successfully")
    } catch (error) {
      console.error("Failed to connect to Redis:", error)
      throw error
    }
  }
  return client
}

// Export the getRedisClient function as the default export
export default getRedisClient
