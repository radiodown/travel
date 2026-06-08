import { useEffect, useState } from 'react';
import itinerary, { type ItineraryDay } from './data/itinerary';
import MainPage from './pages/MainPage';
import SchedulePage from './pages/SchedulePage';
import { parseItineraryJson, serializeItinerary } from './utils/itineraryJson';

type Page = 'main' | 'schedule';

const ITINERARY_STORAGE_KEY = 'travel-itinerary-days';

function getInitialDays() {
  if (typeof window === 'undefined') {
    return itinerary.days;
  }

  const saved = window.localStorage.getItem(ITINERARY_STORAGE_KEY);
  if (!saved) {
    return itinerary.days;
  }

  try {
    return parseItineraryJson(saved);
  } catch {
    return itinerary.days;
  }
}

function App() {
  const [page, setPage] = useState<Page>('main');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [days, setDays] = useState<ItineraryDay[]>(() => getInitialDays());

  useEffect(() => {
    if (days.length === 0) {
      setSelectedDayIndex(0);
      return;
    }

    if (selectedDayIndex >= days.length) {
      setSelectedDayIndex(days.length - 1);
    }
  }, [days.length, selectedDayIndex]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(ITINERARY_STORAGE_KEY, serializeItinerary(days));
  }, [days]);

  if (page === 'schedule') {
    return (
      <SchedulePage
        days={days}
        setDays={setDays}
        selectedDayIndex={selectedDayIndex}
        onSelectDay={setSelectedDayIndex}
        onBack={() => setPage('main')}
      />
    );
  }

  return <MainPage onViewSchedule={() => setPage('schedule')} />;
}

export default App;
