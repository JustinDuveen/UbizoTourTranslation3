import { NextResponse } from "next/server"
import { createUser, generateToken } from "@/lib/auth"

export async function POST(request: Request) {
  const { email, password, role } = await request.json()
  console.log("Registration attempt:", { email, role })

  const user = await createUser(email, password, role as "guide" | "attendee")
  console.log("Created user:", user)
  if (!user) {
    console.log("User creation failed")
    return NextResponse.json({ error: "Failed to create user" }, { status: 400 })
  }

  const token = generateToken(user)
  const response = { 
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  }
  console.log("Registration response:", response)
  return NextResponse.json(response)
}
