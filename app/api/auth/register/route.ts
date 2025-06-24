import { NextResponse } from "next/server"
import { createUser, generateToken } from "@/lib/auth"

export async function POST(request: Request) {
  const { email, password, role } = await request.json()
  console.log("Registration attempt:", { email, role })

  const result = await createUser(email, password, role as "guide" | "attendee")
  console.log("Registration result:", result)

  if (!result.success) {
    console.log("User creation failed:", result.error)
    return NextResponse.json({
      error: result.error,
      code: result.code
    }, { status: 400 })
  }

  const token = generateToken(result.user)
  const response = {
    token,
    user: {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role
    }
  }
  console.log("Registration response:", response)
  return NextResponse.json(response)
}
