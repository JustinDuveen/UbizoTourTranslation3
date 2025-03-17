"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"

export default function Register() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"guide" | "attendee">("attendee")
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      console.log("Registration attempt:", { email, role })
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      })
      const data = await response.json()
      console.log("Registration response:", data)
      
      if (response.ok) {
        // Set the token cookie
        document.cookie = `token=${data.token}; path=/;`
        
        // Log the redirection
        console.log("Redirecting to:", role === "guide" ? "/guide" : "/attendee")
        
        // Force a hard redirect based on role
        const redirectPath = role === "guide" ? "/guide" : "/attendee"
        window.location.replace(redirectPath)
      } else {
        console.log("Registration failed:", data.error)
        toast({
          variant: "destructive",
          title: "Registration Failed",
          description: data.error,
        })
      }
    } catch (error) {
      console.error("Registration error:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
      })
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Register</h1>
      <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-md">
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Select onValueChange={(value) => setRole(value as "guide" | "attendee")} defaultValue={role}>
          <SelectTrigger>
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="guide">Guide</SelectItem>
            <SelectItem value="attendee">Attendee</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" className="w-full">
          Register
        </Button>
      </form>
    </div>
  )
}
