// File path: src/lib/audioTranslation.ts (or wherever you keep your utility classes)

import { getRedisClient } from "@/lib/redis";

interface AudioTranslationData {
  tourId: string;
  language: string;
  audioData: ArrayBuffer | string; // Can be binary or base64 encoded
}

export class AudioTranslationHandler {
  private peerConnection: RTCPeerConnection | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  
  constructor() {
    this.setupPeerConnection();
  }
  
  private setupPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
    
    this.peerConnection.ontrack = this.handleTrack.bind(this);
    this.peerConnection.onicecandidate = this.handleIceCandidate.bind(this);
  }
  
  private handleTrack(event: RTCTrackEvent) {
    if (event.track.kind === 'audio') {
      this.audioTrack = event.track;
      console.log('Audio track received:', this.audioTrack);
      
      // Set up audio processing
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(new MediaStream([this.audioTrack]));
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      
      processor.onaudioprocess = (audioProcessingEvent) => {
        const inputBuffer = audioProcessingEvent.inputBuffer;
        // Process audio data here if needed
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
    }
  }
  
  private handleIceCandidate(event: RTCPeerConnectionIceEvent) {
    if (event.candidate) {
      // Send ICE candidate to remote peer (implementation depends on signaling method)
      console.log('ICE candidate:', event.candidate);
    }
  }
  
  // Process and store audio translation
  public async processAudioTranslation(tourId: string, language: string, audioData: ArrayBuffer | string): Promise<boolean> {
    try {
      const translationData: AudioTranslationData = {
        tourId,
        language,
        audioData
      };
      
      // Store in Redis
      const success = await this.storeAudioTranslation(translationData);
      return success;
    } catch (error) {
      console.error('Error processing audio translation:', error);
      return false;
    }
  }
  
  // Store audio translation in Redis
  private async storeAudioTranslation(translationData: AudioTranslationData): Promise<boolean> {
    const { tourId, language, audioData } = translationData;
    
    try {
      const redisClient = await getRedisClient();
      if (!redisClient) {
        throw new Error("Failed to connect to Redis");
      }
      
      const redisChannel = `tour:${tourId}:${language}:audio`;
      
      // Convert AudioBuffer to serializable format if needed
      const audioPayload = {
        tourId,
        language,
        audioData: typeof audioData === 'string' ? audioData : this.arrayBufferToBase64(audioData)
      };
      
      // Publish to Redis channel
      await redisClient.publish(redisChannel, JSON.stringify(audioPayload));
      
      // Store for later retrieval
      const audioKey = `audio:${tourId}:${language}`;
      await redisClient.set(audioKey, JSON.stringify(audioPayload));
      
      await redisClient.quit();
      return true;
    } catch (error) {
      console.error("Redis error:", error);
      return false;
    }
  }
  
  // Helper method to convert ArrayBuffer to Base64 string
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  // Clean up resources
  public close() {
    if (this.audioTrack) {
      this.audioTrack.stop();
      this.audioTrack = null;
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}