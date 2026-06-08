import { useState } from 'react';
import itinerary, { type ItineraryDay } from './data/itinerary';
import MainPage from './pages/MainPage';
import SchedulePage from './pages/SchedulePage';

type Page = 'main' | 'schedule';

function App() {
  const [page, setPage] = useState<Page>('main');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [days, setDays] = useState<ItineraryDay[]>(itinerary.days);

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
