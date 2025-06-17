import redisClient from "@/lib/redis"
import NextAuth from "next-auth"

// ... other imports and code

const handler = NextAuth({
  // ... your NextAuth configuration
  providers: [
    // Add your authentication providers here
    // Example: GoogleProvider, CredentialsProvider, etc.
  ],

  events: {
    async signIn({ user }) {
      const redis = await redisClient()
      await redis.set(`user:${user.id}`, JSON.stringify(user))
    },
    async signOut({ token }) {
      const redis = await redisClient()
      await redis.del(`user:${token.sub}`)
    },
  },
})

export default handler

