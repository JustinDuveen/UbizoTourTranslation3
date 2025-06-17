import type { NextApiRequest, NextApiResponse } from "next"
import redisClient from "@/lib/redis"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query

  try {
    const redis = await redisClient()

    // Try to get tour data from Redis cache
    const cachedTour = await redis.get(`tour:${id}`)

    if (cachedTour) {
      return res.status(200).json(JSON.parse(cachedTour))
    }

    // If not in cache, fetch from database (example using Supabase)
    const { data: tour, error } = await supabase.from("tours").select("*").eq("id", id).single()

    if (error) {
      throw error
    }

    // Cache the tour data in Redis
    await redis.set(`tour:${id}`, JSON.stringify(tour), "EX", 3600)

    res.status(200).json(tour)
  } catch (error) {
    console.error("Error:", error)
    res.status(500).json({ error: "An error occurred while fetching the tour" })
  }
}

