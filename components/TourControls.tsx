"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

interface TourControlsProps {
  onStartTour: () => Promise<void>
  onEndTour: () => Promise<void>
  isTourActive: boolean
}

export default function TourControls({ 
  onStartTour, 
  onEndTour,
  isTourActive
}: TourControlsProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleAction = async (action: () => Promise<void>, successMsg: string) => {
    setIsLoading(true)
    try {
      await action()
      toast({
        title: successMsg,
        description: `Tour ${successMsg.toLowerCase()} successfully.`,
      })
    } catch (error) {
      console.error(`Tour ${successMsg.toLowerCase()} error:`, error)
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : `Failed to ${successMsg.toLowerCase()} tour`,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex space-x-4 mt-4">
      <Button 
        onClick={() => handleAction(onStartTour, "Started")} 
        disabled={isLoading || isTourActive}
      >
        {isLoading ? "Starting..." : "Start Tour"}
      </Button>
      <Button 
        onClick={() => handleAction(onEndTour, "Ended")} 
        variant="destructive" 
        disabled={isLoading || !isTourActive}
      >
        {isLoading ? "Ending..." : "End Tour"}
      </Button>
    </div>
  )
}