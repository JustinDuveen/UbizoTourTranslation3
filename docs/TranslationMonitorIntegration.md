# Translation Monitor Integration Guide

This guide explains how to integrate the Translation Monitor with your existing WebRTC code to help diagnose audio issues.

## Overview

The Translation Monitor allows guides to hear their own voice after it has been translated by OpenAI, helping to diagnose audio capture and translation issues. It provides:

- Real-time audio playback of the translated audio
- Visual indicators of audio levels
- Language identification
- Easy toggle controls

## Integration Steps

### Step 1: Import the Integration Helper

In `guideWebRTC.ts`, add the following import at the top of the file:

```typescript
import { initializeMonitor, enhanceOnTrackHandler, cleanupMonitor } from './translationMonitorIntegration';
```

### Step 2: Initialize the Monitor

In the `initGuideWebRTC` function, add the following line near the beginning:

```typescript
// Initialize the translation monitor (development only)
initializeMonitor();
```

### Step 3: Enhance the ontrack Handler

In the `setupOpenAIConnection` function, find where the `openaiPC.ontrack` handler is defined and modify it as follows:

```typescript
// Store the original handler
const originalOnTrackHandler = (event: RTCTrackEvent) => {
  // Original handler code...
  if (event.track.kind === 'audio') {
    // Existing audio track handling...
  }
};

// Replace with enhanced handler
openaiPC.ontrack = enhanceOnTrackHandler(originalOnTrackHandler, language);
```

### Step 4: Add Cleanup

In the `cleanupGuideWebRTC` function, add the following line:

```typescript
// Clean up the translation monitor
cleanupMonitor();
```

### Step 5 (Optional): Add UI Button

If you want to add a button to toggle the monitor in the guide's UI, you can add this to your React component:

```tsx
import { addMonitorButton } from '../lib/translationMonitorIntegration';
import { useRef, useEffect } from 'react';

function GuideControls() {
  const controlsRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (controlsRef.current) {
      addMonitorButton(controlsRef.current);
    }
  }, []);
  
  return (
    <div ref={controlsRef} className="guide-controls">
      {/* Existing controls */}
    </div>
  );
}
```

## Enabling and Disabling the Monitor

The Translation Monitor is designed to be inactive by default, even in development environments, to prevent accidental activation. To enable it:

1.  **Production Environments**: The monitor is **always disabled** in production environments (`process.env.NODE_ENV === 'production'`) and cannot be activated.
2.  **Development/Other Environments**:
    *   The monitor will only activate if `process.env.NODE_ENV !== 'production'`.
    *   **AND** you explicitly enable it by setting the environment variable `NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR` to `'true'`.
    *   You can do this by creating or modifying a `.env.local` file in the root of your project and adding the line:
        ```
        NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR=true
        ```
    *   Remember to restart your development server after changing environment variables.

If `NEXT_PUBLIC_ENABLE_TRANSLATION_MONITOR` is not set to `'true'`, or if you are in a production environment, the monitor integration functions will log messages indicating why they are skipped and will not initialize or affect the application.

## Removal Process

When you no longer need the Translation Monitor:

1. Remove all the integration code added in steps 1-5
2. Delete the following files:
   - `lib/translationMonitor.ts`
   - `lib/translationMonitorIntegration.ts`
   - `docs/TranslationMonitorIntegration.md`

## Troubleshooting

### Audio Not Playing

If the monitor shows that audio is being received but you can't hear anything:

1. Check if your browser is blocking autoplay
2. Click on the monitor to enable audio
3. Increase the volume using the slider
4. Make sure your system volume is turned up

### High CPU Usage

If you notice high CPU usage:

1. Disable the monitor when not in use
2. Close the monitor completely when finished debugging

### Browser Compatibility

The monitor requires:
- Web Audio API support
- MediaStream API support

Most modern browsers (Chrome, Firefox, Edge) support these APIs.
