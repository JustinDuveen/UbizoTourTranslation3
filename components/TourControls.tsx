"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

interface TourControlsProps {
  onStartTour: () => Promise<void>
  onEndTour: () => Promise<void>
}

/**
 * TourControls Component
 *
 * This component provides buttons to start and end a tour.
 * It manages its own loading states and displays toast notifications for success or failure.
 *
 * Props:
 * - onStartTour: A function to call when starting a tour
 * - onEndTour: A function to call when ending a tour
 *
 * The component disables buttons while actions are in progress and shows loading states.
 * It uses the toast component to display feedback to the user.
 */
export default function TourControls({ onStartTour, onEndTour }: TourControlsProps) {
  const [isStarting, setIsStarting] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const { toast } = useToast()

  const handleStartTour = async () => {
    setIsStarting(true)
    try {
      await onStartTour()
      toast({
        title: "Tour Started",
        description: "The tour has been successfully started.",
      })
    } catch (error) {
      console.error("Failed to start tour:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to start the tour. Please try again.",
      })
    } finally {
      setIsStarting(false)
    }
  }

  const handleEndTour = async () => {
    setIsEnding(true)
    try {
      await onEndTour()
      toast({
        title: "Tour Ended",
        description: "The tour has been successfully ended.",
      })
    } catch (error) {
      console.error("Failed to end tour:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to end the tour. Please try again.",
      })
    } finally {
      setIsEnding(false)
    }
  }

  return (
    <div className="flex space-x-4 mt-4">
      <Button onClick={handleStartTour} disabled={isStarting || isEnding}>
        {isStarting ? "Starting..." : "Start Tour"}
      </Button>
      <Button onClick={handleEndTour} variant="destructive" disabled={isStarting || isEnding}>
        {isEnding ? "Ending..." : "End Tour"}
      </Button>
    </div>
  )
}

