"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import LanguageSelector from "@/components/LanguageSelector"
import TranslationOutput from "@/components/TranslationOutput"
import { initWebRTC, cleanupWebRTC } from "@/lib/webrtc"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

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
  const [tourId, setTourId] = useState<string | null>(""); // State for tour code input
  const [connecting, setConnecting] = useState(false);

  // Define the connectToGuide function
  const connectToGuide = async (tourCode: string, selectedLanguage: string) => {
      await initWebRTC(setTranslation, selectedLanguage, tourCode); // Pass tourId to initWebRTC
  };

    const handleConnect = () => {
    if (!tourId || !language) {
      setError('Please enter a tour code and select a language');
      return;
    }
    
    setConnecting(true);
    connectToGuide(tourId, language)
      .then(() => {
        // setTourCode(tourId); // Store the tour code as the tourId // No need to set tour code here, already in state
        setConnecting(false);
      })
      .catch((err) => {
        console.error('Connection error:', err);
        if (err.message.includes("Failed to get offer: Not Found")) {
          setNoTourError("Invalid Tour Code or no active tour found for this language. Please check the code and language and try again.");
        } else {
          setError('Failed to connect to the guide. Please check your tour code and try again.');
        }
        setConnecting(false);
      });
  };


  // Check if the user is an attendee when the component mounts
  useEffect(() => {
    async function init() {
      const checkUserRole = async () => {
        try {
          const response = await fetch("/api/auth/check", {
            credentials: "include"
          })
          const data = await response.json()
          
          if (data.user && data.user.role !== "attendee") {
            // setError(`You are logged in as ${data.user.role}. You must be logged in as an attendee to use this interface.`)
            // setIsLoading(false)
            return data.user.role;
          } else {
            // Automatically connect with the default language
            // Only connect if tourId is not empty
            // if (tourId) {
            //   await connectToGuide()
            // }
            return 'attendee';
          }
        } catch (error) {
          console.error("Error checking user role:", error)
          setError("Failed to verify your account. Please try logging in again.")
          setIsLoading(false)
        }
      }

      try {
        // Check user role first
        const role = await checkUserRole();
        if (role !== 'attendee') {
          router.push('/unauthorized');
          return;
        }
        
        // Set loading to false after role check succeeds
        setIsLoading(false);
      } catch (error) {
        console.error('Error initializing attendee page:', error);
        setIsLoading(false);
      }
    }
    
    init();
  }, []);

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
              onChange={(e) => setTourId(e.target.value)}
            />
          </div>

          <LanguageSelector
            language={language}
            setLanguage={setLanguage}
            options={["French", "German", "Spanish", "Italian", "Dutch", "Portuguese", "Japanese", "Chinese", "Korean"]} // supported languages
            // connectToGuide={connectToGuide} // Remove connectToGuide from LanguageSelector
          />
          <Button
            onClick={handleConnect}
            disabled={connecting}
            className="mt-4"
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
          <TranslationOutput translation={translation} />
        </>
      )}
    </main>
  );
}
