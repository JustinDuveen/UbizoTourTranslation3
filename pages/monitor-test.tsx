/**
 * Translation Monitor Test Page
 * 
 * This page provides a simple interface to test the translation monitor
 * without modifying the main application code.
 */

import { useEffect, useRef, useState } from 'react';
import { TranslationMonitor } from '../lib/translationMonitor';

export default function MonitorTestPage() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [hasUserMedia, setHasUserMedia] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  // Check if the monitor is supported
  useEffect(() => {
    // Need to check on client side
    if (typeof window !== 'undefined') {
      const supported = TranslationMonitor.isSupported();
      setIsSupported(supported);
      
      if (supported) {
        console.log('Translation Monitor is supported in this browser');
      } else {
        console.warn('Translation Monitor is not supported in this browser');
      }
    }
  }, []);
  
  // Initialize the monitor
  const handleInitialize = () => {
    if (!isInitialized) {
      TranslationMonitor.initialize();
      setIsInitialized(true);
    }
  };
  
  // Clean up the monitor
  const handleCleanup = () => {
    if (isInitialized) {
      TranslationMonitor.cleanup();
      setIsInitialized(false);
    }
    
    // Stop any active media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
      setHasUserMedia(false);
    }
  };
  
  // Get user media and create a test track
  const handleGetUserMedia = async () => {
    try {
      // Stop any existing stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Get a new stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setHasUserMedia(true);
      
      // If monitor is initialized, connect the track
      if (isInitialized) {
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          TranslationMonitor.monitorTrack(audioTrack, selectedLanguage);
        }
      }
    } catch (error) {
      console.error('Error getting user media:', error);
      alert('Failed to access microphone. Please check permissions.');
    }
  };
  
  // Connect the track to the monitor
  const handleConnectTrack = () => {
    if (!isInitialized) {
      alert('Please initialize the monitor first');
      return;
    }
    
    if (!mediaStreamRef.current) {
      alert('Please get user media first');
      return;
    }
    
    const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      TranslationMonitor.monitorTrack(audioTrack, selectedLanguage);
    } else {
      alert('No audio track found in media stream');
    }
  };
  
  // Toggle the monitor
  const handleToggleMonitor = () => {
    if (!isInitialized) {
      alert('Please initialize the monitor first');
      return;
    }
    
    TranslationMonitor.toggleMonitor();
  };
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      handleCleanup();
    };
  }, []);
  
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Translation Monitor Test</h1>
      
      {!isSupported ? (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          Your browser does not support the required APIs for the Translation Monitor.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
            This page allows you to test the Translation Monitor without modifying the main application code.
          </div>
          
          <div className="p-4 border rounded">
            <h2 className="text-xl font-semibold mb-2">Step 1: Initialize the Monitor</h2>
            <button
              onClick={handleInitialize}
              disabled={isInitialized}
              className={`px-4 py-2 rounded ${
                isInitialized ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-700 text-white'
              }`}
            >
              {isInitialized ? 'Monitor Initialized' : 'Initialize Monitor'}
            </button>
          </div>
          
          <div className="p-4 border rounded">
            <h2 className="text-xl font-semibold mb-2">Step 2: Get User Media</h2>
            <button
              onClick={handleGetUserMedia}
              className="bg-green-500 hover:bg-green-700 text-white px-4 py-2 rounded"
            >
              {hasUserMedia ? 'Refresh Microphone Access' : 'Get Microphone Access'}
            </button>
            {hasUserMedia && (
              <p className="mt-2 text-green-600">✓ Microphone access granted</p>
            )}
          </div>
          
          <div className="p-4 border rounded">
            <h2 className="text-xl font-semibold mb-2">Step 3: Configure and Connect</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Language:
              </label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="block w-full p-2 border rounded"
              >
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Japanese">Japanese</option>
                <option value="Chinese">Chinese</option>
              </select>
            </div>
            <button
              onClick={handleConnectTrack}
              disabled={!isInitialized || !hasUserMedia}
              className={`px-4 py-2 rounded ${
                !isInitialized || !hasUserMedia
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-purple-500 hover:bg-purple-700 text-white'
              }`}
            >
              Connect Track to Monitor
            </button>
          </div>
          
          <div className="p-4 border rounded">
            <h2 className="text-xl font-semibold mb-2">Controls</h2>
            <div className="space-x-2">
              <button
                onClick={handleToggleMonitor}
                disabled={!isInitialized}
                className={`px-4 py-2 rounded ${
                  !isInitialized
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-yellow-500 hover:bg-yellow-700 text-white'
                }`}
              >
                Toggle Monitor
              </button>
              <button
                onClick={handleCleanup}
                disabled={!isInitialized}
                className={`px-4 py-2 rounded ${
                  !isInitialized
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-red-500 hover:bg-red-700 text-white'
                }`}
              >
                Clean Up Monitor
              </button>
            </div>
          </div>
          
          <div className="p-4 border rounded">
            <h2 className="text-xl font-semibold mb-2">Instructions</h2>
            <ol className="list-decimal list-inside space-y-2">
              <li>Click "Initialize Monitor" to create the monitor UI</li>
              <li>Click "Get Microphone Access" to access your microphone</li>
              <li>Select a language from the dropdown</li>
              <li>Click "Connect Track to Monitor" to start monitoring</li>
              <li>Speak into your microphone and watch the level indicator</li>
              <li>Use the volume slider in the monitor to adjust playback volume</li>
              <li>Click "Toggle Monitor" to enable/disable audio playback</li>
              <li>Click "Clean Up Monitor" when finished to remove the monitor</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
