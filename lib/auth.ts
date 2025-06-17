import jwt from "jsonwebtoken"
import type { NextApiRequest } from "next"
import { supabase } from "./supabase"

export interface UserPayload {
  id: string
  email: string
  role: "guide" | "attendee"
}
// Auth result type for better error handling
export type AuthResult = {
  success: true;
  user: UserPayload;
} | {
  success: false;
  error: string;
  code?: string;
}

/**
 * Creates a new user in the Supabase authentication system and the profiles table.
 *
 * @param email - The email address of the new user
 * @param password - The password for the new user
 * @param role - The role of the new user ('guide' or 'attendee')
 * @returns An AuthResult object with success status and user data or error message
 */
export async function createUser(
  email: string,
  password: string,
  role: "guide" | "attendee",
): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    console.error("Error creating user:", error)
    return {
      success: false,
      error: getAuthErrorMessage(error.message, error.status),
      code: error.status?.toString()
    }
  }

  if (data.user) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .insert({ id: data.user.id, email, role })

    if (profileError) {
      console.error("Error creating user profile:", profileError)
      return {
        success: false,
        error: "Failed to create user profile. Please try again."
      }
    }

    return {
      success: true,
      user: { id: data.user.id, email, role }
    }
  }

  return {
    success: false,
    error: "Failed to create user. Please try again."
  }
}

/**
 * Convert Supabase auth errors to user-friendly messages
 */
function getAuthErrorMessage(errorMessage: string, status?: number): string {
  const message = errorMessage.toLowerCase()

  // Password validation errors
  if (message.includes('weak_password') || message.includes('password')) {
    if (message.includes('length')) {
      return "Password must be at least 6 characters long"
    }
    return "Password is too weak. Please use a stronger password"
  }

  // Email validation errors
  if (message.includes('invalid_email') || message.includes('email')) {
    return "Please enter a valid email address"
  }

  // User already exists
  if (message.includes('already_registered') || message.includes('already exists')) {
    return "An account with this email already exists"
  }

  // Rate limiting
  if (message.includes('rate_limit') || status === 429) {
    return "Too many attempts. Please wait a moment and try again"
  }

  // Network/server errors
  if (status && status >= 500) {
    return "Server error. Please try again later"
  }

  // Default fallback
  return errorMessage || "Registration failed. Please try again"
}

/**
 * Authenticates a user with their email and password.
 *
 * @param email - The email address of the user
 * @param password - The password of the user
 * @returns An AuthResult object with success status and user data or error message
 */
export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error("Error authenticating user:", error)
    return {
      success: false,
      error: getLoginErrorMessage(error.message, error.status),
      code: error.status?.toString()
    }
  }

  if (data.user) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single()

    if (profileError) {
      console.error("Error fetching user profile:", profileError)
      return {
        success: false,
        error: "Failed to load user profile. Please try again."
      }
    }

    return {
      success: true,
      user: { id: data.user.id, email: data.user.email!, role: profileData.role }
    }
  }

  return {
    success: false,
    error: "Login failed. Please try again."
  }
}

/**
 * Convert Supabase login errors to user-friendly messages
 */
function getLoginErrorMessage(errorMessage: string, status?: number): string {
  const message = errorMessage.toLowerCase()

  // Invalid credentials
  if (message.includes('invalid_credentials') || message.includes('invalid login')) {
    return "Invalid email or password"
  }

  // Email not confirmed
  if (message.includes('email_not_confirmed')) {
    return "Please check your email and confirm your account"
  }

  // Too many requests
  if (message.includes('rate_limit') || status === 429) {
    return "Too many login attempts. Please wait a moment and try again"
  }

  // Account locked/disabled
  if (message.includes('account_locked') || message.includes('disabled')) {
    return "Account is temporarily locked. Please contact support"
  }

  // Network/server errors
  if (status && status >= 500) {
    return "Server error. Please try again later"
  }

  // Default fallback
  return "Login failed. Please check your credentials and try again"
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
