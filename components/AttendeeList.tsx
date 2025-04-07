interface Attendee {
  id: string;
  name: string;
  language: string;
  joinTime: string;
}

interface AttendeeListProps {
  attendees: Attendee[];
  onKickAttendee?: (attendeeId: string) => void;
}

export default function AttendeeList({ attendees, onKickAttendee }: AttendeeListProps) {
  // Group attendees by language
  const attendeesByLanguage = attendees.reduce((acc, attendee) => {
    if (!acc[attendee.language]) {
      acc[attendee.language] = [];
    }
    acc[attendee.language].push(attendee);
    return acc;
  }, {} as Record<string, Attendee[]>);

  return (
    <div className="mt-4 space-y-4">
      <h2 className="text-xl font-semibold mb-4">Attendees ({attendees.length})</h2>
      
      {Object.entries(attendeesByLanguage).map(([language, languageAttendees]) => (
        <div key={language} className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <h3 className="text-lg font-medium mb-2 flex items-center justify-between">
            <span>{language.charAt(0).toUpperCase() + language.slice(1)}</span>
            <span className="text-sm text-gray-500">({languageAttendees.length})</span>
          </h3>
          
          <ul className="space-y-2">
            {languageAttendees.map((attendee) => (
              <li 
                key={attendee.id} 
                className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700 rounded"
              >
                <div>
                  <span className="font-medium">{attendee.name}</span>
                  <span className="text-sm text-gray-500 ml-2">
                    {new Date(attendee.joinTime).toLocaleTimeString()}
                  </span>
                </div>
                
                {onKickAttendee && (
                  <button
                    onClick={() => onKickAttendee(attendee.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      
      {attendees.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          No attendees have joined yet
        </div>
      )}
    </div>
  );
}
