// lib/redis.js
import { createClient } from "redis"

// Initialize connection state and client
let isConnected = false
let client: any = null

// Function to get connected client
export async function getRedisClient() {
  // Connect to real Redis if not already connected
  if (!isConnected) {
    try {
      client = createClient({
        url: `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || "6379"}`,
        password: process.env.REDIS_PASSWORD || undefined,
      })

      client.on("error", (err: Error) => console.log("Redis Client Error", err))
      
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