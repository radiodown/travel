// Free weather via Open-Meteo (no API key required).
// https://open-meteo.com/

export type HalfDayWeather = {
  icon: string;
  temp: number | null;
};

export type DayWeather = {
  am: HalfDayWeather;
  pm: HalfDayWeather;
};

// WMO weather interpretation codes → emoji
// https://open-meteo.com/en/docs#weathervariables
const WMO_ICON: Record<number, string> = {
  0: '☀️', // clear sky
  1: '🌤️', // mainly clear
  2: '⛅', // partly cloudy
  3: '☁️', // overcast
  45: '🌫️',
  48: '🌫️', // fog
  51: '🌦️',
  53: '🌦️',
  55: '🌦️', // drizzle
  56: '🌧️',
  57: '🌧️', // freezing drizzle
  61: '🌧️',
  63: '🌧️',
  65: '🌧️', // rain
  66: '🌧️',
  67: '🌧️', // freezing rain
  71: '🌨️',
  73: '🌨️',
  75: '🌨️',
  77: '🌨️', // snow
  80: '🌦️',
  81: '🌧️',
  82: '⛈️', // rain showers
  85: '🌨️',
  86: '🌨️', // snow showers
  95: '⛈️',
  96: '⛈️',
  99: '⛈️', // thunderstorm
};

export function iconForCode(code: number): string {
  return WMO_ICON[code] ?? '🌡️';
}

type GeocodeResponse = {
  results?: { latitude: number; longitude: number }[];
};

/**
 * Resolve a city name to coordinates via Open-Meteo's free geocoding API
 * (no API key required). Returns null when the city can't be found.
 */
export async function geocodeCity(
  name: string,
  signal?: AbortSignal
): Promise<[number, number] | null> {
  const query = name.trim();
  if (!query) return null;

  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=1&language=ko&format=json`;

  const res = await fetch(url, { signal });
  if (!res.ok) return null;

  const data: GeocodeResponse = await res.json();
  const hit = data.results?.[0];
  if (!hit) return null;

  return [hit.latitude, hit.longitude];
}

type OpenMeteoResponse = {
  hourly?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m?: number[];
  };
};

/**
 * Fetch a simple AM/PM weather summary for one day at a location.
 * Picks 09:00 as the morning sample and 15:00 as the afternoon sample.
 * Returns null when the date is outside the forecast range (~16 days)
 * or the request fails.
 */
export async function fetchDayWeather(
  lat: number,
  lng: number,
  date: string,
  signal?: AbortSignal
): Promise<DayWeather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=weather_code,temperature_2m&timezone=auto` +
    `&start_date=${date}&end_date=${date}`;

  const res = await fetch(url, { signal });
  if (!res.ok) return null;

  const data: OpenMeteoResponse = await res.json();
  const times = data.hourly?.time ?? [];
  const codes = data.hourly?.weather_code ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  if (!times.length) return null;

  const sampleAt = (hour: string): HalfDayWeather | null => {
    const idx = times.findIndex((t) => t.endsWith(`T${hour}`));
    if (idx === -1) return null;
    return {
      icon: iconForCode(codes[idx] ?? -1),
      temp: typeof temps[idx] === 'number' ? Math.round(temps[idx]) : null,
    };
  };

  const am = sampleAt('09:00');
  const pm = sampleAt('15:00');
  if (!am || !pm) return null;

  return { am, pm };
}
