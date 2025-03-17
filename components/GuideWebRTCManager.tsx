// GuideWebRTCManager.tsx

import React, { useState, useEffect } from 'react';
import AttendeeList from './AttendeeList'; // Import your AttendeeList component
import { initGuideWebRTC, cleanupGuideWebRTC, allAttendees } from '@/lib/guideWebRTC'; // Import your WebRTC functions and allAttendees
// ... (Your interfaces and WebRTC logic from the provided code) ...

function GuideWebRTCManager({ tourId, language, setTranslation }: { tourId: string; language: string; setTranslation: (translation: string) => void; }) {
  const [attendees, setAttendees] = useState<string[]>([]);
  const [hasAttendees, setHasAttendees] = useState<boolean>(false);
  const [attendeesByLanguage, setAttendeesByLanguage] = useState<Record<string, string[]>>({});

  useEffect(() => {
    initGuideWebRTC(setTranslation, language, setAttendees, tourId);

    return () => {
      cleanupGuideWebRTC();
    };
  }, [tourId, language, setTranslation]);

  // Function to update attendee-related state
  const updateAttendeeState = (attendeeIds: string[]) => {
    setAttendees(attendeeIds); // Update the attendee list

    // Update hasAttendees state
    setHasAttendees(attendeeIds.length > 0);

    // Group attendees by language
    const attendeesByLanguage = attendeeIds.reduce((acc, attendeeId) => {
      const language = allAttendees.get(attendeeId) || 'unknown';

      if (!acc[language]) {
        acc[language] = [];
      }

      acc[language].push(attendeeId);
      return acc;
    }, {} as Record<string, string[]>);

    setAttendeesByLanguage(attendeesByLanguage); // Update grouped attendees

    console.log(`UI updated with ${attendeeIds.length} attendees`);
  };

  return (
    <div>
      <AttendeeList attendees={attendees} />
      {/* Other UI elements as needed */}
      {/* Example UI elements using other state variables */}
      {hasAttendees && <div>Attendees are present.</div>}
      {Object.entries(attendeesByLanguage).map(([language, ids]) => (
        <div key={language}>
          {language}: {ids.join(', ')}
        </div>
      ))}
    </div>
  );
}

export default GuideWebRTCManager;
