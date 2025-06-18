// lib/redis.ts - Railway-optimized Redis client using ioredis
import Redis from "ioredis"

// Initialize connection state and client
let isConnected = false
let client: Redis | null = null
let connectionPromise: Promise<Redis> | null = null

// Helper function to parse Railway Redis URL
function parseRedisUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined
    };
  } catch (error) {
    console.error('Failed to parse Redis URL:', error);
    return {};
  }
}

// Function to get connected client with improved connection management
export async function getRedisClient(): Promise<Redis> {
  // If we already have a connected client, return it immediately
  if (client && isConnected) {
    try {
      // Quick connection check without ping to reduce latency
      if (client.status === 'ready') {
        return client;
      }
    } catch (error) {
      // If there's an error, we'll reconnect below
      isConnected = false;
      client = null;
    }
  }

  // If we're already in the process of connecting, wait for that connection
  if (connectionPromise) {
    return await connectionPromise;
  }

  // Connect to Redis if not already connected or if previous connection is invalid
  if (!isConnected) {
    connectionPromise = connectToRedis();
    try {
      client = await connectionPromise;
      return client;
    } finally {
      connectionPromise = null;
    }
  }
  return client!; // We know client is not null here
}

async function connectToRedis(): Promise<Redis> {
  try {
    // Railway Redis configuration - supports both URL and individual params
    const redisConfig: any = process.env.REDIS_URL
      ? parseRedisUrl(process.env.REDIS_URL)
      : {
          host: process.env.REDIS_HOST || "localhost",
          port: parseInt(process.env.REDIS_PORT || "6379"),
          password: process.env.REDIS_PASSWORD || undefined
        };

    const newClient = new Redis({
      ...redisConfig,
      // Railway IPv6 support - CRITICAL for Railway's private network
      family: 0, // Enable dual stack lookup (IPv4 + IPv6)
      // Railway-optimized settings
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
      // Faster reconnection for Railway
      retryDelayOnClusterDown: 300,
      retryDelayAfter: 100,
      // Keep connection alive
      keepAlive: 30000
    });

    // Reduce logging noise in development
    newClient.on("error", (err: Error) => {
      if (!err.message.includes('ECONNREFUSED')) {
        console.log("Redis Client Error", err);
      }
    });

    // Only log initial connection, not reconnections
    let hasConnectedBefore = false;
    newClient.on("connect", () => {
      if (!hasConnectedBefore) {
        console.log("Redis client connected");
        hasConnectedBefore = true;
      }
    });

    // ioredis connects automatically, but we can force connection
    await newClient.ping();
    isConnected = true;
    client = newClient;

    // Only log success message once
    if (!hasConnectedBefore) {
      console.log("Redis client connected successfully");
    }

    return newClient;
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
    isConnected = false;
    client = null;
    throw error;
  }
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
  validateResults?: (results: [Error | null, unknown][]) => boolean
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
): Promise<[Error | null, unknown][]> {
  const {
    maxRetries = 3,
    logPrefix = '[REDIS]',
    validateResults = (results) => validateTransactionResults(results, operations.length)
  } = options

  const redis = await getRedisClient()
  let attempt = 0
  let lastError: Error | null = null

  // Validate operations before attempting execution
  const validationErrors = validateTransactionOperations(operations);
  if (validationErrors.length > 0) {
    console.error(`${logPrefix} Transaction validation failed:`);
    validationErrors.forEach(error => console.error(`${logPrefix} - ${error}`));
    throw new Error(`Transaction validation failed: ${validationErrors[0]}`);
  }

  while (attempt < maxRetries) {
    attempt++
    try {
      console.log(`${logPrefix} Executing transaction (attempt ${attempt}/${maxRetries})...`)

      // Start the transaction
      const multi = redis.multi()

      // Add all operations to the transaction
      for (const [command, ...args] of operations) {
        const cmd = command.toLowerCase();
        try {
          // ioredis method calls - cast to any to bypass TypeScript spread restrictions
          const redisMulti = multi as any;
          switch (cmd) {
            case 'get':
              redisMulti.get(args[0]);
              break;
            case 'set':
              redisMulti.set(args[0], args[1], ...args.slice(2));
              break;
            case 'del':
              redisMulti.del(...args);
              break;
            case 'srem':
              redisMulti.srem(args[0], ...args.slice(1)); // ioredis uses lowercase
              break;
            case 'sadd':
              redisMulti.sadd(args[0], ...args.slice(1)); // ioredis uses lowercase
              break;
            case 'exists':
              redisMulti.exists(...args);
              break;
            case 'expire':
              redisMulti.expire(args[0], args[1]);
              break;
            case 'ttl':
              redisMulti.ttl(args[0]);
              break;
            default:
              console.error(`${logPrefix} Unsupported Redis command: ${command}`);
              throw new Error(`Unsupported Redis command: ${command}`);
          }
        } catch (error) {
          console.error(`${logPrefix} Error executing command ${command} with args:`, args);
          console.error(`${logPrefix} Error details:`, error);
          throw error;
        }
      }

      // Execute the transaction
      const results = await multi.exec()

      // Check if results is null (transaction failed)
      if (!results) {
        throw new Error(`Transaction execution failed - results is null`)
      }

      // Validate the results
      if (!validateResults(results)) {
        throw new Error(`Transaction validation failed`)
      }

      console.log(`${logPrefix} Transaction executed successfully`)
      return results
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`${logPrefix} Transaction failed (attempt ${attempt}/${maxRetries}):`, lastError.message)

      // Log more detailed error information
      console.error(`${logPrefix} Transaction operations:`, operations.map(([cmd, ...args]) => ({ command: cmd, args })))
      console.error(`${logPrefix} Error stack:`, error instanceof Error ? error.stack : 'No stack trace available')

      if (attempt < maxRetries) {
        // Wait before retrying with exponential backoff
        const delay = Math.min(100 * Math.pow(2, attempt), 2000)
        console.log(`${logPrefix} Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Transaction failed after maximum retries')
}

/**
 * Validate if a Redis command is supported
 *
 * @param command The Redis command to validate
 * @returns True if the command is supported, false otherwise
 */
export function isCommandSupported(command: string): boolean {
  const supportedCommands = [
    'get', 'set', 'del', 'srem', 'sadd', 'exists', 'expire', 'ttl'
  ];
  return supportedCommands.includes(command.toLowerCase());
}

/**
 * Validate transaction operations before execution
 *
 * @param operations Array of Redis operations to validate
 * @returns Array of validation errors, empty if all operations are valid
 */
export function validateTransactionOperations(operations: RedisTransactionOperation[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < operations.length; i++) {
    const [command] = operations[i];

    if (!command || typeof command !== 'string') {
      errors.push(`Operation ${i}: Invalid command format`);
      continue;
    }

    if (!isCommandSupported(command)) {
      errors.push(`Operation ${i}: Unsupported command '${command}'`);
    }
  }

  return errors;
}

/**
 * Validate transaction results
 *
 * @param results Results from the transaction
 * @param expectedLength Expected number of results
 * @returns True if results are valid, false otherwise
 */
export function validateTransactionResults(results: [Error | null, unknown][], expectedLength: number): boolean {
  // Check if we have the expected number of results
  if (!results || !Array.isArray(results) || results.length !== expectedLength) {
    console.error(`[REDIS] Invalid transaction results: expected ${expectedLength} results, got ${results?.length || 0}`)
    return false
  }

  // Check if any result is an error (ioredis format: [error, result])
  for (let i = 0; i < results.length; i++) {
    const [error, result] = results[i]
    if (error) {
      console.error(`[REDIS] Transaction operation ${i} failed:`, error)
      return false
    }
  }

  return true
}
