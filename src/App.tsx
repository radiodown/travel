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
    if (typeof window === 'undefined') {
      return;
    }

    const root = document.documentElement;
    let frame = 0;

    const updateViewportMetrics = () => {
      frame = 0;
      const viewport = window.visualViewport;
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const viewportHeight = viewport?.height ?? layoutHeight;
      const viewportOffsetTop = viewport?.offsetTop ?? 0;
      const bottomOverlay = Math.max(0, layoutHeight - (viewportHeight + viewportOffsetTop));

      root.style.setProperty('--app-height', `${Math.round(layoutHeight)}px`);
      root.style.setProperty('--viewport-bottom-offset', `${Math.round(bottomOverlay)}px`);
    };

    const scheduleViewportUpdate = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(updateViewportMetrics);
    };

    scheduleViewportUpdate();

    const viewport = window.visualViewport;
    window.addEventListener('resize', scheduleViewportUpdate);
    window.addEventListener('orientationchange', scheduleViewportUpdate);
    viewport?.addEventListener('resize', scheduleViewportUpdate);
    viewport?.addEventListener('scroll', scheduleViewportUpdate);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('resize', scheduleViewportUpdate);
      window.removeEventListener('orientationchange', scheduleViewportUpdate);
      viewport?.removeEventListener('resize', scheduleViewportUpdate);
      viewport?.removeEventListener('scroll', scheduleViewportUpdate);
    };
  }, []);

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
