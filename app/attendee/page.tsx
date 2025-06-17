"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import dynamic from 'next/dynamic'
// Removed LanguageSelector import as we're using Select directly
import { initWebRTC, cleanupWebRTC, endAttendeeSession } from "@/lib/webrtc"
import { normalizeLanguageForStorage, formatLanguageForDisplay } from "@/lib/languageUtils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  const abortControllerRef = useRef<AbortController | null>(null)



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
    } catch (err) {
      console.error('Error ending session:', err);
    } finally {
      setIsEndingSession(false);
    }
  }, []);

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
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-24">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl md:text-4xl font-bold mb-6 md:mb-8 text-center">
          Tour Attendee Interface
        </h1>

        {/* Enhanced Connection Status */}
        <div className="flex items-center justify-center mb-6">
          <div className={`h-4 w-4 rounded-full mr-3 ${
            connectionState === 'connected' ? 'bg-green-500' :
            connectionState === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            connectionState === 'waiting' ? 'bg-blue-500 animate-pulse' :
            connectionState === 'guide_not_ready' ? 'bg-orange-500' :
            connectionState === 'failed' ? 'bg-red-500' :
            'bg-gray-500'
          }`} />
          <span className="text-sm font-medium">
            {connectionState === 'connected' ? 'Live Translation Active' :
             connectionState === 'connecting' ? (isAutoConnecting ? 'Auto-connecting...' : 'Connecting...') :
             connectionState === 'waiting' ? 'Waiting for guide to start broadcasting...' :
             connectionState === 'guide_not_ready' ? 'Guide has not started broadcasting yet' :
             connectionState === 'failed' ? 'Connection failed' :
             'Disconnected'}
          </span>
        </div>

        {connectionState === 'guide_not_ready' && (
          <Alert variant="warning" className="mb-6">
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
                >
                  Try Again
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {error ? (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Connection Error</AlertTitle>
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        ) : noTourError ? (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Tour Not Found</AlertTitle>
            <AlertDescription>{noTourError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md w-full">
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Your Name
              </label>
              <input
                type="text"
                id="name"
                autoFocus
                className="w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
            </div>

            <div>
              <label htmlFor="tourCode" className="block text-sm font-medium mb-1">
                Tour Code
              </label>
              <input
                type="text"
                id="tourCode"
                className="w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500"
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

            <div className="mb-4">
              <Select
                value={language}
                onValueChange={(value) => setLanguage(value)}
                disabled={connectionState === 'connecting' || isLoadingLanguages}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={
                    isLoadingLanguages ? "Loading languages..." :
                    availableLanguages.length === 0 && tourCode.length === 6 ?
                    "No languages available" : "Select language"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {availableLanguages.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.display}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleConnect}
              disabled={connectionState === 'connecting'}
              className="w-full py-3"
              size="lg"
            >
              {connectionState === 'connecting' ? (
                <span className="flex items-center justify-center">
                  <span className="animate-spin mr-2">↻</span>
                  {isAutoConnecting ? 'Auto-connecting...' : 'Connecting...'}
                </span>
              ) : 'Join Tour'}
            </Button>
          </div>
        </div>

        <div className="mt-8 w-full">
          <TranslationOutput
            translation={
              connectionState === 'connecting'
                ? "Connecting to translation service..."
                : translation || "Waiting for translation..."
            }
          />
        </div>

        {/* Session Controls - Only shown when connected */}
        {connectionState === 'connected' && (
          <div className="mt-6 flex justify-center">
            <Button
              onClick={handleEndSession}
              variant="destructive"
              disabled={isEndingSession}
              className="flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              {isEndingSession ? "Ending..." : "End Session"}
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}
