"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Headphones, Globe, ArrowRight } from "lucide-react"

/**
 * Landing Page Component
 *
 * This is the main landing page for the Ubizo Tour Translation application.
 * It provides an overview of the application and directs users to the appropriate sections
 * based on their role (guide or attendee).
 *
 * Features:
 * - Welcome message and application overview
 * - Role-based navigation (Guide vs Attendee)
 * - Authentication check and redirect
 * - Clean, professional interface
 */
export default function Home() {
  const router = useRouter()
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

  // Check if user is already authenticated and redirect appropriately
  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        const response = await fetch("/api/auth/check", {
          credentials: "include"
        })

        if (response.ok) {
          const data = await response.json()
          if (data.user?.role === "guide") {
            router.push("/guide")
            return
          } else if (data.user?.role === "attendee") {
            router.push("/attendee")
            return
          }
        }
      } catch (error) {
        // User not authenticated, stay on landing page
        console.log("User not authenticated, showing landing page")
      } finally {
        setIsCheckingAuth(false)
      }
    }

    checkAuthAndRedirect()
  }, [router])

  if (isCheckingAuth) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Ubizo Tour Translation
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Real-time multilingual tour translation powered by AI.
            Connect guides and attendees across language barriers with crystal-clear audio translation.
          </p>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="text-center">
            <div className="bg-blue-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <Globe className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Multiple Languages</h3>
            <p className="text-gray-600">Support for dozens of languages with real-time translation</p>
          </div>
          <div className="text-center">
            <div className="bg-green-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <Headphones className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Crystal Clear Audio</h3>
            <p className="text-gray-600">High-quality audio streaming with minimal latency</p>
          </div>
          <div className="text-center">
            <div className="bg-purple-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-purple-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Easy to Use</h3>
            <p className="text-gray-600">Simple interface for both guides and tour attendees</p>
          </div>
        </div>

        {/* Role Selection */}
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-8">Get Started</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Guide Card */}
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => router.push("/login")}>
              <CardHeader className="text-center">
                <div className="bg-blue-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <Users className="h-10 w-10 text-blue-600" />
                </div>
                <CardTitle className="text-2xl">I'm a Tour Guide</CardTitle>
                <CardDescription className="text-base">
                  Start broadcasting your tour in multiple languages simultaneously
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 mb-6">
                  <li className="flex items-center text-sm">
                    <ArrowRight className="h-4 w-4 text-green-500 mr-2" />
                    Create and manage tours
                  </li>
                  <li className="flex items-center text-sm">
                    <ArrowRight className="h-4 w-4 text-green-500 mr-2" />
                    Broadcast to multiple languages
                  </li>
                  <li className="flex items-center text-sm">
                    <ArrowRight className="h-4 w-4 text-green-500 mr-2" />
                    Monitor attendee connections
                  </li>
                </ul>
                <Button className="w-full" size="lg">
                  Start as Guide
                </Button>
              </CardContent>
            </Card>

            {/* Attendee Card */}
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => router.push("/attendee")}>
              <CardHeader className="text-center">
                <div className="bg-green-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <Headphones className="h-10 w-10 text-green-600" />
                </div>
                <CardTitle className="text-2xl">I'm an Attendee</CardTitle>
                <CardDescription className="text-base">
                  Join a tour and receive real-time translation in your language
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 mb-6">
                  <li className="flex items-center text-sm">
                    <ArrowRight className="h-4 w-4 text-green-500 mr-2" />
                    Enter tour code to join
                  </li>
                  <li className="flex items-center text-sm">
                    <ArrowRight className="h-4 w-4 text-green-500 mr-2" />
                    Select your preferred language
                  </li>
                  <li className="flex items-center text-sm">
                    <ArrowRight className="h-4 w-4 text-green-500 mr-2" />
                    Receive live translation
                  </li>
                </ul>
                <Button className="w-full" variant="outline" size="lg">
                  Join Tour
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-16 pt-8 border-t border-gray-200">
          <p className="text-gray-500">
            Powered by AI • Created by VirtualAIWorkforce.com
          </p>
        </div>
      </div>
    </main>
  )
}

