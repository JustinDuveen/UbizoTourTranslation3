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

/**
 * Transaction operation type
 */
export type RedisTransactionOperation = [string, ...any[]]

/**
 * Options for executing a Redis transaction
 */
export interface RedisTransactionOptions {
  maxRetries?: number
  logPrefix?: string
  validateResults?: (results: any[]) => boolean
}

/**
 * Execute a Redis transaction with proper error handling and retries
 *
 * @param operations Array of Redis operations to execute in the transaction
 * @param options Transaction options
 * @returns Results of the transaction
 */
export async function executeRedisTransaction(
  operations: RedisTransactionOperation[],
  options: RedisTransactionOptions = {}
): Promise<any[]> {
  const {
    maxRetries = 3,
    logPrefix = '[REDIS]',
    validateResults = (results) => validateTransactionResults(results, operations.length)
  } = options

  const redis = await getRedisClient()
  let attempt = 0
  let lastError: Error | null = null

  while (attempt < maxRetries) {
    attempt++
    try {
      console.log(`${logPrefix} Executing transaction (attempt ${attempt}/${maxRetries})...`)

      // Start the transaction
      const multi = redis.multi()

      // Add all operations to the transaction
      for (const [command, ...args] of operations) {
        multi[command.toLowerCase()](...args)
      }

      // Execute the transaction
      const results = await multi.exec()

      // Validate the results
      if (!validateResults(results)) {
        throw new Error(`Transaction validation failed`)
      }

      console.log(`${logPrefix} Transaction executed successfully`)
      return results
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`${logPrefix} Transaction failed (attempt ${attempt}/${maxRetries}):`, lastError.message)

      if (attempt < maxRetries) {
        // Wait before retrying with exponential backoff
        const delay = Math.min(100 * Math.pow(2, attempt), 2000)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Transaction failed after maximum retries')
}

/**
 * Validate transaction results
 *
 * @param results Results from the transaction
 * @param expectedLength Expected number of results
 * @returns True if results are valid, false otherwise
 */
export function validateTransactionResults(results: any[], expectedLength: number): boolean {
  // Check if we have the expected number of results
  if (!results || !Array.isArray(results) || results.length !== expectedLength) {
    console.error(`[REDIS] Invalid transaction results: expected ${expectedLength} results, got ${results?.length || 0}`)
    return false
  }

  // Check if any result is an error
  for (let i = 0; i < results.length; i++) {
    if (results[i] instanceof Error) {
      console.error(`[REDIS] Transaction operation ${i} failed:`, results[i])
      return false
    }
  }

  return true
}
