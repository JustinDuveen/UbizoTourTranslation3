"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import LanguageSelector from "@/components/LanguageSelector"
import TranslationOutput from "@/components/TranslationOutput"
import TourControls from "@/components/TourControls"
import AttendeeList from "@/components/AttendeeList"
import { initGuideWebRTC, cleanupGuideWebRTC, toggleMicrophoneMute } from "@/lib/guideWebRTC"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, Copy } from "lucide-react"
import { TranslationMonitor } from "@/lib/translationMonitor"

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
  const [primaryLanguage, setPrimaryLanguage] = useState<string>("") // Will be set to first selected language
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([])
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
  const [isMuted, setIsMuted] = useState<boolean>(false); // State for microphone mute status
  const [tourCreated, setTourCreated] = useState<boolean>(false); // State to track if tour is created
  const [copySuccess, setCopySuccess] = useState<string>("");


  // Initialize AudioContext and play a silent sound to get user consent for audio playback
  const initializeAudioContext = () => {
    console.log("Initializing AudioContext for browser audio consent...");
    try {
      // Create AudioContext
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();

      // Create and play a silent sound (1ms)
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);

      console.log("AudioContext initialized and silent sound played for consent");
      return audioContext;
    } catch (error) {
      console.error("Error initializing AudioContext:", error);
      return null;
    }
  };

  const handleStartTour = async () => {
    try {
      console.log("=== STARTING TOUR ===")
      setIsLoading(true)
      setError(null)

      // Initialize audio context immediately on button click for browser consent
      const audioContext = initializeAudioContext();
      console.log("Audio context initialized:", audioContext ? "Success" : "Failed");

      // Resume audio context if needed
      if (audioContext && audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
          console.log('Audio context resumed successfully');
        } catch (error) {
          console.error('Failed to resume audio context:', error);
        }
      }

      // Validate at least one language is selected
      if (selectedLanguages.length === 0) {
        setError("Please select at least one language before starting the tour");
        setIsLoading(false);
        return;
      }

      // Use selected languages as is
      const finalSelectedLanguages = [...selectedLanguages];

      // Ensure primary language is set to first selected language
      if (!primaryLanguage || !selectedLanguages.includes(primaryLanguage)) {
        setPrimaryLanguage(selectedLanguages[0]);
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
      const initializationErrors = [];

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

        try {
          await initGuideWebRTC(handleTranslationUpdate, normalizedLanguage, handleAttendeeUpdates, tourData.tourId, tourData.tourCode)
          console.log(`WebRTC initialized for ${normalizedLanguage}`);
        } catch (error) {
          console.error(`Failed to initialize WebRTC for ${normalizedLanguage}:`, error);
          initializationErrors.push({ language: normalizedLanguage, error });
          // Continue with other languages instead of stopping completely
        }
      }

      if (initializationErrors.length > 0) {
        console.warn(`WebRTC initialization completed with ${initializationErrors.length} errors:`, initializationErrors);
        if (initializationErrors.length === finalSelectedLanguages.length) {
          // All languages failed to initialize
          throw new Error("Failed to initialize WebRTC for any language");
        }
      } else {
        console.log("WebRTC initialized successfully for all languages");
      }

      setIsTourActive(true)
      setIsLoading(false)
    } catch (err: any) {
      console.error("Error starting tour:", err)
      setError("Failed to initialize the tour. Please try again.")
      setIsLoading(false)
    }
  }

  const handleToggleMute = (muted: boolean) => {
    console.log(`${muted ? 'Muting' : 'Unmuting'} microphone...`);
    toggleMicrophoneMute(muted);
    setIsMuted(muted);
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
          router.push("/login")
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
    return () => {
      console.log("Cleaning up WebRTC on unmount")
      cleanupGuideWebRTC()
    }
  }, []);

  // Primary language is now automatically derived from selected languages

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
              {/* Primary Language dropdown removed - now using first selected language */}

              <div>
                <label className="block text-sm font-medium mb-1">Select Languages for Translation</label>
                <div className="flex flex-wrap gap-2">
                  {["English", "French", "German", "Spanish", "Italian", "Dutch", "Portuguese"].map(lang => (
                    <label key={lang} className="inline-flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedLanguages.map(l => l.toLowerCase()).includes(lang.toLowerCase())}
                        onChange={(e) => {
                          const formattedLang = lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
                          console.log(`Language checkbox ${formattedLang} changed to ${e.target.checked}`);

                          if (e.target.checked) {
                            // Add language to selected languages
                            setSelectedLanguages(prev => {
                              const newLangs = [...prev, formattedLang];
                              console.log(`Added ${formattedLang}, new selected languages:`, newLangs);

                              // If this is the first language or no primary language, set it as primary
                              if (newLangs.length === 1 || !primaryLanguage) {
                                setPrimaryLanguage(formattedLang);
                              }

                              return newLangs;
                            });
                          } else {
                            // Remove language from selected languages
                            setSelectedLanguages(prev => {
                              const newLangs = prev.filter(l => l !== formattedLang);
                              console.log(`Removed ${formattedLang}, new selected languages:`, newLangs);

                              // If primary language is removed, update it
                              if (formattedLang === primaryLanguage && newLangs.length > 0) {
                                setPrimaryLanguage(newLangs[0]);
                              } else if (newLangs.length === 0) {
                                setPrimaryLanguage("");
                              }

                              return newLangs;
                            });
                          }
                        }}
                        disabled={isTourActive}
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
          <div className="space-y-4">
            <TourControls
              onStartTour={handleStartTour}
              onEndTour={handleEndTour}
              onToggleMute={handleToggleMute}
              isTourActive={isTourActive}
              isMuted={isMuted}
            />



            <AttendeeList attendees={attendees} />
          </div>
        </>
      )}
    </main>
  )
}
