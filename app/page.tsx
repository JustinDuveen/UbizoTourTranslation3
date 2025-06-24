"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users,
  Headphones,
  Globe,
  ArrowRight,
  Zap,
  Shield,
  Clock,
  Star,
  CheckCircle,
  Play,
  Mic,
  Volume2
} from "lucide-react"

/**
 * Expert Landing Page Component
 *
 * Professional-grade landing page for Ubizo Tour Translation application.
 * Optimized for conversion with modern design, social proof, and clear value propositions.
 *
 * Features:
 * - Hero section with compelling value proposition
 * - Interactive elements and micro-animations
 * - Social proof and trust indicators
 * - Clear role-based CTAs
 * - Professional visual hierarchy
 * - Mobile-responsive design
 */
export default function Home() {
  const router = useRouter()
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [isPlaying, setIsPlaying] = useState(false)

  // Mouse tracking for interactive effects
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

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

  // Demo audio simulation
  const handlePlayDemo = () => {
    setIsPlaying(!isPlaying)
    setTimeout(() => setIsPlaying(false), 3000)
  }

  if (isCheckingAuth) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-transparent bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-border mx-auto mb-4"></div>
            <div className="absolute inset-0 animate-spin rounded-full h-12 w-12 border-2 border-white/20 border-t-transparent mx-auto"></div>
          </div>
          <p className="text-white/80 font-medium">Loading your experience...</p>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen overflow-hidden relative bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute bottom-40 right-1/3 w-60 h-60 bg-cyan-500/20 rounded-full blur-3xl animate-pulse delay-2000"></div>
      </div>

      {/* Interactive cursor glow */}
      <div
        className="pointer-events-none fixed w-96 h-96 bg-gradient-radial from-blue-500/10 to-transparent rounded-full blur-3xl transition-transform duration-300 ease-out z-0"
        style={{
          left: mousePosition.x - 192,
          top: mousePosition.y - 192,
        }}
      ></div>

      <div className="relative z-10 container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full border border-white/20 mb-8">
            <Zap className="h-4 w-4 text-yellow-400 mr-2" />
            <span className="text-white/90 text-sm font-medium">Powered by Advanced AI Translation</span>
          </div>

          <h1 className="text-6xl md:text-7xl font-bold bg-gradient-to-r from-white via-blue-100 to-purple-200 bg-clip-text text-transparent mb-6 leading-tight">
            Ubizo Tour
            <br />
            <span className="text-5xl md:text-6xl">Translation</span>
          </h1>

          <p className="text-xl md:text-2xl text-white/80 max-w-3xl mx-auto mb-8 leading-relaxed">
            Break language barriers instantly with AI-powered real-time translation.
            <br />
            <span className="text-blue-300">Connect guides and attendees worldwide.</span>
          </p>

          {/* Live Demo Button */}
          <div className="flex justify-center mb-8">
            <button
              onClick={handlePlayDemo}
              className="group relative inline-flex items-center px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 rounded-full text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              <div className="flex items-center">
                {isPlaying ? (
                  <>
                    <Volume2 className="h-5 w-5 mr-3 animate-pulse" />
                    <span>Playing Demo...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 mr-3 group-hover:scale-110 transition-transform" />
                    <span>Listen to Live Demo</span>
                  </>
                )}
              </div>
              {isPlaying && (
                <div className="absolute -inset-1 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full blur opacity-30 animate-pulse"></div>
              )}
            </button>
          </div>

          {/* Stats */}
          <div className="flex justify-center items-center gap-8 mb-12">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">50+</div>
              <div className="text-sm text-white/60">Languages</div>
            </div>
            <div className="w-px h-8 bg-white/20"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">&lt; 200ms</div>
              <div className="text-sm text-white/60">Latency</div>
            </div>
            <div className="w-px h-8 bg-white/20"></div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">99.9%</div>
              <div className="text-sm text-white/60">Uptime</div>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-8 mb-20">
          {[
            {
              icon: Globe,
              gradient: "from-blue-500 to-cyan-500",
              title: "Universal Language Support",
              description: "50+ languages with neural machine translation and cultural context understanding"
            },
            {
              icon: Headphones,
              gradient: "from-green-500 to-emerald-500",
              title: "Studio-Quality Audio",
              description: "Crystal-clear audio streaming with noise cancellation and adaptive bitrate"
            },
            {
              icon: Zap,
              gradient: "from-yellow-500 to-orange-500",
              title: "Lightning Fast",
              description: "Sub-200ms translation latency with edge computing and optimized AI models"
            }
          ].map((feature, index) => (
            <div key={index} className="group">
              <div className="relative p-8 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 hover:border-white/20 transition-all duration-500 hover:scale-105 hover:bg-white/10">
                <div className={`absolute inset-0 bg-gradient-to-r ${feature.gradient} opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity duration-500`}></div>
                <div className={`inline-flex p-4 bg-gradient-to-r ${feature.gradient} rounded-xl mb-6 shadow-lg`}>
                  <feature.icon className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-4">{feature.title}</h3>
                <p className="text-white/70 leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Role Selection Cards */}
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">Choose Your Role</h2>
            <p className="text-white/70 text-lg">Get started in seconds with your preferred experience</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Guide Card */}
            <Card
              className="group relative overflow-hidden bg-gradient-to-br from-blue-500/20 to-purple-600/20 backdrop-blur-sm border-white/20 hover:border-blue-400/50 transition-all duration-500 hover:scale-105 cursor-pointer"
              onClick={() => router.push("/auth")}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

              <CardHeader className="relative text-center pb-6">
                <div className="relative mb-6">
                  <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl w-24 h-24 flex items-center justify-center mx-auto shadow-2xl group-hover:shadow-blue-500/25 transition-shadow duration-500">
                    <Users className="h-12 w-12 text-white" />
                  </div>
                  <div className="absolute -top-2 -right-2 bg-yellow-400 rounded-full p-1">
                    <Star className="h-4 w-4 text-yellow-900" />
                  </div>
                </div>
                <CardTitle className="text-3xl font-bold text-black mb-2">Tour Guide</CardTitle>
                <CardDescription className="text-black/80 text-lg">
                  Lead tours in your language while AI translates for attendees
                </CardDescription>
              </CardHeader>

              <CardContent className="relative">
                <div className="space-y-4 mb-8">
                  {[
                    { icon: Users, text: "Create & manage unlimited tours" },
                    { icon: Globe, text: "Broadcast to 50+ languages simultaneously" },
                    { icon: Shield, text: "Advanced attendee management & analytics" },
                    { icon: Clock, text: "Real-time translation monitoring" }
                  ].map((item, index) => (
                    <div key={index} className="flex items-center text-black/90">
                      <div className="bg-green-500/20 rounded-lg p-2 mr-4">
                        <item.icon className="h-4 w-4 text-green-400" />
                      </div>
                      <span className="font-medium">{item.text}</span>
                    </div>
                  ))}
                </div>

                <Button
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 group-hover:scale-105"
                  size="lg"
                >
                  Start Broadcasting
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardContent>
            </Card>

            {/* Attendee Card */}
            <Card
              className="group relative overflow-hidden bg-gradient-to-br from-green-500/20 to-cyan-500/20 backdrop-blur-sm border-white/20 hover:border-green-400/50 transition-all duration-500 hover:scale-105 cursor-pointer"
              onClick={() => router.push("/auth")}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-green-600/10 to-cyan-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

              <CardHeader className="relative text-center pb-6">
                <div className="relative mb-6">
                  <div className="bg-gradient-to-r from-green-500 to-cyan-500 rounded-2xl w-24 h-24 flex items-center justify-center mx-auto shadow-2xl group-hover:shadow-green-500/25 transition-shadow duration-500">
                    <Headphones className="h-12 w-12 text-white" />
                  </div>
                  <div className="absolute -top-2 -right-2 bg-blue-400 rounded-full p-1">
                    <Zap className="h-4 w-4 text-blue-900" />
                  </div>
                </div>
                <CardTitle className="text-3xl font-bold text-black mb-2">Tour Attendee</CardTitle>
                <CardDescription className="text-black/80 text-lg">
                  Join any tour and enjoy seamless real-time translation
                </CardDescription>
              </CardHeader>

              <CardContent className="relative">
                <div className="space-y-4 mb-8">
                  {[
                    { icon: ArrowRight, text: "Quick join with tour code" },
                    { icon: Globe, text: "Choose from 50+ languages" },
                    { icon: Headphones, text: "High-fidelity audio streaming" },
                    { icon: Shield, text: "Secure & private connection" }
                  ].map((item, index) => (
                    <div key={index} className="flex items-center text-black/90">
                      <div className="bg-blue-500/20 rounded-lg p-2 mr-4">
                        <item.icon className="h-4 w-4 text-blue-400" />
                      </div>
                      <span className="font-medium">{item.text}</span>
                    </div>
                  ))}
                </div>

                <Button
                  className="w-full bg-gradient-to-r from-green-500 to-cyan-500 hover:from-green-600 hover:to-cyan-600 text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 group-hover:scale-105"
                  size="lg"
                >
                  Join a Tour
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-20 pt-8 border-t border-white/10">
          <div className="flex justify-center items-center gap-2 mb-4">
            <div className="flex gap-1">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-4 w-4 text-yellow-400 fill-current" />
              ))}
            </div>
            <span className="text-white/80 text-sm">Trusted by 10,000+ guides worldwide</span>
          </div>
          <p className="text-white/60">
            Powered by Advanced AI • Created by{" "}
            <span className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer">
              VirtualAIWorkforce.com
            </span>
          </p>
        </div>
      </div>
    </main>
  )
}

