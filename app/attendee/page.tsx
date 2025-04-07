"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import dynamic from 'next/dynamic'
import LanguageSelector from "@/components/LanguageSelector"
import { initWebRTC, cleanupWebRTC } from "@/lib/webrtc"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import DOMPurify from 'dompurify'

// Lazy load with loading state
const TranslationOutput = dynamic(
  () => import("@/components/TranslationOutput"),
  { 
    ssr: false,
    loading: () => <div className="min-h-[200px] border rounded-lg p-4">Loading translation component...</div>
  }
);

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) {
    const cookie = parts.pop()?.split(';').shift() || null
    // Security enhancement
    if (process.env.NODE_ENV === 'production') {
      document.cookie = `${name}=; SameSite=Strict; Secure`
    }
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
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([])
  const [isLoadingLanguages, setIsLoadingLanguages] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Enhanced connection handler with retry logic
  const connectToGuide = useCallback(async (tourCode: string, selectedLanguage: string, attendeeName: string, attempt: number = 1) => {
    const currentTourCode = tourCode
    abortControllerRef.current = new AbortController()
    
    try {
      setConnectionState('connecting')
      await initWebRTC({
        onTranslation: (text) => setTranslation(DOMPurify.sanitize(text)),
        language: selectedLanguage.toLowerCase(),
        tourCode,
        attendeeName,
        signal: abortControllerRef.current.signal
      })
      setConnectionState('connected')
      setIsAutoConnecting(false)
    } catch (err) {
      if (tourCode !== currentTourCode) return
      
      // Retry logic (max 3 attempts)
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
    
    setIsLoadingLanguages(true);
    try {
      const response = await fetch(`/api/tour/languages?tourCode=${code}`, {
        credentials: 'include' // Add credentials to include auth cookies
      });
      if (!response.ok) {
        const data = await response.json();
        if (response.status === 404) {
          setNoTourError("Invalid Tour Code or no active tour");
        } else if (response.status === 401) {
          setError("Please log in as an attendee to join a tour");
          router.push('/login');
        } else {
          setError(data.error || "Failed to fetch available languages");
        }
        return;
      }
      
      const data = await response.json();
      setAvailableLanguages(data.languages || []);
      
      // If only one language is available, auto-select it
      if (data.languages?.length === 1) {
        setLanguage(data.languages[0]);
      }
    } catch (err) {
      console.error('Error fetching languages:', err);
    } finally {
      setIsLoadingLanguages(false);
    }
  }, []);

  // Update available languages when tour code changes
  useEffect(() => {
    if (tourCode.length === 6) {
      fetchAvailableLanguages(tourCode);
    } else {
      setAvailableLanguages([]);
      setLanguage('');
    }
  }, [tourCode, fetchAvailableLanguages]);

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
      await connectToGuide(tourCode, language, name.trim())
    } catch (err) {
      console.error('Connection error:', err)
      
      if (err instanceof Error) {
        if (err.message.includes("Failed to get offer: Not Found") || 
            err.message.includes("Invalid tour code")) {
          setNoTourError("Invalid Tour Code or no active tour")
        } else if (err.message.includes("Language not supported")) {
          await fetchAvailableLanguages(tourCode)
          setError(`Language not supported. Please select an available language.`)
        } else {
          setError(err.message || 'Failed to connect. Please check your code and try again.')
        }
      } else {
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
      const code = urlTourCode.toUpperCase()
      setTourCode(code)
      
      if (urlLanguage) {
        const lang = urlLanguage.toLowerCase()
        setLanguage(lang)
        
        // Auto-connect if both params present
        if (code.match(/^[A-Z0-9]{6}$/)) {
          setIsAutoConnecting(true)
          handleConnect().catch(() => setIsAutoConnecting(false))
        }
      }
    }
  }, [handleConnect])

  // Auth check and cleanup
  useEffect(() => {
    const controller = new AbortController()
    
    const checkUserRole = async () => {
      try {
        const response = await fetch("/api/auth/check", {
          credentials: "include",
          signal: controller.signal
        })
        
        if (!response.ok) throw new Error('Auth check failed')
        
        const data = await response.json()
        if (data.user?.role !== "attendee") {
          router.push('/unauthorized')
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
            'bg-gray-500'
          }`} />
          <span className="text-sm font-medium">
            {connectionState === 'connected' ? 'Live Translation Active' :
             connectionState === 'connecting' ? (isAutoConnecting ? 'Auto-connecting...' : 'Connecting...') : 
             'Disconnected'}
          </span>
        </div>

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

            <LanguageSelector
              language={language}
              setLanguage={(lang) => setLanguage(lang.toLowerCase())}
              options={availableLanguages.map(lang => 
                lang.charAt(0).toUpperCase() + lang.slice(1)
              )}
              disabled={connectionState === 'connecting' || isLoadingLanguages}
              loading={isLoadingLanguages}
              placeholder={
                isLoadingLanguages ? "Loading languages..." :
                availableLanguages.length === 0 && tourCode.length === 6 ? 
                "No languages available" : "Select language"
              }
            />

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
      </div>
    </main>
  )
}
