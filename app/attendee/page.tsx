"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import LanguageSelector from "@/components/LanguageSelector"
import TranslationOutput from "@/components/TranslationOutput"
import { initWebRTC, cleanupWebRTC } from "@/lib/webrtc"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"

/**
 * AttendeePage Component
 *
 * This component represents the interface for attendees in the Tour Translator application.
 * It manages the state for language selection, translation output, and connection status.
 * The component initializes the WebRTC connection for receiving translated audio.
 */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null // Handle server-side rendering
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null
  return null
}

export default function AttendeePage() {
  const router = useRouter()
  const [translation, setTranslation] = useState<string>("Waiting for translation...")
  const [language, setLanguage] = useState<string>("French");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [noTourError, setNoTourError] = useState<string | null>(null);
  const [tourId, setTourCode] = useState<string | null>(""); // State for tour code input

  // Define the connectToGuide function
  const connectToGuide = async () => {
    if (!tourId) {
      setError("Please enter the Tour Code.");
      return;
    }

    try {
      await initWebRTC(setTranslation, language, tourId); // Pass tourId to initWebRTC
      setIsLoading(false);
      setNoTourError(null); // Clear any previous "no tour" errors
    } catch (error: any) {
      console.error("Error connecting to guide:", error);
      if (error.message.includes("Failed to get offer: Not Found")) {
        setNoTourError("Invalid Tour Code or no active tour found for this language. Please check the code and language and try again.");
      } else {
        setError("Failed to connect to the tour. Please try again.");
      }
      setIsLoading(false);
    }
  };

  // Check if the user is an attendee when the component mounts
  useEffect(() => {
    const checkUserRole = async () => {
      try {
        const response = await fetch("/api/auth/check", {
          credentials: "include"
        })
        const data = await response.json()
        
        if (data.user && data.user.role !== "attendee") {
          setError(`You are logged in as ${data.user.role}. You must be logged in as an attendee to use this interface.`)
          setIsLoading(false)
        } else {
          // Automatically connect with the default language
          // Only connect if tourId is not empty
          if (tourId) {
            await connectToGuide()
          }
        }
      } catch (error) {
        console.error("Error checking user role:", error)
        setError("Failed to verify your account. Please try logging in again.")
        setIsLoading(false)
      }
    }
    
    checkUserRole()

    return () => {
      cleanupWebRTC()
    }
  }, [tourId])

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Tour Attendee Interface</h1>
      
      {error ? (
        <Alert variant="destructive" className="mb-8 max-w-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : noTourError ? (
        <Alert variant="destructive" className="mb-8 max-w-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Tour Available</AlertTitle>
          <AlertDescription>{noTourError}</AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Tour Code Input */}
          <div className="mb-4">
            <label htmlFor="tourId" className="block text-sm font-medium text-gray-700">
              Tour Code
            </label>
            <input
              type="text"
              id="tourId"
              className="mt-1 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm"
              placeholder="Enter tour code"
              value={tourId || ""}
              onChange={(e) => setTourCode(e.target.value)}
            />
          </div>

          <LanguageSelector
            language={language}
            setLanguage={setLanguage}
            options={["French", "German", "Spanish", "Italian", "Dutch", "Portuguese", "Japanese", "Chinese", "Korean"]} // supported languages
            connectToGuide={connectToGuide}
          />
          <TranslationOutput translation={translation} />
        </>
      )}
    </main>
  );
}
