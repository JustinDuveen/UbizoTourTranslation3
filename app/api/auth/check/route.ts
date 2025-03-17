import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { cookies } from 'next/headers'
import { verifyToken } from "@/lib/auth"

export async function GET() {
  try {
    // Get token from cookies only to be consistent with middleware
    const token = cookies().get('token')?.value
    const user = token ? verifyToken(token) : null

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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
