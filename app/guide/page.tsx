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
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [primaryLanguage, setPrimaryLanguage] = useState<string>("English")
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(["English"])
  interface Attendee {
    id: string;
    name: string;
    language: string;
    joinTime: string;
  }

  const [attendees, setAttendees] = useState<Attendee[]>([])
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

      // Make sure primary language is included in selected languages
      let finalSelectedLanguages = [...selectedLanguages];
      if (!finalSelectedLanguages.includes(primaryLanguage)) {
        finalSelectedLanguages.push(primaryLanguage);
      }

      console.log("Sending tour start request with languages:", finalSelectedLanguages, "primary:", primaryLanguage)
      const response = await fetch("/api/tour/start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          languages: finalSelectedLanguages,
          primaryLanguage
        })
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
      // Create wrapper for attendee updates
      const handleAttendeeUpdates = (attendeeIds: string[]) => {
        // Convert string IDs to placeholder Attendee objects
        const attendeeObjects = attendeeIds.map(id => ({
          id,
          name: 'Loading...',
          language: primaryLanguage,
          joinTime: new Date().toISOString()
        }));
        setAttendees(attendeeObjects);
      };

      // Initialize WebRTC for each selected language
      console.log("Initializing WebRTC for languages:", finalSelectedLanguages);
      for (const language of finalSelectedLanguages) {
        // Ensure proper case for language names to match audio file naming
        const normalizedLanguage = language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
        console.log(`Initializing WebRTC for language: ${normalizedLanguage}`);

        const handleTranslationUpdate = (text: string) => {
          setTranslations(prev => ({
            ...prev,
            [normalizedLanguage]: text
          }))
        }
        await initGuideWebRTC(handleTranslationUpdate, normalizedLanguage, handleAttendeeUpdates, tourData.tourId)
        console.log(`WebRTC initialized for ${normalizedLanguage}`);
      }
      console.log("WebRTC initialized successfully for all languages")

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
      setAttendees([] as Attendee[])
      setTranslations({})
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
  }, [isTourActive]);

  // Keep primary language in selected languages
  useEffect(() => {
    if (!selectedLanguages.includes(primaryLanguage)) {
      setSelectedLanguages(prev => [...prev, primaryLanguage]);
    }
  }, [primaryLanguage, selectedLanguages]);

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
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Primary Language</label>
                <LanguageSelector
                  language={primaryLanguage}
                  setLanguage={setPrimaryLanguage}
                  connectToGuide={() => {}}
                  disabled={isTourActive}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Additional Languages (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  {["French", "German", "Spanish", "Italian", "Dutch", "Portuguese"].map(lang => (
                    <label key={lang} className="inline-flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedLanguages.map(l => l.toLowerCase()).includes(lang.toLowerCase())}
                        onChange={(e) => {
                          const formattedLang = lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
                          console.log(`Language checkbox ${formattedLang} changed to ${e.target.checked}`);

                          if (e.target.checked) {
                            setSelectedLanguages(prev => {
                              const newLangs = [...prev, formattedLang];
                              console.log(`Added ${formattedLang}, new selected languages:`, newLangs);
                              return newLangs;
                            });
                          } else {
                            // Don't remove primary language
                            setSelectedLanguages(prev => {
                              const newLangs = prev.filter(l => l !== formattedLang || l === primaryLanguage);
                              console.log(`Removed ${formattedLang}, new selected languages:`, newLangs);
                              return newLangs;
                            });
                          }
                        }}
                        disabled={isTourActive || lang === primaryLanguage}
                        className="form-checkbox h-4 w-4 text-blue-600"
                      />
                      <span className="ml-2 text-sm">{lang}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
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
          <div className="w-full max-w-4xl space-y-4">
            {Object.entries(translations).map(([language, text]) => (
              <div key={language} className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-2">{language}</h3>
                <TranslationOutput translation={text} />
              </div>
            ))}
            {Object.keys(translations).length === 0 && (
              <div className="text-center text-gray-500">
                Waiting for translations...
              </div>
            )}
          </div>
          <TourControls
            onStartTour={handleStartTour}
            onEndTour={handleEndTour}
            isTourActive={isTourActive}
          />
          <AttendeeList attendees={attendees} />
        </>
      )}
    </main>
  )
}
