/**
 * Enterprise SDP Management System
 * 
 * Provides comprehensive SDP validation, optimization, and security for WebRTC connections.
 * Handles codec preference, bandwidth optimization, and enterprise-specific modifications.
 * 
 * @author Senior WebRTC Developer
 * @version 1.0.0
 */

export interface SDPValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  optimizations: string[];
}

export interface SDPOptimizationConfig {
  preferredAudioCodec: string;
  maxAudioBitrate: number;
  enableDTX: boolean; // Discontinuous Transmission
  enableFEC: boolean; // Forward Error Correction
  enableOpusInBandFEC: boolean;
  stereo: boolean;
  maxptime: number;
  minptime: number;
}

/**
 * Enterprise SDP Manager for WebRTC optimization
 */
export class EnterpriseSDPManager {
  private static readonly DEFAULT_CONFIG: SDPOptimizationConfig = {
    preferredAudioCodec: 'opus',
    maxAudioBitrate: 64000, // 64 kbps for high-quality speech
    enableDTX: true, // Save bandwidth during silence
    enableFEC: true, // Improve quality on lossy networks
    enableOpusInBandFEC: true,
    stereo: false, // Mono for speech translation
    maxptime: 60, // Maximum packet time
    minptime: 10  // Minimum packet time
  };

  /**
   * Create optimized offer with enterprise settings
   */
  static async createOptimizedOffer(
    pc: RTCPeerConnection,
    config: Partial<SDPOptimizationConfig> = {},
    iceRestart: boolean = false
  ): Promise<RTCSessionDescriptionInit> {
    const offer = await pc.createOffer({
      // ICE controlling role for guide (initiates connectivity checks)
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
      iceRestart: iceRestart
    });

    const optimizedOffer = this.optimizeSDPForEnterprise(offer, config);
    
    // Validate before returning
    const validation = this.validateSDP(optimizedOffer);
    if (!validation.isValid) {
      console.error('SDP validation failed:', validation.errors);
      throw new Error(`SDP validation failed: ${validation.errors.join(', ')}`);
    }

    return optimizedOffer;
  }

  /**
   * Create optimized answer with enterprise settings
   */
  static async createOptimizedAnswer(
    pc: RTCPeerConnection,
    config: Partial<SDPOptimizationConfig> = {}
  ): Promise<RTCSessionDescriptionInit> {
    const answer = await pc.createAnswer({
      // ICE controlled role for attendee (responds to connectivity checks)
      offerToReceiveAudio: true,
      offerToReceiveVideo: false
    });
    
    const optimizedAnswer = this.optimizeSDPForEnterprise(answer, config);
    
    // Validate before returning
    const validation = this.validateSDP(optimizedAnswer);
    if (!validation.isValid) {
      console.error('SDP validation failed:', validation.errors);
      throw new Error(`SDP validation failed: ${validation.errors.join(', ')}`);
    }

    return optimizedAnswer;
  }

  /**
   * Optimize SDP for enterprise use case
   */
  static optimizeSDPForEnterprise(
    sdp: RTCSessionDescriptionInit,
    userConfig: Partial<SDPOptimizationConfig> = {}
  ): RTCSessionDescriptionInit {
    if (!sdp.sdp) {
      throw new Error('SDP content is missing');
    }

    const config = { ...this.DEFAULT_CONFIG, ...userConfig };
    let optimizedSDP = sdp.sdp;

    // 1. Codec Preference - Prioritize Opus for audio
    optimizedSDP = this.prioritizeOpusCodec(optimizedSDP);

    // 2. Bandwidth Optimization
    optimizedSDP = this.optimizeBandwidth(optimizedSDP, config);

    // 3. Audio Quality Enhancements
    optimizedSDP = this.enhanceAudioQuality(optimizedSDP, config);

    // 4. Security Enhancements
    optimizedSDP = this.enhanceSecurity(optimizedSDP);

    // 5. Low-latency optimizations
    optimizedSDP = this.optimizeForLowLatency(optimizedSDP, config);

    // 6. ICE Role Enforcement
    optimizedSDP = this.enforceICERoles(optimizedSDP, sdp.type);

    return {
      type: sdp.type,
      sdp: optimizedSDP
    };
  }

  /**
   * Prioritize Opus codec for optimal speech quality
   */
  private static prioritizeOpusCodec(sdp: string): string {
    const lines = sdp.split('\r\n');
    const audioMLineIndex = lines.findIndex(line => line.startsWith('m=audio'));
    
    if (audioMLineIndex === -1) return sdp;

    // Find Opus payload type
    const opusPayloadType = this.findOpusPayloadType(lines);
    if (!opusPayloadType) return sdp;

    // Reorder codecs to prioritize Opus
    const audioMLine = lines[audioMLineIndex];
    const parts = audioMLine.split(' ');
    
    if (parts.length > 3) {
      const payloadTypes = parts.slice(3);
      
      // Move Opus to front
      const reorderedTypes = [
        opusPayloadType,
        ...payloadTypes.filter(pt => pt !== opusPayloadType)
      ];
      
      lines[audioMLineIndex] = `${parts.slice(0, 3).join(' ')} ${reorderedTypes.join(' ')}`;
    }

    return lines.join('\r\n');
  }

  /**
   * Find Opus payload type in SDP
   */
  private static findOpusPayloadType(lines: string[]): string | null {
    for (const line of lines) {
      if (line.includes('opus/48000')) {
        const match = line.match(/a=rtpmap:(\d+)\s+opus/i);
        return match ? match[1] : null;
      }
    }
    return null;
  }

  /**
   * Optimize bandwidth settings
   */
  private static optimizeBandwidth(sdp: string, config: SDPOptimizationConfig): string {
    const lines = sdp.split('\r\n');
    const opusPayloadType = this.findOpusPayloadType(lines);
    
    if (!opusPayloadType) return sdp;

    // Add bandwidth limitation
    const bandwidthLine = `b=AS:${Math.ceil(config.maxAudioBitrate / 1000)}`;
    
    // Find where to insert bandwidth line (after connection line)
    const connectionIndex = lines.findIndex(line => line.startsWith('c='));
    if (connectionIndex !== -1 && !lines.some(line => line.startsWith('b='))) {
      lines.splice(connectionIndex + 1, 0, bandwidthLine);
    }

    // Add fmtp line for Opus optimization
    const fmtpIndex = lines.findIndex(line => 
      line.startsWith(`a=fmtp:${opusPayloadType}`)
    );

    const fmtpParams = [
      `maxaveragebitrate=${config.maxAudioBitrate}`,
      `stereo=${config.stereo ? 1 : 0}`,
      `sprop-stereo=${config.stereo ? 1 : 0}`,
      `usedtx=${config.enableDTX ? 1 : 0}`,
      `useinbandfec=${config.enableOpusInBandFEC ? 1 : 0}`,
      `maxptime=${config.maxptime}`,
      `minptime=${config.minptime}`
    ];

    if (fmtpIndex !== -1) {
      // Update existing fmtp line
      lines[fmtpIndex] = `a=fmtp:${opusPayloadType} ${fmtpParams.join(';')}`;
    } else {
      // Add new fmtp line after rtpmap
      const rtpmapIndex = lines.findIndex(line => 
        line.startsWith(`a=rtpmap:${opusPayloadType}`)
      );
      if (rtpmapIndex !== -1) {
        lines.splice(rtpmapIndex + 1, 0, `a=fmtp:${opusPayloadType} ${fmtpParams.join(';')}`);
      }
    }

    return lines.join('\r\n');
  }

  /**
   * Enhance audio quality settings
   */
  private static enhanceAudioQuality(sdp: string, config: SDPOptimizationConfig): string {
    let lines = sdp.split('\r\n');

    // Add ptime (packet time) for consistent audio framing
    const audioMLineIndex = lines.findIndex(line => line.startsWith('m=audio'));
    if (audioMLineIndex !== -1) {
      const ptimeExists = lines.some(line => line.startsWith('a=ptime:'));
      if (!ptimeExists) {
        lines.splice(audioMLineIndex + 1, 0, 'a=ptime:20'); // 20ms packets for good quality/latency balance
      }
    }

    return lines.join('\r\n');
  }

  /**
   * Enhance security settings
   */
  private static enhanceSecurity(sdp: string): string {
    const lines = sdp.split('\r\n');

    // Ensure DTLS-SRTP is properly configured
    const fingerprintExists = lines.some(line => line.startsWith('a=fingerprint:'));
    if (!fingerprintExists) {
      console.warn('No DTLS fingerprint found in SDP - security may be compromised');
    }

    // Ensure proper setup attribute
    const setupExists = lines.some(line => line.startsWith('a=setup:'));
    if (!setupExists) {
      // Add setup attribute after fingerprint
      const fingerprintIndex = lines.findIndex(line => line.startsWith('a=fingerprint:'));
      if (fingerprintIndex !== -1) {
        lines.splice(fingerprintIndex + 1, 0, 'a=setup:actpass');
      }
    }

    return lines.join('\r\n');
  }

  /**
   * Optimize for low latency
   */
  private static optimizeForLowLatency(sdp: string, config: SDPOptimizationConfig): string {
    const lines = sdp.split('\r\n');

    // Add low-latency attributes
    const audioMLineIndex = lines.findIndex(line => line.startsWith('m=audio'));
    if (audioMLineIndex !== -1) {
      // Add after audio m-line if not present
      const hasMaxptime = lines.some(line => line.startsWith('a=maxptime:'));
      if (!hasMaxptime) {
        lines.splice(audioMLineIndex + 1, 0, `a=maxptime:${config.maxptime}`);
      }
    }

    return lines.join('\r\n');
  }

  /**
   * Enforce proper ICE roles to prevent deadlocks
   */
  private static enforceICERoles(sdp: string, sdpType: string): string {
    const lines = sdp.split('\r\n');
    
    if (sdpType === 'offer') {
      // Guide creates offers - must be ICE controlling (initiates connectivity checks)
      // Remove any existing ice-options to avoid conflicts
      const filteredLines = lines.filter(line => !line.startsWith('a=ice-options:'));
      
      // Add controlling ice-options after first media line
      const audioMLineIndex = filteredLines.findIndex(line => line.startsWith('m=audio'));
      if (audioMLineIndex !== -1) {
        filteredLines.splice(audioMLineIndex + 1, 0, 'a=ice-options:trickle');
      }
      
      return filteredLines.join('\r\n');
    } else if (sdpType === 'answer') {
      // Attendee creates answers - must be ICE controlled (responds to connectivity checks)
      // Ensure no controlling ice-options are present
      const filteredLines = lines.filter(line => !line.startsWith('a=ice-options:'));
      
      return filteredLines.join('\r\n');
    }
    
    return sdp;
  }

  /**
   * Comprehensive SDP validation
   */
  static validateSDP(sdp: RTCSessionDescriptionInit): SDPValidationResult {
    const result: SDPValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      optimizations: []
    };

    if (!sdp.sdp) {
      result.isValid = false;
      result.errors.push('SDP content is missing');
      return result;
    }

    if (!sdp.type) {
      result.isValid = false;
      result.errors.push('SDP type is missing');
      return result;
    }

    const lines = sdp.sdp.split('\r\n');

    // Check for required SDP lines
    if (!lines.some(line => line.startsWith('v='))) {
      result.isValid = false;
      result.errors.push('Missing version line (v=)');
    }

    if (!lines.some(line => line.startsWith('o='))) {
      result.isValid = false;
      result.errors.push('Missing origin line (o=)');
    }

    if (!lines.some(line => line.startsWith('s='))) {
      result.isValid = false;
      result.errors.push('Missing session name line (s=)');
    }

    // Check for audio media line
    const hasAudio = lines.some(line => line.startsWith('m=audio'));
    if (!hasAudio) {
      result.warnings.push('No audio media line found');
    }

    // Check for security (DTLS fingerprint)
    const hasFingerprint = lines.some(line => line.startsWith('a=fingerprint:'));
    if (!hasFingerprint) {
      result.warnings.push('No DTLS fingerprint found - security may be compromised');
    }

    // Check for Opus codec
    const hasOpus = lines.some(line => line.includes('opus/48000'));
    if (!hasOpus) {
      result.optimizations.push('Consider adding Opus codec for better audio quality');
    }

    return result;
  }

  /**
   * Validate and format incoming SDP (for compatibility with existing code)
   */
  static validateAndFormatSDP(offer: any): RTCSessionDescriptionInit {
    let sdpData: RTCSessionDescriptionInit;

    // Handle different input formats
    if (typeof offer === 'string') {
      sdpData = {
        type: 'offer',
        sdp: offer
      };
    } else if (offer && typeof offer === 'object') {
      if (offer.sdp && offer.type) {
        sdpData = offer;
      } else if (offer.offer && offer.offer.sdp) {
        sdpData = offer.offer;
      } else {
        throw new Error('Invalid SDP format');
      }
    } else {
      throw new Error('Invalid SDP input');
    }

    // Validate the SDP
    const validation = this.validateSDP(sdpData);
    if (!validation.isValid) {
      throw new Error(`SDP validation failed: ${validation.errors.join(', ')}`);
    }

    // Log warnings and optimizations
    if (validation.warnings.length > 0) {
      console.warn('SDP validation warnings:', validation.warnings);
    }
    if (validation.optimizations.length > 0) {
      console.info('SDP optimization suggestions:', validation.optimizations);
    }

    return sdpData;
  }
}
