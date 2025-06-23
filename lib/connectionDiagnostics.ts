/**
 * WebRTC Connection Diagnostics and Repair System
 * Identifies and fixes connection issues between guide and attendees
 */

import { getRedisClient } from './redis';
import { normalizeLanguageForStorage } from './languageUtils';

export interface DiagnosticResult {
  timestamp: string;
  tourId: string;
  language: string;
  issues: string[];
  fixes: string[];
  redisKeys: {
    offer: { key: string; exists: boolean; data?: any };
    answers: { key: string; exists: boolean; count: number; data?: any[] };
    guideStatus: { key: string; exists: boolean; data?: any };
    iceGuide: { key: string; exists: boolean; count: number };
    iceAttendee: { key: string; exists: boolean; count: number };
  };
  recommendations: string[];
}

export class ConnectionDiagnostics {
  private redis: any;

  constructor() {
    this.redis = null;
  }

  async initialize(): Promise<void> {
    this.redis = await getRedisClient();
    if (!this.redis) {
      throw new Error('Failed to connect to Redis for diagnostics');
    }
  }

  async diagnoseConnection(tourId: string, language: string, attendeeId?: string): Promise<DiagnosticResult> {
    if (!this.redis) {
      await this.initialize();
    }

    const normalizedLanguage = normalizeLanguageForStorage(language);
    const timestamp = new Date().toISOString();
    const issues: string[] = [];
    const fixes: string[] = [];
    const recommendations: string[] = [];

    console.log(`🔍 [DIAGNOSTICS] Starting connection diagnosis for tour ${tourId}, language ${language} (normalized: ${normalizedLanguage})`);

    // Check all Redis keys
    const redisKeys = await this.checkRedisKeys(tourId, normalizedLanguage, attendeeId);

    // Analyze offer availability
    if (!redisKeys.offer.exists) {
      issues.push('No WebRTC offer found - guide has not started broadcasting');
      recommendations.push('Guide must start the tour and begin broadcasting before attendees can join');
    } else {
      fixes.push('WebRTC offer is available');
    }

    // Analyze guide status
    if (!redisKeys.guideStatus.exists) {
      issues.push('No guide status found - guide readiness unknown');
      recommendations.push('Guide should update status when starting/stopping broadcast');
    } else {
      const status = redisKeys.guideStatus.data;
      if (status?.status !== 'broadcasting') {
        issues.push(`Guide status is "${status?.status}" instead of "broadcasting"`);
        recommendations.push('Guide should be in "broadcasting" status for attendees to connect');
      } else {
        fixes.push('Guide status is "broadcasting"');
      }
    }

    // Analyze answers
    if (redisKeys.answers.count === 0) {
      issues.push('No attendee answers found - no attendees have joined');
      recommendations.push('Attendees need to join the tour to establish connections');
    } else {
      fixes.push(`Found ${redisKeys.answers.count} attendee answers`);
      
      // Check for specific attendee if provided
      if (attendeeId && redisKeys.answers.data) {
        const attendeeAnswer = redisKeys.answers.data.find((answer: any) => {
          try {
            const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
            return parsed.attendeeId === attendeeId;
          } catch {
            return false;
          }
        });
        
        if (!attendeeAnswer) {
          issues.push(`No answer found for specific attendee ${attendeeId}`);
        } else {
          fixes.push(`Answer found for attendee ${attendeeId}`);
        }
      }
    }

    // Analyze ICE candidates
    if (attendeeId) {
      if (redisKeys.iceGuide.count === 0) {
        issues.push(`No guide ICE candidates found for attendee ${attendeeId}`);
        recommendations.push('Guide should generate ICE candidates when processing attendee answers');
      } else {
        fixes.push(`Found ${redisKeys.iceGuide.count} guide ICE candidates`);
      }

      if (redisKeys.iceAttendee.count === 0) {
        issues.push(`No attendee ICE candidates found for attendee ${attendeeId}`);
        recommendations.push('Attendee should generate ICE candidates after creating answer');
      } else {
        fixes.push(`Found ${redisKeys.iceAttendee.count} attendee ICE candidates`);
      }
    }

    return {
      timestamp,
      tourId,
      language: normalizedLanguage,
      issues,
      fixes,
      redisKeys,
      recommendations
    };
  }

  private async checkRedisKeys(tourId: string, normalizedLanguage: string, attendeeId?: string) {
    // Offer key
    const offerKey = `tour:${tourId}:offer:${normalizedLanguage}`;
    const offerExists = await this.redis.exists(offerKey);
    let offerData = null;
    if (offerExists) {
      const offerJson = await this.redis.get(offerKey);
      try {
        offerData = JSON.parse(offerJson);
      } catch {
        offerData = offerJson;
      }
    }

    // Answers key
    const answersKey = `tour:${tourId}:${normalizedLanguage}:answers`;
    const answersExists = await this.redis.exists(answersKey);
    let answersData = [];
    let answersCount = 0;
    if (answersExists) {
      answersData = await this.redis.lrange(answersKey, 0, -1);
      answersCount = answersData.length;
    }

    // Guide status key
    const guideStatusKey = `tour:${tourId}:guide_status`;
    const guideStatusExists = await this.redis.exists(guideStatusKey);
    let guideStatusData = null;
    if (guideStatusExists) {
      const statusJson = await this.redis.get(guideStatusKey);
      try {
        guideStatusData = JSON.parse(statusJson);
      } catch {
        guideStatusData = statusJson;
      }
    }

    // ICE candidate keys (if attendeeId provided)
    let iceGuideCount = 0;
    let iceAttendeeCount = 0;
    let iceGuideExists = false;
    let iceAttendeeExists = false;

    if (attendeeId) {
      const iceGuideKey = `ice:guide:${tourId}:${attendeeId}:${normalizedLanguage}`;
      const iceAttendeeKey = `ice:attendee:${tourId}:${attendeeId}:${normalizedLanguage}`;
      
      iceGuideExists = await this.redis.exists(iceGuideKey);
      iceAttendeeExists = await this.redis.exists(iceAttendeeKey);
      
      if (iceGuideExists) {
        iceGuideCount = await this.redis.llen(iceGuideKey);
      }
      
      if (iceAttendeeExists) {
        iceAttendeeCount = await this.redis.llen(iceAttendeeKey);
      }
    }

    return {
      offer: { key: offerKey, exists: offerExists, data: offerData },
      answers: { key: answersKey, exists: answersExists, count: answersCount, data: answersData },
      guideStatus: { key: guideStatusKey, exists: guideStatusExists, data: guideStatusData },
      iceGuide: { key: `ice:guide:${tourId}:${attendeeId}:${normalizedLanguage}`, exists: iceGuideExists, count: iceGuideCount },
      iceAttendee: { key: `ice:attendee:${tourId}:${attendeeId}:${normalizedLanguage}`, exists: iceAttendeeExists, count: iceAttendeeCount }
    };
  }

  async repairConnection(tourId: string, language: string, attendeeId?: string): Promise<string[]> {
    const diagnostic = await this.diagnoseConnection(tourId, language, attendeeId);
    const repairs: string[] = [];

    console.log(`🔧 [REPAIR] Starting connection repair for tour ${tourId}, language ${language}`);

    // Repair 1: Clean up stale data
    if (diagnostic.redisKeys.answers.count > 0 && diagnostic.redisKeys.iceGuide.count === 0) {
      console.log(`🔧 [REPAIR] Found answers but no guide ICE candidates - cleaning up stale answers`);
      await this.redis.del(diagnostic.redisKeys.answers.key);
      repairs.push('Cleaned up stale attendee answers');
    }

    // Repair 2: Reset guide status if inconsistent
    if (diagnostic.redisKeys.guideStatus.exists && diagnostic.redisKeys.guideStatus.data?.status !== 'broadcasting') {
      if (diagnostic.redisKeys.offer.exists) {
        console.log(`🔧 [REPAIR] Offer exists but guide status is not broadcasting - updating status`);
        const statusData = {
          status: 'broadcasting',
          language: diagnostic.language,
          timestamp: Date.now(),
          repaired: true
        };
        await this.redis.set(diagnostic.redisKeys.guideStatus.key, JSON.stringify(statusData), 'EX', 3600);
        repairs.push('Updated guide status to broadcasting');
      }
    }

    // Repair 3: Clean up excessive ICE candidates
    if (attendeeId) {
      if (diagnostic.redisKeys.iceGuide.count > 20) {
        console.log(`🔧 [REPAIR] Too many guide ICE candidates (${diagnostic.redisKeys.iceGuide.count}) - trimming to last 10`);
        await this.redis.ltrim(diagnostic.redisKeys.iceGuide.key, -10, -1);
        repairs.push('Trimmed excessive guide ICE candidates');
      }

      if (diagnostic.redisKeys.iceAttendee.count > 20) {
        console.log(`🔧 [REPAIR] Too many attendee ICE candidates (${diagnostic.redisKeys.iceAttendee.count}) - trimming to last 10`);
        await this.redis.ltrim(diagnostic.redisKeys.iceAttendee.key, -10, -1);
        repairs.push('Trimmed excessive attendee ICE candidates');
      }
    }

    return repairs;
  }

  async generateReport(tourId: string, language: string, attendeeId?: string): Promise<void> {
    const diagnostic = await this.diagnoseConnection(tourId, language, attendeeId);
    
    console.log('\n🔍 ===== CONNECTION DIAGNOSTIC REPORT =====');
    console.log(`📊 Tour: ${diagnostic.tourId}`);
    console.log(`🌐 Language: ${diagnostic.language}`);
    console.log(`👤 Attendee: ${attendeeId || 'All'}`);
    console.log(`⏰ Timestamp: ${diagnostic.timestamp}`);
    
    console.log('\n✅ WORKING COMPONENTS:');
    diagnostic.fixes.forEach(fix => console.log(`  ✓ ${fix}`));
    
    console.log('\n❌ ISSUES FOUND:');
    diagnostic.issues.forEach(issue => console.log(`  ✗ ${issue}`));
    
    console.log('\n💡 RECOMMENDATIONS:');
    diagnostic.recommendations.forEach(rec => console.log(`  → ${rec}`));
    
    console.log('\n🔑 REDIS KEY STATUS:');
    Object.entries(diagnostic.redisKeys).forEach(([keyType, keyInfo]) => {
      const status = keyInfo.exists ? '✓' : '✗';
      const extra = 'count' in keyInfo && keyInfo.count !== undefined ? ` (${keyInfo.count} items)` : '';
      console.log(`  ${status} ${keyType}: ${keyInfo.key}${extra}`);
    });
    
    console.log('\n==========================================\n');
  }
}

// Global diagnostics instance
let diagnostics: ConnectionDiagnostics | null = null;

export async function runConnectionDiagnostics(tourId: string, language: string, attendeeId?: string): Promise<DiagnosticResult> {
  if (!diagnostics) {
    diagnostics = new ConnectionDiagnostics();
  }
  
  const result = await diagnostics.diagnoseConnection(tourId, language, attendeeId);
  await diagnostics.generateReport(tourId, language, attendeeId);
  
  return result;
}

export async function repairConnection(tourId: string, language: string, attendeeId?: string): Promise<string[]> {
  if (!diagnostics) {
    diagnostics = new ConnectionDiagnostics();
  }
  
  return await diagnostics.repairConnection(tourId, language, attendeeId);
}
