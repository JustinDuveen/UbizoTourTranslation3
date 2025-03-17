import { NextResponse } from "next/server"
import { authenticateUser, generateToken } from "@/lib/auth"
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { email, password } = await request.json()

  console.log("Login attempt for:", email)
  const user = await authenticateUser(email, password)
  console.log("Authenticated user:", user)
  if (!user) {
    console.log("Authentication failed")
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  const token = generateToken(user)
  
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
      id: user.id,
      email: user.email,
      role: user.role
    }
  }
  console.log("Login response:", response)
  return NextResponse.json(response)
}
