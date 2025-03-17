import redisClient from "@/lib/redis"
import NextAuth from "next-auth"

// ... other imports and code

const handler = NextAuth({
  // ... your NextAuth configuration

  events: {
    async signIn({ user }) {
      await redisClient.connect()
      await redisClient.set(`user:${user.id}`, JSON.stringify(user))
    },
    async signOut({ token }) {
      await redisClient.connect()
      await redisClient.del(`user:${token.sub}`)
    },
  },
})

export default handler

