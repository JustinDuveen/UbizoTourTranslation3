interface AttendeeListProps {
  attendees: string[]
}

export default function AttendeeList({ attendees }: AttendeeListProps) {
  return (
    <div className="mt-4">
      <h2 className="text-xl font-semibold mb-2">Attendees</h2>
      <ul className="list-disc pl-5">
        {attendees.map((attendee, index) => (
          <li key={index}>{attendee}</li>
        ))}
      </ul>
    </div>
  )
}

