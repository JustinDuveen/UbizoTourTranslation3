"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import LanguageSelector from "@/components/LanguageSelector"
import TranslationOutput from "@/components/TranslationOutput"
import TourControls from "@/components/TourControls"
import AttendeeList from "@/components/AttendeeList"
import { initGuideWebRTC, cleanupGuideWebRTC, toggleMicrophoneMute } from "@/lib/guideWebRTC"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertCircle,
  Copy,
  Mic,
  MicOff,
  Play,
  Square,
  Users,
  Globe,
  Radio,
  Settings,
  BarChart3,
  Zap,
  Shield,
  Clock,
  CheckCircle,
  Volume2,
  Headphones,
  Star,
  Activity,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import { TranslationMonitor } from "@/lib/translationMonitor"

// Professional loading component
function LoadingSpinner() {
  return (
    <div className="flex justify-center items-center h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="text-center">
        <div className="relative">
          <div className="animate-spin rounded-full h-16 w-16 border-2 border-transparent bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-border mx-auto mb-6"></div>
          <div className="absolute inset-0 animate-spin rounded-full h-16 w-16 border-2 border-white/20 border-t-transparent mx-auto"></div>
        </div>
        <p className="text-white/80 font-medium text-lg">Initializing tour broadcast...</p>
        <p className="text-white/60 text-sm mt-2">Setting up real-time translation</p>
      </div>
    </div>
  )
}

export default function GuidePage() {
  const router = useRouter()
  const { toast } = useToast()
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [primaryLanguage, setPrimaryLanguage] = useState<string>("") // Will be set to first selected language
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([])
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [tourStats, setTourStats] = useState({
    duration: 0,
    totalMessages: 0,
    activeConnections: 0
  })

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
  const [tourStartTime, setTourStartTime] = useState<Date | null>(null);
  const [isLanguageAccordionOpen, setIsLanguageAccordionOpen] = useState<boolean>(true); // State for language accordion


  // Mouse tracking for interactive effects
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Tour duration tracking
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isTourActive && tourStartTime) {
      interval = setInterval(() => {
        const now = new Date()
        const duration = Math.floor((now.getTime() - tourStartTime.getTime()) / 1000)
        setTourStats(prev => ({ ...prev, duration }))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [isTourActive, tourStartTime])

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

  // Format duration for display
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

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
      setTourStartTime(new Date())
      setTourStats(prev => ({ ...prev, activeConnections: finalSelectedLanguages.length }))
      setIsLoading(false)

      // Auto-collapse language accordion when tour starts
      setIsLanguageAccordionOpen(false)

      // Show success toast
      toast({
        title: "Tour Started",
        description: `Broadcasting in ${finalSelectedLanguages.length} language${finalSelectedLanguages.length > 1 ? 's' : ''}`,
      })
    } catch (err: any) {
      console.error("Error starting tour:", err)
      setError("Failed to initialize the tour. Please try again.")
      setIsLoading(false)

      // Show error toast
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Failed to start tour",
      })
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

      // Re-open language accordion when tour ends
      setIsLanguageAccordionOpen(true)

      // Show success toast
      toast({
        title: "Tour Ended",
        description: "Tour ended successfully.",
      })
    } catch (err) {
      console.error("Error ending tour:", err)
      setError("Error ending tour. Please try again.")

      // Show error toast
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to end tour. Please try again.",
      })
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
    return <LoadingSpinner />
  }

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

      <div className="relative z-10 container mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 space-y-4 sm:space-y-0">
          <div className="flex items-center space-x-4">
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-3 shadow-lg">
              <Radio className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Tour Guide Studio</h1>
              <p className="text-white/70 text-sm sm:text-base">Professional broadcasting interface</p>
            </div>
          </div>

          {isTourActive && (
            <div className="flex items-center space-x-2 sm:space-x-4">
              <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30">
                <Activity className="h-3 w-3 mr-1 animate-pulse" />
                LIVE
              </Badge>
              <div className="text-white/80 text-sm">
                <Clock className="h-4 w-4 inline mr-1" />
                {formatDuration(tourStats.duration)}
              </div>
            </div>
          )}
        </div>

        {error ? (
          <Alert variant="destructive" className="mb-8 bg-red-500/10 border-red-500/30 text-red-400">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Left Column - Setup & Controls */}
          <div className="order-1 lg:order-1 space-y-6">
            {/* Language Selection Accordion */}
            <Card className={`backdrop-blur-sm transition-all duration-300 ${
              selectedLanguages.length > 0 && !isLanguageAccordionOpen
                ? 'bg-blue-500/10 border-blue-500/30 hover:border-blue-500/40'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}>
              <CardHeader
                className="cursor-pointer"
                onClick={() => setIsLanguageAccordionOpen(!isLanguageAccordionOpen)}
              >
                <CardTitle className="text-white flex items-center justify-between">
                  <div className="flex items-center">
                    <Globe className="h-5 w-5 mr-2 text-blue-400" />
                    Language Setup
                    {selectedLanguages.length > 0 && (
                      <Badge variant="secondary" className="ml-2 bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                        {selectedLanguages.length} selected
                      </Badge>
                    )}
                  </div>
                  <div className="text-white/60 hover:text-white transition-colors">
                    {isLanguageAccordionOpen ? (
                      <ChevronUp className="h-5 w-5" />
                    ) : (
                      <ChevronDown className="h-5 w-5" />
                    )}
                  </div>
                </CardTitle>
                <CardDescription className="text-white/70">
                  {isLanguageAccordionOpen
                    ? "Select languages for real-time translation"
                    : selectedLanguages.length > 0
                      ? `Broadcasting in: ${selectedLanguages.join(", ")}`
                      : "Click to select languages for translation"
                  }
                </CardDescription>
              </CardHeader>
              {isLanguageAccordionOpen && (
                <CardContent className="pt-0 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
                  {["French", "German", "Spanish", "Italian", "Dutch", "Portuguese"].map(lang => {
                    const isSelected = selectedLanguages.map(l => l.toLowerCase()).includes(lang.toLowerCase())
                    const isPrimary = primaryLanguage.toLowerCase() === lang.toLowerCase()

                    return (
                      <label
                        key={lang}
                        className={`relative flex items-center p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                          isSelected
                            ? 'bg-blue-500/20 border-blue-500/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20'
                        } ${isTourActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const formattedLang = lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
                            console.log(`Language checkbox ${formattedLang} changed to ${e.target.checked}`);

                            if (e.target.checked) {
                              setSelectedLanguages(prev => {
                                const newLangs = [...prev, formattedLang];
                                if (newLangs.length === 1 || !primaryLanguage) {
                                  setPrimaryLanguage(formattedLang);
                                }
                                return newLangs;
                              });
                            } else {
                              setSelectedLanguages(prev => {
                                const newLangs = prev.filter(l => l !== formattedLang);
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
                          className="sr-only"
                        />
                        <div className={`w-4 h-4 rounded border-2 mr-3 flex items-center justify-center ${
                          isSelected ? 'bg-blue-500 border-blue-500' : 'border-white/30'
                        }`}>
                          {isSelected && <CheckCircle className="h-3 w-3 text-white" />}
                        </div>
                        <span className="font-medium">{lang}</span>
                        {isPrimary && (
                          <Badge variant="secondary" className="ml-auto bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                            Primary
                          </Badge>
                        )}
                      </label>
                    )
                  })}
                </div>

                  {selectedLanguages.length > 0 && (
                    <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <div className="flex items-center text-green-400 text-sm">
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {selectedLanguages.length} language{selectedLanguages.length > 1 ? 's' : ''} selected
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
            {/* Tour Code Display */}
            {tourCreated && tourCode && (
              <Card className="bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-yellow-500/20 backdrop-blur-sm border-amber-400/40 shadow-lg shadow-amber-500/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-amber-300 flex items-center text-lg">
                    <CheckCircle className="h-5 w-5 mr-2 animate-pulse" />
                    Tour Active
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-white/90 text-sm font-medium">Share this code with attendees:</p>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-3 sm:space-y-0 sm:space-x-3">
                      <div className="relative flex-1">
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/20 to-blue-400/20 rounded-xl blur-sm"></div>
                        <div className="relative bg-gradient-to-r from-cyan-500/30 to-blue-500/30 border border-cyan-400/50 rounded-xl p-4 font-mono text-2xl sm:text-3xl text-center text-cyan-100 font-bold tracking-[0.3em] shadow-lg">
                          {tourCode}
                        </div>
                      </div>
                      <Button
                        onClick={handleCopyTourCode}
                        variant="outline"
                        size="sm"
                        className="bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border-amber-400/50 text-amber-200 hover:bg-gradient-to-r hover:from-amber-500/30 hover:to-yellow-500/30 hover:border-amber-300/60 min-h-[48px] sm:min-h-auto font-semibold shadow-md"
                      >
                        <Copy className="h-4 w-4 mr-2 sm:mr-0" />
                        <span className="sm:hidden">Copy Code</span>
                      </Button>
                    </div>
                    {copySuccess && (
                      <div className="flex items-center justify-center p-2 bg-green-500/20 border border-green-400/30 rounded-lg">
                        <CheckCircle className="h-4 w-4 mr-2 text-green-400" />
                        <p className="text-green-300 text-sm font-medium">{copySuccess}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tour Controls */}
            <Card className="bg-white/5 backdrop-blur-sm border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <Settings className="h-5 w-5 mr-2 text-purple-400" />
                  Broadcast Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isTourActive ? (
                  <Button
                    onClick={handleStartTour}
                    disabled={selectedLanguages.length === 0}
                    className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold py-4 sm:py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 min-h-[48px]"
                    size="lg"
                  >
                    <Play className="h-5 w-5 mr-2" />
                    Start Broadcasting
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <Button
                      onClick={() => handleToggleMute(!isMuted)}
                      variant="outline"
                      className={`w-full min-h-[48px] ${
                        isMuted
                          ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30'
                          : 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30'
                      }`}
                    >
                      {isMuted ? (
                        <>
                          <MicOff className="h-4 w-4 mr-2" />
                          Unmute Microphone
                        </>
                      ) : (
                        <>
                          <Mic className="h-4 w-4 mr-2" />
                          Mute Microphone
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={handleEndTour}
                      variant="destructive"
                      className="w-full bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30 min-h-[48px]"
                    >
                      <Square className="h-4 w-4 mr-2" />
                      End Tour
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tour Statistics */}
            {isTourActive && (
              <Card className="bg-white/5 backdrop-blur-sm border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <BarChart3 className="h-5 w-5 mr-2 text-cyan-400" />
                    Live Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white">{attendees.length}</div>
                      <div className="text-xs text-white/60">Attendees</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white">{selectedLanguages.length}</div>
                      <div className="text-xs text-white/60">Languages</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          {/* Middle Column - Live Translations */}
          <div className="order-3 lg:order-2 space-y-6">
            <Card className="bg-white/5 backdrop-blur-sm border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center">
                  <Volume2 className="h-5 w-5 mr-2 text-green-400" />
                  Live Translations
                </CardTitle>
                <CardDescription className="text-white/70">
                  Real-time translation output
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-h-64 sm:max-h-96 overflow-y-auto">
                  {Object.entries(translations).map(([language, text]) => (
                    <div key={language} className="bg-white/5 rounded-lg p-4 border border-white/10">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-white font-semibold flex items-center">
                          <Globe className="h-4 w-4 mr-2 text-blue-400" />
                          {language}
                        </h3>
                        <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                          <Activity className="h-3 w-3 mr-1 animate-pulse" />
                          Live
                        </Badge>
                      </div>
                      <div className="text-white/80 text-sm leading-relaxed">
                        <TranslationOutput translation={text} />
                      </div>
                    </div>
                  ))}
                  {Object.keys(translations).length === 0 && (
                    <div className="text-center text-white/60 py-8">
                      <Headphones className="h-12 w-12 mx-auto mb-4 text-white/30" />
                      <p>Waiting for translations...</p>
                      <p className="text-sm mt-2">Start speaking to see real-time translations</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Attendees & Analytics */}
          <div className="order-2 lg:order-3 space-y-6">
            <Card className="bg-white/5 backdrop-blur-sm border-white/10">
              <CardHeader>
                <CardTitle className="text-white flex items-center justify-between">
                  <div className="flex items-center">
                    <Users className="h-5 w-5 mr-2 text-orange-400" />
                    Connected Attendees
                  </div>
                  <Badge variant="secondary" className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                    {attendees.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 max-h-64 sm:max-h-96 overflow-y-auto">
                  {(() => {
                    // Group attendees by language
                    const attendeesByLanguage = attendees.reduce((acc, attendee) => {
                      if (!acc[attendee.language]) {
                        acc[attendee.language] = [];
                      }
                      acc[attendee.language].push(attendee);
                      return acc;
                    }, {} as Record<string, Attendee[]>);

                    return Object.entries(attendeesByLanguage).map(([language, languageAttendees]) => (
                      <div key={language} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-white/80 font-medium text-sm flex items-center">
                            <Globe className="h-3 w-3 mr-1 text-blue-400" />
                            {language.charAt(0).toUpperCase() + language.slice(1)}
                          </h4>
                          <Badge variant="secondary" className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                            {languageAttendees.length}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          {languageAttendees.map((attendee) => (
                            <div key={attendee.id} className="bg-white/5 rounded-lg p-3 border border-white/10">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                                    <span className="text-white text-sm font-bold">
                                      {attendee.name.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div>
                                    <p className="text-white font-medium text-sm">{attendee.name}</p>
                                    <p className="text-white/60 text-xs">
                                      {new Date(attendee.joinTime).toLocaleTimeString()}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                  <span className="text-white/60 text-xs">Online</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                  {attendees.length === 0 && (
                    <div className="text-center text-white/60 py-8">
                      <Users className="h-12 w-12 mx-auto mb-4 text-white/30" />
                      <p>No attendees connected</p>
                      <p className="text-sm mt-2">Share your tour code to get started</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            {isTourActive && (
              <Card className="bg-white/5 backdrop-blur-sm border-white/10">
                <CardHeader>
                  <CardTitle className="text-white flex items-center">
                    <Zap className="h-5 w-5 mr-2 text-yellow-400" />
                    Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Translation Latency</span>
                      <span className="text-green-400 font-semibold">&lt; 200ms</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Audio Quality</span>
                      <span className="text-green-400 font-semibold">HD</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Connection Status</span>
                      <div className="flex items-center">
                        <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                        <span className="text-green-400 font-semibold">Stable</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
        )}

        {/* Footer */}
        <div className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-white/10 text-center">
          <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-green-400" />
              <span className="text-white/80 text-sm">Secure • Professional • Reliable</span>
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
