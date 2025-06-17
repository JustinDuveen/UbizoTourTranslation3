import type { NextApiRequest, NextApiResponse } from "next"
import { getRedisClient } from "@/lib/redis"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const redis = await getRedisClient()
    await redis.set("test", "Hello, Redis!")
    const value = await redis.get("test")
    res.status(200).json({ message: "Redis connection successful", value })
  } catch (error) {
    console.error("Redis test error:", error)
    res.status(500).json({ 
      error: "Redis connection failed", 
      message: error instanceof Error ? error.message : String(error) 
    })
  }
}
