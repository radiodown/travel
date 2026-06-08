import type { ItineraryDay } from '../data/itinerary';

type Props = {
  days: ItineraryDay[];
};

export default function FlowOverview({ days }: Props) {
  return (
    <div className="flow-grid">
      {days.map((day) => (
        <article key={day.day} className="flow-card">
          <h3>{day.day}</h3>
          <p className="flow-date">{day.date}</p>
          <p>{day.title}</p>
          <p className="flow-summary">{day.summary}</p>
        </article>
      ))}
    </div>
  );
}
