/**
 * Audio System Status Component
 * Real-time monitoring and status display for OpenAI audio reception
 * Senior WebRTC Developer - Emergency Architecture Fix
 */

"use client"

import { useState, useEffect } from 'react'
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { 
  Volume2, 
  VolumeX, 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw,
  Headphones,
  Radio,
  Settings
} from "lucide-react"

interface AudioStatus {
  language: string;
  hasOpenAIConnection: boolean;
  hasAudioStream: boolean;
  attendeeCount: number;
  connectionState: string;
  lastAudioReceived?: Date;
  isHealthy: boolean;
}

interface AudioSystemStatusProps {
  languages: string[];
  isActive: boolean;
}

export default function AudioSystemStatus({ languages, isActive }: AudioSystemStatusProps) {
  const [audioStatuses, setAudioStatuses] = useState<AudioStatus[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Monitor audio system health
  useEffect(() => {
    if (!isActive || languages.length === 0) {
      setIsMonitoring(false);
      return;
    }

    setIsMonitoring(true);
    
    const checkAudioHealth = () => {
      try {
        const statuses: AudioStatus[] = [];
        
        // Access the global emergency audio system
        const audioDebug = (window as any).audioDebug;
        const emergencySystem = (window as any).emergencyAudioSystem;
        
        if (audioDebug) {
          const connections = audioDebug.checkConnections();
          const streams = audioDebug.checkAudioStreams();
          
          languages.forEach(language => {
            const normalizedLang = language.toLowerCase();
            const flowCheck = audioDebug.testAudioFlow(normalizedLang);
            
            const status: AudioStatus = {
              language,
              hasOpenAIConnection: flowCheck?.openAIConnection?.exists || false,
              hasAudioStream: streams[normalizedLang]?.hasStream || false,
              attendeeCount: flowCheck?.attendeeConnections?.count || 0,
              connectionState: flowCheck?.openAIConnection?.peerConnectionState || 'unknown',
              isHealthy: false
            };
            
            // Determine health status
            status.isHealthy = status.hasOpenAIConnection && 
                              status.hasAudioStream && 
                              status.connectionState === 'connected';
            
            statuses.push(status);
          });
        } else {
          // Fallback status when debug system isn't available
          languages.forEach(language => {
            statuses.push({
              language,
              hasOpenAIConnection: false,
              hasAudioStream: false,
              attendeeCount: 0,
              connectionState: 'unknown',
              isHealthy: false
            });
          });
        }
        
        setAudioStatuses(statuses);
        setLastUpdate(new Date());
      } catch (error) {
        console.error('Error checking audio health:', error);
      }
    };

    // Initial check
    checkAudioHealth();
    
    // Regular monitoring
    const interval = setInterval(checkAudioHealth, 3000);
    
    return () => {
      clearInterval(interval);
      setIsMonitoring(false);
    };
  }, [isActive, languages]);

  const handleEmergencyFix = async (language: string) => {
    try {
      const emergencySystem = (window as any).emergencyAudioSystem;
      if (emergencySystem) {
        console.log(`🚨 Triggering emergency fix for ${language}...`);
        await emergencySystem.initializeEmergencyAudioSystem(language.toLowerCase());
      } else {
        console.error('Emergency audio system not available');
      }
    } catch (error) {
      console.error('Emergency fix failed:', error);
    }
  };

  const handleForceAudioCheck = (language: string) => {
    try {
      const audioDebug = (window as any).audioDebug;
      if (audioDebug) {
        console.log(`🔍 Force checking audio for ${language}...`);
        audioDebug.forceAudioCheck(language.toLowerCase());
      }
    } catch (error) {
      console.error('Force audio check failed:', error);
    }
  };

  const getStatusColor = (status: AudioStatus) => {
    if (status.isHealthy) return 'bg-green-500';
    if (status.hasOpenAIConnection) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getStatusText = (status: AudioStatus) => {
    if (status.isHealthy) return 'Healthy';
    if (status.hasOpenAIConnection && !status.hasAudioStream) return 'No Audio';
    if (!status.hasOpenAIConnection) return 'No Connection';
    return 'Unknown';
  };

  const overallHealth = audioStatuses.every(status => status.isHealthy);
  const criticalIssues = audioStatuses.filter(status => !status.hasOpenAIConnection).length;
  const audioIssues = audioStatuses.filter(status => status.hasOpenAIConnection && !status.hasAudioStream).length;

  if (!isActive) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <VolumeX className="h-4 w-4 text-gray-400" />
            Audio System Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-500">Tour not active</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {overallHealth ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-500" />
          )}
          Audio System Status
          <Badge variant={overallHealth ? "default" : "destructive"} className="ml-auto">
            {isMonitoring ? "Monitoring" : "Inactive"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall Status */}
        {!overallHealth && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {criticalIssues > 0 && `${criticalIssues} connection issues. `}
              {audioIssues > 0 && `${audioIssues} audio reception issues. `}
              Use emergency fixes below.
            </AlertDescription>
          </Alert>
        )}

        {/* Per-Language Status */}
        <div className="space-y-2">
          {audioStatuses.map((status) => (
            <div key={status.language} className="flex items-center justify-between p-2 rounded-lg border">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
                <span className="font-medium text-sm">{status.language}</span>
                <Badge variant="outline" className="text-xs">
                  {getStatusText(status)}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                {status.attendeeCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <Headphones className="h-3 w-3 mr-1" />
                    {status.attendeeCount}
                  </Badge>
                )}
                
                {!status.isHealthy && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleForceAudioCheck(status.language)}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleEmergencyFix(status.language)}
                    >
                      Fix
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Debug Panel Toggle */}
        <div className="pt-2 border-t">
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start text-xs"
            onClick={() => setShowDebugPanel(!showDebugPanel)}
          >
            <Settings className="h-3 w-3 mr-1" />
            {showDebugPanel ? 'Hide' : 'Show'} Debug Panel
          </Button>
          
          {showDebugPanel && (
            <div className="mt-2 p-3 bg-gray-50 rounded-lg">
              <div className="text-xs space-y-2">
                <div>
                  <strong>Debug Console Commands:</strong>
                </div>
                <div className="font-mono text-xs bg-white p-2 rounded border">
                  <div>audioDebug.diagnose()</div>
                  <div>audioDebug.emergencyFix("italian")</div>
                  <div>audioDebug.forceAudioCheck("italian")</div>
                  <div>audioDebug.startMonitoring("italian")</div>
                </div>
                <div className="text-xs text-gray-600">
                  Last update: {lastUpdate.toLocaleTimeString()}
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}