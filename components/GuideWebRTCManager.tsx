import React, { useState, useEffect, useCallback } from 'react';
import { initGuideWebRTC, cleanupGuideWebRTC } from '@/lib/guideWebRTC';
import AttendeeList from './AttendeeList';
import { getRedisClient } from '@/lib/redis';

interface Attendee {
  id: string;
  name: string;
  language: string;
  joinTime: string;
}

interface GuideWebRTCManagerProps {
  tourId: string;
  language: string;
  setTranslation: (translation: string) => void;
}

function GuideWebRTCManager({ tourId, language, setTranslation }: GuideWebRTCManagerProps) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all attendees for the tour
  const fetchAttendees = useCallback(async () => {
    try {
      const redis = await getRedisClient();
      
      // Get all attendee IDs
      const attendeeIds = await redis.sMembers(`tour:${tourId}:attendees`);
      
      // Fetch details for each attendee
      const attendeeDetails = await Promise.all(
        attendeeIds.map(async (id: string) => {
          const details = await redis.hGetAll(`tour:${tourId}:attendee:${id}`);
          return {
            id,
            name: details.name,
            language: details.language,
            joinTime: details.joinTime
          };
        })
      );

      setAttendees(attendeeDetails);
      setIsLoading(false);
    } catch (error) {
      console.error('Error fetching attendees:', error);
      setIsLoading(false);
    }
  }, [tourId]);

  // Handle attendee removal
  const handleKickAttendee = useCallback(async (attendeeId: string) => {
    try {
      const redis = await getRedisClient();
      const attendee = attendees.find(a => a.id === attendeeId);
      
      if (attendee) {
        // Remove from all relevant Redis sets
        await Promise.all([
          redis.sRem(`tour:${tourId}:attendees`, attendeeId),
          redis.sRem(`tour:${tourId}:language:${attendee.language}:attendees`, attendeeId),
          redis.del(`tour:${tourId}:attendee:${attendeeId}`)
        ]);

        // Publish kick event
        await redis.publish(`tour:${tourId}:events`, JSON.stringify({
          type: 'attendee_kicked',
          attendeeId,
          language: attendee.language
        }));

        // Update local state
        setAttendees(prev => prev.filter(a => a.id !== attendeeId));
      }
    } catch (error) {
      console.error('Error kicking attendee:', error);
    }
  }, [tourId, attendees]);

  // Set up WebRTC and event listeners
  useEffect(() => {
    let eventSource: EventSource | null = null;

    const setupEventSource = () => {
      eventSource = new EventSource(`/api/tour/events?tourId=${tourId}`);
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'attendee_joined':
            setAttendees(prev => [...prev, data.attendee]);
            break;
            
          case 'attendee_left':
            setAttendees(prev => prev.filter(a => a.id !== data.attendeeId));
            break;
            
          case 'language_added':
          case 'language_removed':
            // Refresh attendee list to get updated language information
            fetchAttendees();
            break;
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource?.close();
        // Attempt to reconnect after a delay
        setTimeout(setupEventSource, 5000);
      };
    };

    // Initialize with wrapper for attendee updates
    const handleAttendeeUpdate = (attendeeIds: string[]) => {
      // Convert string IDs to Attendee objects with placeholder data
      const attendeeObjects = attendeeIds.map(id => ({
        id,
        name: 'Loading...',
        language: 'unknown',
        joinTime: new Date().toISOString()
      }));
      setAttendees(attendeeObjects);
      // Fetch full details
      fetchAttendees();
    };

    initGuideWebRTC(setTranslation, language, handleAttendeeUpdate, tourId);
    fetchAttendees();
    setupEventSource();

    // Cleanup
    return () => {
      cleanupGuideWebRTC();
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [tourId, language, setTranslation, fetchAttendees]);

  if (isLoading) {
    return <div className="text-center py-8">Loading attendees...</div>;
  }

  return (
    <div className="space-y-6">
      <AttendeeList 
        attendees={attendees}
        onKickAttendee={handleKickAttendee}
      />
    </div>
  );
}

export default GuideWebRTCManager;
