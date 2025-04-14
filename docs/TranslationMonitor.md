# Translation Monitor

A diagnostic tool for monitoring WebRTC audio translation in real-time.

## Purpose

The Translation Monitor allows guides to hear their own voice after it has been translated by OpenAI, helping to diagnose audio capture and translation issues. This tool is invaluable for troubleshooting audio problems in the WebRTC pipeline.

## Features

- **Real-time Audio Playback**: Hear the translated audio as it's received from OpenAI
- **Audio Level Visualization**: See visual indicators of audio activity
- **Language Identification**: Shows which language is being monitored
- **Volume Control**: Adjust the monitoring volume without affecting the main audio
- **Toggle Controls**: Enable/disable monitoring without removing the tool
- **Browser Compatibility Detection**: Automatically checks if the browser supports the required APIs

## How It Works

1. The monitor creates a clone of the audio track received from OpenAI
2. This clone is connected to a separate audio element for playback
3. The Web Audio API is used to analyze audio levels and provide visual feedback
4. All of this happens without interfering with the main WebRTC connection

## Technical Details

### Browser Requirements

- Web Audio API support
- MediaStream API support
- getUserMedia API support

### Implementation

The monitor is implemented as a standalone module with a simple API:

```typescript
// Initialize the monitor
TranslationMonitor.initialize();

// Monitor an audio track
TranslationMonitor.monitorTrack(audioTrack, language);

// Toggle monitoring on/off
TranslationMonitor.toggleMonitor();

// Stop monitoring
TranslationMonitor.stopMonitoring();

// Clean up all resources
TranslationMonitor.cleanup();

// Check if the browser supports the monitor
const isSupported = TranslationMonitor.isSupported();
```

### Integration

The monitor is designed to be easily integrated with existing WebRTC code. See the [Integration Guide](./TranslationMonitorIntegration.md) for detailed instructions.

## Testing

A test page is provided at `/monitor-test` to verify that the monitor works correctly without modifying the main application code.

## Development vs. Production

The monitor is intended for development and debugging only. It should be disabled or removed in production builds. The integration helpers automatically check for the `NODE_ENV` environment variable and only enable the monitor in development mode.

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

If the monitor doesn't work in your browser:

1. Check if your browser supports the Web Audio API and MediaStream API
2. Try using a different browser (Chrome, Firefox, or Edge are recommended)
3. Check the browser console for error messages

## Removal

When you no longer need the Translation Monitor:

1. Remove all integration code from your application
2. Delete the following files:
   - `lib/translationMonitor.ts`
   - `lib/translationMonitorIntegration.ts`
   - `docs/TranslationMonitor.md`
   - `docs/TranslationMonitorIntegration.md`
   - `pages/monitor-test.tsx`
