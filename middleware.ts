import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify } from "jose"
import type { UserPayload } from "./lib/auth"

export const runtime = 'experimental-edge'

// Verify token function for middleware using jose (works in Edge Runtime)
async function verifyToken(token: string): Promise<UserPayload | null> {
  try {
    const secret = process.env.JWT_SECRET
    if (!secret) {
      console.error("JWT_SECRET not found in environment")
      return null
    }

    const encoder = new TextEncoder()
    const { payload } = await jwtVerify(token, encoder.encode(secret))
    return payload as unknown as UserPayload
  } catch (error) {
    console.error("Token verification failed:", error)
    return null
  }
}

export async function middleware(request: NextRequest) {
  console.log("Middleware - Path:", request.nextUrl.pathname)
  const token = request.cookies.get("token")?.value
  console.log("Middleware - Token:", token ? "Present" : "Not present")

  // Check if path starts with /guide or /attendee
  const isGuidePath = request.nextUrl.pathname.startsWith("/guide")
  const isAttendeePath = request.nextUrl.pathname.startsWith("/attendee")

  if (isGuidePath || isAttendeePath) {
    if (!token) {
      console.log("Middleware - No token, redirecting to auth")
      return NextResponse.redirect(new URL("/auth", request.url))
    }

    const user = await verifyToken(token)
    console.log("Middleware - Verified user:", user)
    
    if (!user) {
      console.log("Middleware - Invalid token, redirecting to auth")
      return NextResponse.redirect(new URL("/auth", request.url))
    }

    // Check if user has correct role for the path
    if (isGuidePath && user.role !== "guide") {
      console.log("Middleware - Not a guide, redirecting to auth")
      return NextResponse.redirect(new URL("/auth", request.url))
    }
    if (isAttendeePath && user.role !== "attendee") {
      console.log("Middleware - Not an attendee, redirecting to auth")
      return NextResponse.redirect(new URL("/auth", request.url))
    }

    console.log("Middleware - Access granted")
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/guide", "/guide/:path*", "/attendee", "/attendee/:path*"]
}
