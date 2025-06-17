"use client"

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DiagnosticData {
  tourCode: string;
  language: string;
  attendeeName: string;
  connectionState: string;
  iceConnectionState: string;
  audioTracks: number;
  packetsReceived: number;
  bytesReceived: number;
  audioLevel: number;
  lastUpdate: string;
}

interface WebRTCDiagnosticsProps {
  tourCode?: string;
  language?: string;
  attendeeName?: string;
}

export default function WebRTCDiagnostics({ 
  tourCode = '', 
  language = '', 
  attendeeName = '' 
}: WebRTCDiagnosticsProps) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticData>({
    tourCode,
    language,
    attendeeName,
    connectionState: 'new',
    iceConnectionState: 'new',
    audioTracks: 0,
    packetsReceived: 0,
    bytesReceived: 0,
    audioLevel: 0,
    lastUpdate: new Date().toISOString()
  });

  const [redisData, setRedisData] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Check Redis data
  const checkRedisData = async () => {
    if (!tourCode || !language) return;

    try {
      // Check if tour exists and get offer
      const response = await fetch(`/api/tour/offer?tourCode=${tourCode}&language=${language}&attendeeName=${attendeeName}`);
      const data = await response.json();
      
      setRedisData({
        status: response.status,
        hasOffer: !!data.offer,
        isPlaceholder: data.placeholder,
        tourId: data.tourId,
        error: data.error,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      setRedisData({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  };

  // Monitor WebRTC connections
  useEffect(() => {
    const interval = setInterval(() => {
      // Look for WebRTC connections in the global scope
      const connections = (window as any).webrtcConnections || new Map();
      
      let totalAudioTracks = 0;
      let totalPacketsReceived = 0;
      let totalBytesReceived = 0;
      let maxAudioLevel = 0;
      let connectionState = 'new';
      let iceConnectionState = 'new';

      connections.forEach((connection: any) => {
        if (connection.pc) {
          connectionState = connection.pc.connectionState;
          iceConnectionState = connection.pc.iceConnectionState;
          
          // Get stats if available
          connection.pc.getStats().then((stats: RTCStatsReport) => {
            stats.forEach((report: any) => {
              if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                totalPacketsReceived += report.packetsReceived || 0;
                totalBytesReceived += report.bytesReceived || 0;
              }
              if (report.type === 'media-source' && report.kind === 'audio') {
                maxAudioLevel = Math.max(maxAudioLevel, report.audioLevel || 0);
              }
            });
          }).catch(() => {
            // Stats not available
          });
        }
        
        if (connection.mediaStream) {
          totalAudioTracks += connection.mediaStream.getAudioTracks().length;
        }
      });

      setDiagnostics(prev => ({
        ...prev,
        connectionState,
        iceConnectionState,
        audioTracks: totalAudioTracks,
        packetsReceived: totalPacketsReceived,
        bytesReceived: totalBytesReceived,
        audioLevel: maxAudioLevel,
        lastUpdate: new Date().toISOString()
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Check Redis data periodically
  useEffect(() => {
    checkRedisData();
    const interval = setInterval(checkRedisData, 5000);
    return () => clearInterval(interval);
  }, [tourCode, language, attendeeName]);

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'connected': return 'text-green-600';
      case 'connecting': return 'text-yellow-600';
      case 'disconnected':
      case 'failed': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-blue-600 z-50"
      >
        Show Diagnostics
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 z-50">
      <Card className="bg-white shadow-lg border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex justify-between items-center">
            WebRTC Diagnostics
            <button
              onClick={() => setIsVisible(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-2">
          {/* Connection Info */}
          <div className="border-b pb-2">
            <div><strong>Tour:</strong> {diagnostics.tourCode}</div>
            <div><strong>Language:</strong> {diagnostics.language}</div>
            <div><strong>Attendee:</strong> {diagnostics.attendeeName}</div>
          </div>

          {/* WebRTC Status */}
          <div className="border-b pb-2">
            <div className="font-semibold">WebRTC Status:</div>
            <div className={`${getStatusColor(diagnostics.connectionState)}`}>
              Connection: {diagnostics.connectionState}
            </div>
            <div className={`${getStatusColor(diagnostics.iceConnectionState)}`}>
              ICE: {diagnostics.iceConnectionState}
            </div>
            <div>Audio Tracks: {diagnostics.audioTracks}</div>
          </div>

          {/* Audio Stats */}
          <div className="border-b pb-2">
            <div className="font-semibold">Audio Stats:</div>
            <div>Packets: {diagnostics.packetsReceived}</div>
            <div>Bytes: {diagnostics.bytesReceived}</div>
            <div>Level: {(diagnostics.audioLevel * 100).toFixed(1)}%</div>
          </div>

          {/* Redis Status */}
          <div className="border-b pb-2">
            <div className="font-semibold">Redis Status:</div>
            {redisData ? (
              <>
                <div className={redisData.error ? 'text-red-600' : 'text-green-600'}>
                  Status: {redisData.status || 'Error'}
                </div>
                <div>Has Offer: {redisData.hasOffer ? '✅' : '❌'}</div>
                <div>Placeholder: {redisData.isPlaceholder ? '⚠️' : '✅'}</div>
                <div>Tour ID: {redisData.tourId || 'N/A'}</div>
                {redisData.error && (
                  <div className="text-red-600">Error: {redisData.error}</div>
                )}
              </>
            ) : (
              <div>Loading...</div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-1">
            <button
              onClick={checkRedisData}
              className="w-full bg-blue-500 text-white py-1 px-2 rounded text-xs hover:bg-blue-600"
            >
              Refresh Redis Data
            </button>
            <div className="text-gray-500 text-xs">
              Last Update: {new Date(diagnostics.lastUpdate).toLocaleTimeString()}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
