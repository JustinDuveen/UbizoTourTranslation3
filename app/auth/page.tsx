"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  Mail,
  Lock,
  LogIn,
  UserPlus,
  UserCheck,
  Users,
  Shield,
  Loader2,
  Eye,
  EyeOff,
  Radio,
  Headphones
} from "lucide-react"

export default function Auth() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<"guide" | "attendee">("attendee")
  const [isLoading, setIsLoading] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const router = useRouter()
  const { toast } = useToast()

  // Mouse tracking for interactive effects
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // First try to login
      console.log("Auth attempt:", { email, isRegisterMode })
      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const loginData = await loginResponse.json()
      console.log("Login response:", loginData)

      if (loginResponse.ok) {
        // User exists and login successful
        document.cookie = `token=${loginData.token}; path=/;`

        toast({
          title: "Login Successful",
          description: `Welcome back! Redirecting to ${loginData.user.role} dashboard...`,
        })

        console.log("Redirecting to:", loginData.user.role === "guide" ? "/guide" : "/attendee")
        
        const redirectPath = loginData.user.role === "guide" ? "/guide" : "/attendee"
        setTimeout(() => {
          window.location.replace(redirectPath)
        }, 1000)
      } else {
        // Login failed - check if it's because user doesn't exist
        if (loginData.error && (loginData.error.includes("not found") || loginData.error.includes("does not exist") || loginData.error.includes("Invalid credentials"))) {
          // User doesn't exist, show register mode
          if (!isRegisterMode) {
            setIsRegisterMode(true)
            toast({
              title: "Account Not Found",
              description: "We'll create a new account for you. Please select your role.",
            })
            setIsLoading(false)
            return
          } else {
            // We're in register mode, so register the user
            console.log("Registration attempt:", { email, role })
            const registerResponse = await fetch("/api/auth/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password, role }),
            })
            const registerData = await registerResponse.json()
            console.log("Registration response:", registerData)

            if (registerResponse.ok) {
              document.cookie = `token=${registerData.token}; path=/;`

              toast({
                title: "Account Created Successfully",
                description: `Welcome! Redirecting to your ${role} dashboard...`,
              })

              console.log("Redirecting to:", role === "guide" ? "/guide" : "/attendee")
              
              const redirectPath = role === "guide" ? "/guide" : "/attendee"
              setTimeout(() => {
                window.location.replace(redirectPath)
              }, 1000)
            } else {
              console.log("Registration failed:", registerData.error)
              toast({
                variant: "destructive",
                title: "Registration Failed",
                description: registerData.error,
              })
            }
          }
        } else {
          // Other login error (wrong password, etc.)
          console.log("Login failed:", loginData.error)
          toast({
            variant: "destructive",
            title: "Login Failed",
            description: loginData.error,
          })
        }
      }
    } catch (error) {
      console.error("Auth error:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const resetToLogin = () => {
    setIsRegisterMode(false)
    setRole("attendee")
  }

  return (
    <main className="min-h-screen overflow-hidden relative bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute bottom-40 right-1/3 w-60 h-60 bg-cyan-500/15 rounded-full blur-3xl animate-pulse delay-2000"></div>
      </div>

      {/* Interactive cursor glow */}
      <div
        className="pointer-events-none fixed w-96 h-96 bg-gradient-radial from-blue-500/5 to-transparent rounded-full blur-3xl transition-transform duration-300 ease-out z-0"
        style={{
          left: mousePosition.x - 192,
          top: mousePosition.y - 192,
        }}
      ></div>

      <div className="relative z-10 container mx-auto px-4 sm:px-6 py-6 sm:py-8 min-h-screen flex items-center justify-center">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className={`${isRegisterMode ? 'bg-gradient-to-r from-green-500 to-cyan-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'} rounded-xl p-4 w-16 h-16 mx-auto mb-6 shadow-lg transition-all duration-300`}>
              {isRegisterMode ? <UserPlus className="h-8 w-8 text-white" /> : <LogIn className="h-8 w-8 text-white" />}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
              {isRegisterMode ? "Create Account" : "Welcome Back"}
            </h1>
            <p className="text-white/70">
              {isRegisterMode ? "Join our multilingual tour platform" : "Sign in to your account to continue"}
            </p>
          </div>

          {/* Auth Form */}
          <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-white/20 transition-all duration-300 shadow-2xl">
            <CardHeader className="text-center">
              <CardTitle className="text-white flex items-center justify-center">
                {isRegisterMode ? (
                  <>
                    <Users className="h-5 w-5 mr-2 text-cyan-400" />
                    Sign Up
                  </>
                ) : (
                  <>
                    <UserCheck className="h-5 w-5 mr-2 text-cyan-400" />
                    Sign In
                  </>
                )}
              </CardTitle>
              <CardDescription className="text-white/70">
                {isRegisterMode ? "Create your account to get started" : "Enter your credentials to access your dashboard"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Email Input */}
                <div className="space-y-2">
                  <label htmlFor="email" className="text-white/80 text-sm font-medium flex items-center">
                    <Mail className="h-4 w-4 mr-2 text-blue-400" />
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>

                {/* Password Input */}
                <div className="space-y-2">
                  <label htmlFor="password" className="text-white/80 text-sm font-medium flex items-center">
                    <Lock className="h-4 w-4 mr-2 text-green-400" />
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      id="password"
                      className="w-full p-4 pr-12 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200"
                      placeholder={isRegisterMode ? "Create a password" : "Enter your password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/50 hover:text-white/80 transition-colors"
                      disabled={isLoading}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                {/* Role Selection - only show in register mode */}
                {isRegisterMode && (
                  <div className="space-y-2">
                    <label className="text-white/80 text-sm font-medium flex items-center">
                      <Users className="h-4 w-4 mr-2 text-amber-400" />
                      Account Type
                    </label>
                    <Select onValueChange={(value) => setRole(value as "guide" | "attendee")} defaultValue={role} disabled={isLoading}>
                      <SelectTrigger className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
                        <SelectValue placeholder="Select your role" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-white/20">
                        <SelectItem value="guide" className="text-white hover:bg-white/10 p-3">
                          <div className="flex items-center w-full">
                            <Radio className="h-4 w-4 mr-3 text-orange-400 flex-shrink-0" />
                            <div className="flex-1">
                              <div className="font-medium">Tour Guide</div>
                              <div className="text-xs text-white/60 mt-1">Create and broadcast multilingual tours</div>
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="attendee" className="text-white hover:bg-white/10 p-3">
                          <div className="flex items-center w-full">
                            <Headphones className="h-4 w-4 mr-3 text-cyan-400 flex-shrink-0" />
                            <div className="flex-1">
                              <div className="font-medium">Attendee</div>
                              <div className="text-xs text-white/60 mt-1">Join and listen to live tours</div>
                            </div>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Auth Button */}
                <Button
                  type="submit"
                  disabled={isLoading || !email.trim() || !password.trim()}
                  className={`w-full ${isRegisterMode ? 'bg-gradient-to-r from-green-500 to-cyan-500 hover:from-green-600 hover:to-cyan-600' : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'} text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 min-h-[48px]`}
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      {isRegisterMode ? "Creating Account..." : "Signing In..."}
                    </>
                  ) : (
                    <>
                      {isRegisterMode ? (
                        <>
                          <UserPlus className="h-5 w-5 mr-2" />
                          Create Account
                        </>
                      ) : (
                        <>
                          <LogIn className="h-5 w-5 mr-2" />
                          Sign In
                        </>
                      )}
                    </>
                  )}
                </Button>
              </form>

              {/* Mode Toggle */}
              {isRegisterMode && (
                <div className="mt-6 text-center">
                  <p className="text-white/60 text-sm">
                    Already have an account?{" "}
                    <button
                      onClick={resetToLogin}
                      className="text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
                      disabled={isLoading}
                    >
                      Sign In Instead
                    </button>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="mt-8 text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Shield className="h-4 w-4 text-green-400" />
              <span className="text-white/80 text-sm">Secure • Encrypted • Private</span>
            </div>
            <p className="text-white/60 text-sm">
              Powered by Advanced AI Translation •
              <span className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer ml-1">
                VirtualAIWorkforce.com
              </span>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}