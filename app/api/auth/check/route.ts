import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { cookies } from 'next/headers'
import { verifyToken } from "@/lib/auth"

export async function GET() {
  try {
    // Get token from cookies only to be consistent with middleware
    console.log("Auth check: Getting token from cookies")
    const allCookies = cookies().getAll()
    console.log("All cookies:", allCookies.map(c => c.name))

    const token = cookies().get('token')?.value
    console.log("Token from cookies:", token ? "Present" : "Not present")

    const user = token ? verifyToken(token) : null
    console.log("User after verification:", user)

    if (!user) {
      console.log("Auth check: No valid user found")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log(`Auth check: User authenticated as ${user.role}`)
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    })
  } catch (error) {
    console.error("Auth check error:", error)
    return NextResponse.json({
      error: "Authentication failed",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 401 })
  }
}
