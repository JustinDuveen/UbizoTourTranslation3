import jwt from "jsonwebtoken"
import type { NextApiRequest } from "next"
import { supabase } from "./supabase"

export interface UserPayload {
  id: string
  email: string
  role: "guide" | "attendee"
}
/**
 * Creates a new user in the Supabase authentication system and the profiles table.
 *
 * @param email - The email address of the new user
 * @param password - The password for the new user
 * @param role - The role of the new user ('guide' or 'attendee')
 * @returns A UserPayload object if successful, null otherwise
 */
export async function createUser(
  email: string,
  password: string,
  role: "guide" | "attendee",
): Promise<UserPayload | null> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    console.error("Error creating user:", error)
    return null
  }

  if (data.user) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .insert({ id: data.user.id, email, role })

    if (profileError) {
      console.error("Error creating user profile:", profileError)
      return null
    }

    return { id: data.user.id, email, role }
  }

  return null
}

/**
 * Authenticates a user with their email and password.
 *
 * @param email - The email address of the user
 * @param password - The password of the user
 * @returns A UserPayload object if authentication is successful, null otherwise
 */
export async function authenticateUser(email: string, password: string): Promise<UserPayload | null> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error("Error authenticating user:", error)
    return null
  }

  if (data.user) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single()

    if (profileError) {
      console.error("Error fetching user profile:", profileError)
      return null
    }

    return { id: data.user.id, email: data.user.email!, role: profileData.role }
  }

  return null
}

/**
 * Generates a JWT token for a user.
 *
 * @param user - The UserPayload object containing user information
 * @returns A JWT token string
 */
export function generateToken(user: UserPayload): string {
  return jwt.sign(user, process.env.JWT_SECRET as string, { expiresIn: "1d" })
}

/**
 * Verifies a JWT token and returns the user payload.
 *
 * @param token - The JWT token to verify
 * @returns A UserPayload object if the token is valid, null otherwise
 */
export function verifyToken(token: string): UserPayload | null {
  try {
    return jwt.verify(token, process.env.JWT_SECRET as string) as UserPayload
  } catch (error) {
    return null
  }
}

/**
 * Extracts the user payload from the authorization header in a request.
 *
 * @param req - The NextApiRequest object
 * @returns A UserPayload object if a valid token is present, null otherwise
 */
export function getUserFromRequest(req: NextApiRequest): UserPayload | null {
  const token = req.headers.authorization?.split(" ")[1]
  return token ? verifyToken(token) : null
}
