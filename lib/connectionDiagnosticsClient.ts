/**
 * Client-side WebRTC Connection Diagnostics and Repair System
 * Uses API calls instead of direct Redis access to work in browser environment
 */

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

export interface RepairResult {
  message: string;
  repairs: string[];
  repairCount: number;
}

/**
 * Run connection diagnostics via API call
 * @param tourId The tour ID
 * @param language The language to diagnose
 * @param attendeeId Optional specific attendee ID
 * @returns Diagnostic result
 */
export async function runConnectionDiagnostics(
  tourId: string, 
  language: string, 
  attendeeId?: string
): Promise<DiagnosticResult> {
  try {
    const params = new URLSearchParams({
      tourId,
      language,
    });
    
    if (attendeeId) {
      params.append('attendeeId', attendeeId);
    }

    console.log(`🔍 [DIAGNOSTICS-CLIENT] Running diagnostics for tour ${tourId}, language ${language}`);

    const response = await fetch(`/api/tour/diagnostics?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Diagnostics API error: ${response.status} - ${errorData.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`🔍 [DIAGNOSTICS-CLIENT] Diagnostics completed:`, result);
    
    return result;
  } catch (error) {
    console.error('🔍 [DIAGNOSTICS-CLIENT] Error running diagnostics:', error);
    throw error;
  }
}

/**
 * Run connection repairs via API call
 * @param tourId The tour ID
 * @param language The language to repair
 * @param attendeeId Optional specific attendee ID
 * @returns Repair result
 */
export async function repairConnection(
  tourId: string, 
  language: string, 
  attendeeId?: string
): Promise<string[]> {
  try {
    const requestBody = {
      tourId,
      language,
    };
    
    if (attendeeId) {
      (requestBody as any).attendeeId = attendeeId;
    }

    console.log(`🔧 [REPAIR-CLIENT] Running repairs for tour ${tourId}, language ${language}`);

    const response = await fetch('/api/tour/diagnostics', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Repair API error: ${response.status} - ${errorData.error || response.statusText}`);
    }

    const result: RepairResult = await response.json();
    console.log(`🔧 [REPAIR-CLIENT] Repairs completed:`, result);
    
    return result.repairs;
  } catch (error) {
    console.error('🔧 [REPAIR-CLIENT] Error running repairs:', error);
    throw error;
  }
}

/**
 * Generate a diagnostic report and log it to console
 * @param tourId The tour ID
 * @param language The language to diagnose
 * @param attendeeId Optional specific attendee ID
 */
export async function generateDiagnosticReport(
  tourId: string, 
  language: string, 
  attendeeId?: string
): Promise<void> {
  try {
    const diagnostic = await runConnectionDiagnostics(tourId, language, attendeeId);
    
    console.log('\n🔍 ===== CONNECTION DIAGNOSTIC REPORT =====');
    console.log(`📊 Tour: ${diagnostic.tourId}`);
    console.log(`🌐 Language: ${diagnostic.language}`);
    console.log(`👤 Attendee: ${attendeeId || 'All'}`);
    console.log(`⏰ Timestamp: ${diagnostic.timestamp}`);
    
    console.log('\n✅ WORKING COMPONENTS:');
    if (diagnostic.fixes.length === 0) {
      console.log('  (None detected)');
    } else {
      diagnostic.fixes.forEach(fix => console.log(`  ✓ ${fix}`));
    }
    
    console.log('\n❌ ISSUES FOUND:');
    if (diagnostic.issues.length === 0) {
      console.log('  (No issues detected)');
    } else {
      diagnostic.issues.forEach(issue => console.log(`  ✗ ${issue}`));
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    if (diagnostic.recommendations.length === 0) {
      console.log('  → Connection should work properly');
    } else {
      diagnostic.recommendations.forEach(rec => console.log(`  → ${rec}`));
    }
    
    console.log('\n🔑 REDIS KEYS STATUS:');
    console.log(`  Offer: ${diagnostic.redisKeys.offer.exists ? '✓' : '✗'} (${diagnostic.redisKeys.offer.key})`);
    console.log(`  Answers: ${diagnostic.redisKeys.answers.exists ? '✓' : '✗'} (${diagnostic.redisKeys.answers.count} items) (${diagnostic.redisKeys.answers.key})`);
    console.log(`  Guide Status: ${diagnostic.redisKeys.guideStatus.exists ? '✓' : '✗'} (${diagnostic.redisKeys.guideStatus.key})`);
    console.log(`  ICE Guide: ${diagnostic.redisKeys.iceGuide.exists ? '✓' : '✗'} (${diagnostic.redisKeys.iceGuide.count} items)`);
    console.log(`  ICE Attendee: ${diagnostic.redisKeys.iceAttendee.exists ? '✓' : '✗'} (${diagnostic.redisKeys.iceAttendee.count} items)`);
    
    console.log('\n==========================================\n');
  } catch (error) {
    console.error('🔍 [DIAGNOSTICS-CLIENT] Error generating report:', error);
  }
}

/**
 * Run full diagnostic and repair cycle
 * @param tourId The tour ID
 * @param language The language to diagnose and repair
 * @param attendeeId Optional specific attendee ID
 * @returns Array of applied repairs
 */
export async function diagnoseAndRepair(
  tourId: string, 
  language: string, 
  attendeeId?: string
): Promise<string[]> {
  try {
    console.log(`🔍 [DIAGNOSE-REPAIR] Starting full diagnostic and repair cycle for tour ${tourId}, language ${language}`);
    
    // First run diagnostics
    const diagnostic = await runConnectionDiagnostics(tourId, language, attendeeId);
    
    // Generate report
    await generateDiagnosticReport(tourId, language, attendeeId);
    
    // If issues found, run repairs
    if (diagnostic.issues.length > 0) {
      console.log(`🔧 [DIAGNOSE-REPAIR] ${diagnostic.issues.length} issues detected, running repairs...`);
      const repairs = await repairConnection(tourId, language, attendeeId);
      
      if (repairs.length > 0) {
        console.log('🔧 [DIAGNOSE-REPAIR] Applied repairs:');
        repairs.forEach(repair => console.log(`  ✓ ${repair}`));
        
        // Re-run diagnostics to see if issues were fixed
        console.log('🔍 [DIAGNOSE-REPAIR] Re-running diagnostics after repairs...');
        await generateDiagnosticReport(tourId, language, attendeeId);
      } else {
        console.log('ℹ️ [DIAGNOSE-REPAIR] No repairs were needed or applied');
      }
      
      return repairs;
    } else {
      console.log('✅ [DIAGNOSE-REPAIR] No issues detected, no repairs needed');
      return [];
    }
  } catch (error) {
    console.error('🔍 [DIAGNOSE-REPAIR] Error in diagnostic and repair cycle:', error);
    throw error;
  }
}

/**
 * Quick connection health check
 * @param tourId The tour ID
 * @param language The language to check
 * @returns Boolean indicating if connection appears healthy
 */
export async function isConnectionHealthy(
  tourId: string, 
  language: string
): Promise<boolean> {
  try {
    const diagnostic = await runConnectionDiagnostics(tourId, language);
    
    // Connection is considered healthy if:
    // 1. Offer exists
    // 2. No critical issues
    const hasOffer = diagnostic.redisKeys.offer.exists;
    const hasCriticalIssues = diagnostic.issues.some(issue => 
      issue.includes('No WebRTC offer') || 
      issue.includes('guide has not started broadcasting')
    );
    
    const isHealthy = hasOffer && !hasCriticalIssues;
    
    console.log(`🏥 [HEALTH-CHECK] Connection health for tour ${tourId}, language ${language}: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    
    return isHealthy;
  } catch (error) {
    console.error('🏥 [HEALTH-CHECK] Error checking connection health:', error);
    return false;
  }
}
