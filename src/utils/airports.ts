type AirportCoordinates = [number, number];

type KnownAirport = {
  code: string;
  names: string[];
  coordinates: AirportCoordinates;
};

const KNOWN_AIRPORTS: KnownAirport[] = [
  {
    code: 'ICN',
    names: ['ICN', 'Incheon', 'Seoul', '\uC778\uCC9C'],
    coordinates: [37.4602, 126.4407],
  },
  {
    code: 'PRG',
    names: ['PRG', 'Prague', 'Praha', 'Vaclav Havel', '\uD504\uB77C\uD558'],
    coordinates: [50.1008, 14.2632],
  },
  {
    code: 'VIE',
    names: ['VIE', 'Vienna', 'Wien', 'Schwechat', '\uBE44\uC5D4\uB098', '\uBE48'],
    coordinates: [48.1103, 16.5697],
  },
  {
    code: 'BUD',
    names: ['BUD', 'Budapest', 'Ferenc Liszt', '\uBD80\uB2E4\uD398\uC2A4\uD2B8'],
    coordinates: [47.4369, 19.2556],
  },
];

const KNOWN_CODES = new Set(KNOWN_AIRPORTS.map((airport) => airport.code));
const COORDINATE_MATCH_KM = 18;

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getDistanceKm(from: AirportCoordinates, to: AirportCoordinates) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRadians(from[0]);
  const lat2 = toRadians(to[0]);
  const deltaLat = toRadians(to[0] - from[0]);
  const deltaLng = toRadians(to[1] - from[1]);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCodeFromText(text: string) {
  const explicitCode = text.match(/\b[A-Z]{3}\b/)?.[0];
  if (explicitCode && KNOWN_CODES.has(explicitCode)) {
    return explicitCode;
  }

  const normalized = normalizeText(text);
  return KNOWN_AIRPORTS.find((airport) =>
    airport.names.some((name) => normalized.includes(normalizeText(name)))
  )?.code;
}

function getCodeFromCoordinates(coordinates?: AirportCoordinates) {
  if (!coordinates) return undefined;

  return KNOWN_AIRPORTS.find(
    (airport) => getDistanceKm(coordinates, airport.coordinates) <= COORDINATE_MATCH_KM
  )?.code;
}

export function getAirportCodeLabel(
  title: string,
  location?: string,
  coordinates?: AirportCoordinates
) {
  const fallback = title.trim() || location?.trim() || '';
  const textCode = getCodeFromText([title, location].filter(Boolean).join(' '));
  return textCode ?? getCodeFromCoordinates(coordinates) ?? fallback;
}
