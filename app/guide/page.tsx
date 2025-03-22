"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import LanguageSelector from "@/components/LanguageSelector"
import TranslationOutput from "@/components/TranslationOutput"
import TourControls from "@/components/TourControls"
import AttendeeList from "@/components/AttendeeList"
import { initGuideWebRTC, cleanupGuideWebRTC } from "@/lib/guideWebRTC"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, Copy } from "lucide-react"

// Simple spinner component for loading state
function Spinner() {
  return (
    <div className="flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
    </div>
  )
}

export default function GuidePage() {
  const router = useRouter()
  const [translation, setTranslation] = useState<string>("Waiting for translation...")
  const [language, setLanguage] = useState<string>("English") // Default to English
  const [attendees, setAttendees] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null);
  const [isTourActive, setIsTourActive] = useState<boolean>(false);
  const [isTourEnding, setIsTourEnding] = useState<boolean>(false); // Track if the tour is intentionally ending
  const [tourCode, setTourCode] = useState<string | null>(null); // State for tour code
  const [tourCreated, setTourCreated] = useState<boolean>(false); // State to track if tour is created
  const [copySuccess, setCopySuccess] = useState<string>("");

  const routerPush = useRouter().push

  const handleStartTour = async () => {
    try {
      console.log("=== STARTING TOUR ===")
      setIsLoading(true)
      setError(null)
      console.log("Sending tour start request with language:", language)
      const response = await fetch("/api/tour/start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language })
      })

      console.log("Tour start response:", response.status, response.statusText)
      
      if (!response.ok) {
        const data = await response.json()
        console.error("Tour start error:", data)
        if (response.status === 401) {
          const errorMessage =
            "You must be logged in as a guide to start a tour. You appear to be logged in as an attendee."
          setError(errorMessage)
          setIsLoading(false)
          return
        }
        throw new Error(data.error || "Failed to start tour")
      }
      
      const tourData = await response.json()
      console.log("Tour started successfully:", tourData)
      setTourCode(tourData.tourCode)
      setTourCreated(true) // Set tourCreated to true

      // Initialize WebRTC only after tour has successfully started.
      console.log("Initializing WebRTC connection...")
      await initGuideWebRTC(setTranslation, language, setAttendees, tourData.tourId)
      console.log("WebRTC initialized successfully")
      
      setIsTourActive(true)
      setIsLoading(false)
    } catch (err: any) {
      console.error("Error starting tour:", err)
      setError("Failed to initialize the tour. Please try again.")
      setIsLoading(false)
    }
  }

  const handleEndTour = async () => {
    try {
      const response = await fetch("/api/tour/end", { 
        method: "POST",
        credentials: "include"
      })
      if (!response.ok) {
        const data = await response.json()
        if (response.status === 401) {
          routerPush("/login")
          return
        }
        throw new Error(data.error || "Failed to end tour")
      }
      setIsTourEnding(true);
      cleanupGuideWebRTC()
      setIsTourActive(false)
      setAttendees([])
      setTranslation("Waiting for translation...")
      setTourCode(null)
    } catch (err) {
      console.error("Error ending tour:", err)
      setError("Error ending tour. Please try again.")
    }
  }

  // Copy the tour code to clipboard
  const handleCopyTourCode = async () => {
    if (tourCode) {
      try {
        await navigator.clipboard.writeText(tourCode)
        setCopySuccess("Tour code copied!")
        setTimeout(() => setCopySuccess(""), 3000)
      } catch (err) {
        setCopySuccess("Failed to copy")
      }
    }
  }

  // Check if the user is a guide on mount
  useEffect(() => {
    const checkUserRole = async () => {
      try {
        const response = await fetch("/api/auth/check", { credentials: "include" })
        const data = await response.json()
        if (data.user && data.user.role !== "guide") {
          setError(`You are logged in as ${data.user.role}. You must be logged in as a guide to use this interface.`)
        }
      } catch (err) {
        console.error("Error checking user role:", err)
      }
    }
    checkUserRole()
  }, [])

  // Clean up WebRTC on unmount if the tour is active
  useEffect(() => {
    console.log("Tour active state changed:", isTourActive)
    return () => {
      if (isTourActive && !isTourEnding) {
        console.log("Cleaning up WebRTC on unmount")
        cleanupGuideWebRTC()
      }
    }
  }, [isTourActive])

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Spinner />
      </div>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gray-50">
      <h1 className="text-4xl font-bold mb-6">Tour Guide Interface</h1>
      
      {error ? (
        <Alert variant="destructive" className="mb-6 max-w-lg">
          <AlertCircle className="h-4 w-4 mr-2" />
          <div>
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4 mb-6">
            <LanguageSelector
              language={language}
              setLanguage={setLanguage}
              connectToGuide={() => {}}
              disabled={isTourActive} // disable when tour is active
            />
             {/* Tour Code Display */}
            {tourCreated && tourCode && (
              <div className="flex flex-col items-center mb-6">
                <Alert variant="success" className="mb-3">
                  <AlertCircle className="h-4 w-4 mr-2" />
                  <AlertTitle>Tour Created!</AlertTitle>
                  <AlertDescription>
                    Share this code with attendees: 
                    <button 
                      onClick={handleCopyTourCode} 
                      className="inline-flex items-center ml-2 text-sm font-semibold hover:text-blue-600"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      {tourCode}
                    </button>
                    {copySuccess && <span className="text-green-600 ml-2">{copySuccess}</span>}
                  </AlertDescription>
                </Alert>
              </div>
            )}

          </div>
          <TranslationOutput translation={translation} />
          <TourControls 
            onStartTour={handleStartTour} 
            onEndTour={handleEndTour}
          />
          <AttendeeList attendees={attendees} />
        </>
      )}
    </main>
  )
}
