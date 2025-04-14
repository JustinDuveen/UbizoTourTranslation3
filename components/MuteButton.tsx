"use client"

import { Button } from "@/components/ui/button"
import { Mic, MicOff } from "lucide-react"

interface MuteButtonProps {
  onToggleMute: (muted: boolean) => void;
  isMuted: boolean;
  disabled?: boolean;
}

export default function MuteButton({ 
  onToggleMute, 
  isMuted,
  disabled = false
}: MuteButtonProps) {
  return (
    <Button 
      onClick={() => onToggleMute(!isMuted)} 
      variant={isMuted ? "destructive" : "outline"}
      disabled={disabled}
      className="flex items-center gap-2"
      aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
      title={isMuted ? "Unmute microphone" : "Mute microphone"}
    >
      {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      {isMuted ? "Unmute" : "Mute"}
    </Button>
  );
}
