"use client"

import { useState, useEffect } from "react"
import LanguageSelector from "@/components/LanguageSelector"
import TranslationOutput from "@/components/TranslationOutput"
import { initWebRTC, cleanupWebRTC } from "@/lib/webrtc"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

/**
 * Home Component
 *
 * This is the main page component for the Tour Translator application.
 * It handles the state for language selection, translation output, loading state, and errors.
 * The component initializes the WebRTC connection for real-time translation and cleans it up on unmount.
 *
 * State:
 * - translation: Current translated text
 * - language: Selected language for translation
 * - isLoading: Loading state for WebRTC initialization
 * - error: Any error that occurs during WebRTC setup
 *
 * Effects:
 * - Initializes WebRTC connection on mount and when language changes
 * - Cleans up WebRTC connection on unmount
 */
export default function Home() {
  const [translation, setTranslation] = useState<string>("Waiting for translation...")
  const [language, setLanguage] = useState<string>("English")
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const setupWebRTC = async () => {
      try {
        setIsLoading(true)
        await initWebRTC(setTranslation, language)
        setIsLoading(false)
      } catch (error) {
        console.error("Error setting up WebRTC:", error)
        setError("Failed to connect to the tour. Please try again.")
        setIsLoading(false)
      }
    }

    setupWebRTC()

    return () => {
      cleanupWebRTC()
    }
  }, [language])

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Tour Translator</h1>
      <LanguageSelector language={language} setLanguage={setLanguage} />
      <TranslationOutput translation={translation} />
    </main>
  )
}

