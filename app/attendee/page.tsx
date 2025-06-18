"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import dynamic from 'next/dynamic'
import { initWebRTC, cleanupWebRTC, endAttendeeSession } from "@/lib/webrtc"
import { normalizeLanguageForStorage, formatLanguageForDisplay } from "@/lib/languageUtils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertCircle,
  LogOut,
  Headphones,
  Globe,
  User,
  Hash,
  Volume2,
  Wifi,
  WifiOff,
  Clock,
  Activity,
  CheckCircle,
  Loader2,
  Radio
} from "lucide-react"
import DOMPurify from 'dompurify'

// Lazy load with loading state
const TranslationOutput = dynamic(
  () => import("@/components/TranslationOutput"),
  {
    ssr: false,
    loading: () => <div className="min-h-[200px] border rounded-lg p-4">Loading translation component...</div>
  }
);

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed' | 'waiting' | 'guide_not_ready';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) {
    const cookie = parts.pop()?.split(';').shift() || null
    return cookie
  }
  return null
}

export default function AttendeePage() {
  const router = useRouter()
  const { toast } = useToast()
  const [translation, setTranslation] = useState<string>("")
  const [language, setLanguage] = useState<string>("")
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [noTourError, setNoTourError] = useState<string | null>(null)
  const [tourCode, setTourCode] = useState<string>("")
  const [isAutoConnecting, setIsAutoConnecting] = useState(false)
  const [name, setName] = useState<string>("")
  const [availableLanguages, setAvailableLanguages] = useState<{code: string, display: string}[]>([])
  const [isLoadingLanguages, setIsLoadingLanguages] = useState(false)
  const [isEndingSession, setIsEndingSession] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const abortControllerRef = useRef<AbortController | null>(null)



  // Mouse tracking for interactive effects
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Enhanced connection handler with retry logic
  const connectToGuide = useCallback(async (tourCode: string, selectedLanguage: string, attendeeName: string, attempt: number = 1) => {
    const currentTourCode = tourCode
    abortControllerRef.current = new AbortController()

    try {
      setConnectionState('connecting')
      await initWebRTC({
        onTranslation: (text) => setTranslation(DOMPurify.sanitize(text)),
        language: selectedLanguage.charAt(0).toUpperCase() + selectedLanguage.slice(1).toLowerCase(),
        tourCode,
        attendeeName,
        signal: abortControllerRef.current.signal
      })
      setConnectionState('connected')
      setIsAutoConnecting(false)

      // Show success toast
      toast({
        title: "Connected Successfully",
        description: `Receiving live translation in ${selectedLanguage}`,
      })
    } catch (err) {
      if (tourCode !== currentTourCode) return

      // Handle specific error types
      if (err instanceof Error) {
        if (err.message === 'PLACEHOLDER_OFFER_RECEIVED') {
          console.log('Received placeholder offer, guide has not started broadcasting yet')
          setConnectionState('waiting')
          setTranslation('Waiting for the guide to start broadcasting...')

          // Retry with longer delay for placeholder offers
          if (attempt < 5) { // Increased max attempts for placeholder offers
            const delay = 3000 * (attempt + 1) // Longer delays for placeholder retries
            console.log(`Will retry in ${delay/1000} seconds (attempt ${attempt + 1})...`)
            await new Promise(resolve => setTimeout(resolve, delay))
            return connectToGuide(tourCode, selectedLanguage, attendeeName, attempt + 1)
          }

          setConnectionState('guide_not_ready')
          setIsAutoConnecting(false)
          return // Don't throw, just show waiting state
        }
      }

      // General retry logic (max 3 attempts)
      if (attempt < 3) {
        console.log(`Retrying connection (attempt ${attempt + 1})...`)
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
        return connectToGuide(tourCode, selectedLanguage, attendeeName, attempt + 1)
      }

      setConnectionState('failed')
      setIsAutoConnecting(false)
      throw err
    }
  }, [])

  // Fetch available languages when tour code is entered
  const fetchAvailableLanguages = useCallback(async (code: string) => {
    if (!code?.match(/^[A-Z0-9]{6}$/)) return;

    // Ensure tour code is uppercase for Redis key consistency
    const uppercaseCode = code.toUpperCase();
    console.log(`Fetching languages for tour code: ${uppercaseCode}`);
    setIsLoadingLanguages(true);
    try {
      const response = await fetch(`/api/tour/languages?tourCode=${uppercaseCode}`, {
        credentials: 'include' // Add credentials to include auth cookies
      });
      console.log(`Language fetch response status: ${response.status}`);

      if (!response.ok) {
        const data = await response.json();
        console.log(`Error response data:`, data);

        if (response.status === 404) {
          setNoTourError("Invalid Tour Code or no active tour");
          console.log("Tour code not found");
        } else if (response.status === 401) {
          setError("Please log in as an attendee to join a tour");
          console.log("Authentication failed - redirecting to login");
          router.push('/login');
        } else {
          setError(data.error || "Failed to fetch available languages");
          console.log(`Other error: ${data.error}`);
        }
        return;
      }

      const data = await response.json();
      console.log(`Languages received:`, data);

      // Extract language data from response
      const displayLanguages = data.displayLanguages || [];
      console.log(`Display languages from API:`, displayLanguages);

      // Store both code and display name for each language
      setAvailableLanguages(displayLanguages);
      console.log(`Available languages set to:`, displayLanguages);

      // If only one language is available, auto-select it
      if (displayLanguages.length === 1) {
        console.log(`Auto-selecting the only available language: ${displayLanguages[0].code}`);
        setLanguage(displayLanguages[0].code);
      }
    } catch (err) {
      console.error('Error fetching languages:', err);
    } finally {
      setIsLoadingLanguages(false);
    }
  }, [router]);

  // Update available languages when tour code changes
  useEffect(() => {
    if (tourCode.length === 6) {
      fetchAvailableLanguages(tourCode);
    } else {
      setAvailableLanguages([]);
      setLanguage('');
    }
  }, [tourCode, fetchAvailableLanguages]);



  // Handle ending the session
  const handleEndSession = useCallback(() => {
    setIsEndingSession(true);
    try {
      endAttendeeSession();
      setConnectionState('idle');
      setTranslation("");

      // Show success toast
      toast({
        title: "Session Ended",
        description: "You have disconnected from the tour",
      });
    } catch (err) {
      console.error('Error ending session:', err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to end session properly",
      });
    } finally {
      setIsEndingSession(false);
    }
  }, [toast]);

  const handleConnect = useCallback(async () => {
    if (!tourCode?.match(/^[A-Z0-9]{6}$/)) {
      setError('Tour code must be 6 uppercase letters/numbers')
      return
    }

    if (!language) {
      setError('Please select a language')
      return
    }

    if (!name.trim()) {
      setError('Please enter your name')
      return
    }


    setError(null)
    setNoTourError(null)

    try {
      // Store name in localStorage for reconnections
      localStorage.setItem('attendeeName', name.trim());
      // Ensure tour code is uppercase for Redis key consistency
      const uppercaseCode = tourCode.toUpperCase();
      await connectToGuide(uppercaseCode, language, name.trim())
    } catch (err) {
      console.error('Connection error:', err)

      if (err instanceof Error) {
        console.log(`Connection error message: ${err.message}`);

        // Handle specific error messages with user-friendly responses
        if (err.message.includes("Failed to get offer: Not Found") ||
            err.message.includes("Invalid tour code")) {
          setNoTourError("Invalid Tour Code or no active tour")
        } else if (err.message.includes("Tour is no longer active") ||
                   err.message.includes("Tour ended or invalid")) {
          setNoTourError("This tour is no longer active. Please ask the guide to restart the tour.")
        } else if (err.message.includes("Language not supported")) {
          await fetchAvailableLanguages(tourCode)
          setError(`Language not supported. Please select an available language.`)
        } else if (err.message.includes("Timeout waiting for audio stream") ||
                   err.message.includes("Timed out waiting for the guide to start broadcasting")) {
          setError("The guide hasn't started broadcasting in this language yet. Please wait and try again later.")
        } else if (err.message.includes("guide has not started broadcasting")) {
          setError("The guide hasn't started broadcasting in this language yet. Please wait and try again.")
        } else if (err.message.includes("Invalid SDP format") ||
                   err.message.includes("Invalid SDP content")) {
          setError("There was a technical issue with the audio connection. Please try again or ask the guide to restart the broadcast.")
        } else {
          // For other errors, display the message directly
          setError(err.message || 'Failed to connect. Please check your code and try again.')
        }
      } else {
        console.error('Unknown error type:', err);
        setError('An unknown error occurred')
      }
    }
  }, [tourCode, language, name, connectToGuide, fetchAvailableLanguages])

  // Enhanced auto-connect from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlTourCode = params.get('tourCode')
    const urlLanguage = params.get('language')

    if (urlTourCode) {
      // Ensure tour code is uppercase for Redis key consistency
      const code = urlTourCode.toUpperCase()
      setTourCode(code)

      if (urlLanguage) {
        // Normalize language to lowercase for consistency
        const lang = urlLanguage.toLowerCase()
        setLanguage(lang)
      }
    }
  }, [])

  // Auth check and cleanup
  useEffect(() => {
    const controller = new AbortController()

    const checkUserRole = async () => {
      try {
        console.log("Checking user authentication status")
        const response = await fetch("/api/auth/check", {
          credentials: "include",
          signal: controller.signal
        })

        console.log(`Auth check response status: ${response.status}`)
        if (!response.ok) throw new Error('Auth check failed')

        const data = await response.json()
        console.log("Auth check data:", data)

        if (data.user?.role !== "attendee") {
          console.log(`User role is not attendee: ${data.user?.role}`)
          router.push('/unauthorized')
        } else {
          console.log("User authenticated as attendee")
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Auth check failed:", err)
          setError("Failed to verify your session")
        }
      }
    }

    checkUserRole()

    return () => {
      controller.abort()
      cleanupWebRTC()
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [router])

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

      <div className="relative z-10 container mx-auto px-6 py-8 min-h-screen flex flex-col">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 space-y-4 sm:space-y-0">
          <div className="flex items-center space-x-4">
            <div className="bg-gradient-to-r from-green-500 to-cyan-500 rounded-xl p-3 shadow-lg">
              <Headphones className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Tour Attendee</h1>
              <p className="text-white/70 text-sm sm:text-base">Join live multilingual tours</p>
            </div>
          </div>

          {/* Enhanced Connection Status */}
          <div className="flex items-center space-x-2">
            <div className={`h-3 w-3 rounded-full ${
              connectionState === 'connected' ? 'bg-green-400 animate-pulse' :
              connectionState === 'connecting' ? 'bg-yellow-400 animate-pulse' :
              connectionState === 'waiting' ? 'bg-blue-400 animate-pulse' :
              connectionState === 'guide_not_ready' ? 'bg-orange-400 animate-pulse' :
              connectionState === 'failed' ? 'bg-red-400' :
              'bg-gray-400'
            }`} />
            <Badge variant="secondary" className={`${
              connectionState === 'connected' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
              connectionState === 'connecting' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
              connectionState === 'waiting' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
              connectionState === 'guide_not_ready' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
              connectionState === 'failed' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
              'bg-gray-500/20 text-gray-400 border-gray-500/30'
            }`}>
              {connectionState === 'connected' ? (
                <>
                  <Activity className="h-3 w-3 mr-1" />
                  LIVE
                </>
              ) : connectionState === 'connecting' ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  CONNECTING
                </>
              ) : connectionState === 'waiting' ? (
                <>
                  <Clock className="h-3 w-3 mr-1" />
                  WAITING
                </>
              ) : connectionState === 'guide_not_ready' ? (
                <>
                  <Radio className="h-3 w-3 mr-1" />
                  STANDBY
                </>
              ) : connectionState === 'failed' ? (
                <>
                  <WifiOff className="h-3 w-3 mr-1" />
                  FAILED
                </>
              ) : (
                <>
                  <Wifi className="h-3 w-3 mr-1" />
                  READY
                </>
              )}
            </Badge>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 flex-1">
          {/* Left Column - Join Tour Form */}
          <div className="space-y-6">
            {connectionState === 'guide_not_ready' && (
              <Alert variant="default" className="bg-orange-500/10 border-orange-500/30 text-orange-400">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Guide Not Broadcasting</AlertTitle>
                <AlertDescription>
                  The guide has not started broadcasting in this language yet.
                  <div className="mt-4">
                    <Button
                      onClick={() => {
                        if (tourCode && language && name) {
                          setConnectionState('connecting');
                          connectToGuide(tourCode, language, name, 0);
                        }
                      }}
                      variant="outline"
                      className="bg-orange-500/20 border-orange-500/50 text-orange-300 hover:bg-orange-500/30"
                    >
                      Try Again
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {error ? (
              <Alert variant="destructive" className="bg-red-500/10 border-red-500/30 text-red-400">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Connection Error</AlertTitle>
                <AlertDescription className="break-words">{error}</AlertDescription>
              </Alert>
            ) : noTourError ? (
              <Alert variant="destructive" className="bg-red-500/10 border-red-500/30 text-red-400">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Tour Not Found</AlertTitle>
                <AlertDescription>{noTourError}</AlertDescription>
              </Alert>
            ) : null}

            {/* Join Tour Form */}
            <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-white/20 transition-all duration-300">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <User className="h-5 w-5 mr-2 text-cyan-400" />
                  Join Tour
                </CardTitle>
                <CardDescription className="text-white/70">
                  Enter your details to connect to a live tour
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Name Input */}
                <div className="space-y-2">
                  <label htmlFor="name" className="text-white/80 text-sm font-medium flex items-center">
                    <User className="h-4 w-4 mr-2 text-blue-400" />
                    Your Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    autoFocus
                    className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all duration-200"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  />
                </div>

                {/* Tour Code Input */}
                <div className="space-y-2">
                  <label htmlFor="tourCode" className="text-white/80 text-sm font-medium flex items-center">
                    <Hash className="h-4 w-4 mr-2 text-amber-400" />
                    Tour Code
                  </label>
                  <input
                    type="text"
                    id="tourCode"
                    className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all duration-200 font-mono text-lg tracking-wider text-center"
                    placeholder="Enter 6-digit code"
                    value={tourCode}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase()
                      if (value.length <= 6 && /^[A-Z0-9]*$/.test(value)) {
                        setTourCode(value)
                      }
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                    maxLength={6}
                  />
                </div>

                {/* Language Selection */}
                <div className="space-y-2">
                  <label className="text-white/80 text-sm font-medium flex items-center">
                    <Globe className="h-4 w-4 mr-2 text-green-400" />
                    Language
                  </label>
                  <Select
                    value={language}
                    onValueChange={(value) => setLanguage(value)}
                    disabled={connectionState === 'connecting' || isLoadingLanguages}
                  >
                    <SelectTrigger className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white focus:ring-2 focus:ring-green-500 focus:border-green-500">
                      <SelectValue placeholder={
                        isLoadingLanguages ? "Loading languages..." :
                        availableLanguages.length === 0 && tourCode.length === 6 ?
                        "No languages available" : "Select language"
                      } />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/20">
                      {availableLanguages.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code} className="text-white hover:bg-white/10">
                          {lang.display}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Connect Button */}
                <Button
                  onClick={handleConnect}
                  disabled={connectionState === 'connecting' || !name.trim() || !tourCode || !language}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 min-h-[48px]"
                  size="lg"
                >
                  {connectionState === 'connecting' ? (
                    <span className="flex items-center justify-center">
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      {isAutoConnecting ? 'Auto-connecting...' : 'Connecting...'}
                    </span>
                  ) : (
                    <>
                      <Headphones className="h-5 w-5 mr-2" />
                      Join Tour
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Live Translation */}
          <div className="space-y-6">
            {/* Translation Display */}
            <Card className="bg-white/5 backdrop-blur-sm border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <div className="flex items-center">
                    <Volume2 className="h-5 w-5 mr-2 text-green-400" />
                    Live Translation
                  </div>
                  {connectionState === 'connected' && (
                    <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30">
                      <Activity className="h-3 w-3 mr-1 animate-pulse" />
                      LIVE
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-white/70">
                  {connectionState === 'connected'
                    ? `Receiving translation in ${language}`
                    : 'Translation will appear here when connected'
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-white/5 rounded-lg p-6 border border-white/10 min-h-[300px] flex items-center justify-center">
                  {connectionState === 'connecting' ? (
                    <div className="text-center text-white/60">
                      <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-cyan-400" />
                      <p>Connecting to translation service...</p>
                    </div>
                  ) : connectionState === 'connected' ? (
                    <div className="w-full">
                      <TranslationOutput
                        translation={translation || "Listening for guide..."}
                      />
                    </div>
                  ) : (
                    <div className="text-center text-white/60">
                      <Headphones className="h-12 w-12 mx-auto mb-4 text-white/30" />
                      <p>Join a tour to start receiving live translation</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Session Controls - Only shown when connected */}
            {connectionState === 'connected' && (
              <Card className="bg-white/5 backdrop-blur-sm border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <Radio className="h-5 w-5 mr-2 text-red-400" />
                    Session Control
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={handleEndSession}
                    variant="destructive"
                    disabled={isEndingSession}
                    className="w-full bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30 min-h-[48px]"
                  >
                    {isEndingSession ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Ending Session...
                      </>
                    ) : (
                      <>
                        <LogOut className="h-4 w-4 mr-2" />
                        End Session
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Connection Info */}
            {connectionState !== 'idle' && (
              <Card className="bg-white/5 backdrop-blur-sm border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <CheckCircle className="h-5 w-5 mr-2 text-blue-400" />
                    Connection Info
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Tour Code</span>
                      <span className="text-white font-mono">{tourCode}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Language</span>
                      <span className="text-white">{language}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Status</span>
                      <span className={`text-sm font-medium ${
                        connectionState === 'connected' ? 'text-green-400' :
                        connectionState === 'connecting' ? 'text-yellow-400' :
                        connectionState === 'waiting' ? 'text-blue-400' :
                        connectionState === 'guide_not_ready' ? 'text-orange-400' :
                        connectionState === 'failed' ? 'text-red-400' :
                        'text-gray-400'
                      }`}>
                        {connectionState === 'connected' ? 'Connected' :
                         connectionState === 'connecting' ? 'Connecting' :
                         connectionState === 'waiting' ? 'Waiting' :
                         connectionState === 'guide_not_ready' ? 'Standby' :
                         connectionState === 'failed' ? 'Failed' :
                         'Ready'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-white/10 text-center">
          <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Headphones className="h-4 w-4 text-cyan-400" />
              <span className="text-white/80 text-sm">Real-time • High Quality • Secure</span>
            </div>
          </div>
          <p className="text-white/60 text-sm">
            Powered by Advanced AI Translation •
            <span className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer ml-1">
              VirtualAIWorkforce.com
            </span>
          </p>
        </div>
      </div>
    </main>
  )
}
