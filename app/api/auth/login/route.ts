import { NextResponse } from "next/server"
import { authenticateUser, generateToken } from "@/lib/auth"
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { email, password } = await request.json()

  console.log("Login attempt for:", email)
  const result = await authenticateUser(email, password)
  console.log("Authentication result:", result)

  if (!result.success) {
    console.log("Authentication failed:", result.error)
    return NextResponse.json({
      error: result.error,
      code: result.code
    }, { status: 401 })
  }

  const token = generateToken(result.user)

  // Set the token as an HTTP-only cookie
  cookies().set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  })

  const response = {
    token,
    user: {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role
    }
  }
  console.log("Login response:", response)
  return NextResponse.json(response)
}
