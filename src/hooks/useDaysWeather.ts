import { useEffect, useState } from 'react';
import type { ItineraryDay } from '../data/itinerary';
import { fetchDayWeather, type DayWeather } from '../utils/weather';

// Use the day's explicit city if set, otherwise fall back to the first
// event that has coordinates.
function weatherCoordinate(day: ItineraryDay): [number, number] | null {
  return day.cityCoordinates ?? day.events.find((e) => e.coordinates)?.coordinates ?? null;
}

/**
 * Fetches an AM/PM weather summary for every day that has coordinates.
 * Re-fetches only when a day's date or first location changes.
 * Returns a map keyed by day index; missing entries simply render no badge.
 */
export function useDaysWeather(days: ItineraryDay[]): Record<number, DayWeather> {
  const [weather, setWeather] = useState<Record<number, DayWeather>>({});

  // Stable signature so we don't refetch on unrelated re-renders.
  const signature = days
    .map((d) => `${d.date ?? ''}@${weatherCoordinate(d)?.join(',') ?? ''}`)
    .join('|');

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        days.map(async (day, index) => {
          const coord = weatherCoordinate(day);
          if (!coord || !day.date) return null;
          try {
            const w = await fetchDayWeather(coord[0], coord[1], day.date, controller.signal);
            return w ? ([index, w] as const) : null;
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;
      const next: Record<number, DayWeather> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setWeather(next);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return weather;
}
