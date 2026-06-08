import type { ItineraryDay } from '../data/itinerary';

type Props = {
  days: ItineraryDay[];
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
};

export default function DayTabs({ days, selectedDayIndex, onSelectDay }: Props) {
  return (
    <div className="tabs">
      {days.map((day, index) => (
        <button
          key={day.day}
          className={index === selectedDayIndex ? 'tab-button selected' : 'tab-button'}
          onClick={() => onSelectDay(index)}
          type="button"
        >
          {day.day}
        </button>
      ))}
    </div>
  );
}
