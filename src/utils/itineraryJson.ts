import { CATEGORIES, type EventCategory } from '../data/categories';
import type {
  EventAttachment,
  ItineraryDay,
  ItineraryEvent,
  ReservationInfo,
  SavedFlight,
  RouteTransitPreference,
  RouteTravelMode,
  SavedRoute,
  SavedRouteSegment,
  SavedRouteTransfer,
} from '../data/itinerary';

type ItineraryExportPayload = {
  version: 1;
  exportedAt: string;
  days: ItineraryDay[];
};

const VALID_CATEGORIES = new Set<EventCategory>(Object.keys(CATEGORIES) as EventCategory[]);
const VALID_ROUTE_MODES = new Set<RouteTravelMode>([
  'TRANSIT',
  'DRIVING',
  'WALKING',
  'BICYCLING',
]);
const VALID_ROUTE_TRANSFER_TYPES = new Set<SavedRouteTransfer['type']>(['TRANSFER', 'WALK']);
const VALID_TRANSIT_PREFERENCES = new Set<RouteTransitPreference>([
  'FEWER_TRANSFERS',
  'LESS_WALKING',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseAttachment(value: unknown): EventAttachment | undefined {
  if (!isRecord(value)) return undefined;
  if (!isString(value.name) || !isString(value.dataUrl) || !isString(value.type)) return undefined;

  return {
    name: value.name,
    dataUrl: value.dataUrl,
    type: value.type,
  };
}

function parseReservation(value: unknown): ReservationInfo | undefined {
  if (!isRecord(value) || !isString(value.label) || !isString(value.details)) return undefined;

  return {
    label: value.label,
    details: value.details,
  };
}

function parseRouteSegment(value: unknown): SavedRouteSegment | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isString(value.mode) ||
    !VALID_ROUTE_MODES.has(value.mode as RouteTravelMode) ||
    !isString(value.modeLabel) ||
    !isString(value.modeIcon) ||
    !isString(value.durationText) ||
    !isFiniteNumber(value.durationValue) ||
    !isFiniteNumber(value.distanceValue) ||
    !Array.isArray(value.path)
  ) {
    return undefined;
  }

  const path = value.path.filter(isCoordinatePair);
  if (path.length === 0 || path.length !== value.path.length) return undefined;

  const segment: SavedRouteSegment = {
    mode: value.mode as RouteTravelMode,
    modeLabel: value.modeLabel,
    modeIcon: value.modeIcon,
    durationText: value.durationText,
    durationValue: value.durationValue,
    distanceValue: value.distanceValue,
    path,
  };

  if (isString(value.distanceText)) segment.distanceText = value.distanceText;
  if (isString(value.summary)) segment.summary = value.summary;
  if (isString(value.departureStop)) segment.departureStop = value.departureStop;
  if (isString(value.arrivalStop)) segment.arrivalStop = value.arrivalStop;
  if (isString(value.departureTimeText)) segment.departureTimeText = value.departureTimeText;
  if (isString(value.arrivalTimeText)) segment.arrivalTimeText = value.arrivalTimeText;
  if (isFiniteNumber(value.stopCount)) segment.stopCount = value.stopCount;
  if (isString(value.lineColor)) segment.lineColor = value.lineColor;
  if (isString(value.lineTextColor)) segment.lineTextColor = value.lineTextColor;

  return segment;
}

function parseRouteTransfer(value: unknown): SavedRouteTransfer | undefined {
  if (
    !isRecord(value) ||
    !isString(value.type) ||
    !VALID_ROUTE_TRANSFER_TYPES.has(value.type as SavedRouteTransfer['type']) ||
    !isString(value.title)
  ) {
    return undefined;
  }

  const transfer: SavedRouteTransfer = {
    type: value.type as SavedRouteTransfer['type'],
    title: value.title,
  };

  if (isString(value.detail)) transfer.detail = value.detail;

  return transfer;
}

function buildFallbackRouteSegment(route: {
  mode: RouteTravelMode;
  modeLabel: string;
  modeIcon: string;
  durationText: string;
  durationValue: number;
  distanceText: string;
  summary: string;
  path: [number, number][];
}): SavedRouteSegment {
  return {
    mode: route.mode,
    modeLabel: route.modeLabel,
    modeIcon: route.modeIcon,
    durationText: route.durationText,
    durationValue: route.durationValue,
    distanceText: route.distanceText,
    distanceValue: 0,
    summary: route.summary,
    path: route.path,
  };
}

function parseRoute(value: unknown): SavedRoute | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isString(value.mode) ||
    !VALID_ROUTE_MODES.has(value.mode as RouteTravelMode) ||
    !isString(value.modeLabel) ||
    !isString(value.modeIcon) ||
    !isString(value.originTitle) ||
    !isString(value.destinationTitle) ||
    !isString(value.summary) ||
    !isString(value.durationText) ||
    !isFiniteNumber(value.durationValue) ||
    !isString(value.distanceText) ||
    !Array.isArray(value.transitLines) ||
    !Array.isArray(value.path)
  ) {
    return undefined;
  }

  const transitLines = value.transitLines.filter(isString);
  const path = value.path.filter(isCoordinatePair);

  if (transitLines.length !== value.transitLines.length || path.length === 0 || path.length !== value.path.length) {
    return undefined;
  }

  const parsedSegments = Array.isArray(value.segments)
    ? value.segments
        .map(parseRouteSegment)
        .filter((segment): segment is SavedRouteSegment => !!segment)
    : [];
  const segments =
    parsedSegments.length === (Array.isArray(value.segments) ? value.segments.length : 0) &&
    parsedSegments.length > 0
      ? parsedSegments
      : [buildFallbackRouteSegment({
          mode: value.mode as RouteTravelMode,
          modeLabel: value.modeLabel,
          modeIcon: value.modeIcon,
          durationText: value.durationText,
          durationValue: value.durationValue,
          distanceText: value.distanceText,
          summary: value.summary,
          path,
        })];

  const parsedTransfers = Array.isArray(value.transfers)
    ? value.transfers
        .map(parseRouteTransfer)
        .filter((transfer): transfer is SavedRouteTransfer => !!transfer)
    : [];
  const transfers =
    parsedTransfers.length === (Array.isArray(value.transfers) ? value.transfers.length : 0)
      ? parsedTransfers
      : [];

  const transferCount =
    isFiniteNumber(value.transferCount)
      ? value.transferCount
      : Math.max(0, segments.filter((segment) => segment.mode === 'TRANSIT').length - 1);

  const route: SavedRoute = {
    mode: value.mode as RouteTravelMode,
    modeLabel: value.modeLabel,
    modeIcon: value.modeIcon,
    originTitle: value.originTitle,
    destinationTitle: value.destinationTitle,
    summary: value.summary,
    durationText: value.durationText,
    durationValue: value.durationValue,
    distanceText: value.distanceText,
    transferCount,
    transitLines,
    path,
    segments,
    transfers,
  };

  if (isString(value.departureText)) route.departureText = value.departureText;
  if (isString(value.arrivalText)) route.arrivalText = value.arrivalText;
  if (isString(value.walkingDurationText)) route.walkingDurationText = value.walkingDurationText;
  if (isString(value.requestedDepartureTime)) route.requestedDepartureTime = value.requestedDepartureTime;
  if (
    isString(value.transitPreference) &&
    VALID_TRANSIT_PREFERENCES.has(value.transitPreference as RouteTransitPreference)
  ) {
    route.transitPreference = value.transitPreference as RouteTransitPreference;
  }

  return route;
}

function parseFlight(value: unknown): SavedFlight | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isString(value.originTitle) ||
    !isString(value.destinationTitle) ||
    !isCoordinatePair(value.originCoordinates) ||
    !isCoordinatePair(value.destinationCoordinates) ||
    !Array.isArray(value.path) ||
    !isString(value.durationText)
  ) {
    return undefined;
  }

  const path = value.path.filter(isCoordinatePair);
  if (path.length < 2 || path.length !== value.path.length) return undefined;

  const flight: SavedFlight = {
    originTitle: value.originTitle,
    destinationTitle: value.destinationTitle,
    originCoordinates: value.originCoordinates,
    destinationCoordinates: value.destinationCoordinates,
    path,
    durationText: value.durationText,
  };

  if (isString(value.airline)) flight.airline = value.airline;
  if (isString(value.flightNumber)) flight.flightNumber = value.flightNumber;
  if (isString(value.arrivalTimeText)) flight.arrivalTimeText = value.arrivalTimeText;
  if (isString(value.bookingReference)) flight.bookingReference = value.bookingReference;

  return flight;
}

function parseEvent(value: unknown): ItineraryEvent | null {
  if (!isRecord(value) || !isString(value.title)) return null;

  const event: ItineraryEvent = {
    title: value.title,
  };

  if (isString(value.time)) event.time = value.time;
  if (isString(value.description)) event.description = value.description;
  if (isString(value.location)) event.location = value.location;
  if (isString(value.note)) event.note = value.note;
  if (isCoordinatePair(value.coordinates)) event.coordinates = value.coordinates;
  if (isString(value.category) && VALID_CATEGORIES.has(value.category as EventCategory)) {
    event.category = value.category as EventCategory;
  }

  const attachment = parseAttachment(value.attachment);
  if (attachment) event.attachment = attachment;

  const reservation = parseReservation(value.reservation);
  if (reservation) event.reservation = reservation;

  const route = parseRoute(value.route);
  if (route) {
    event.route = route;
    if (!event.category || event.category === 'move') {
      event.category = 'route';
    }
  }

  const flight = parseFlight(value.flight);
  if (flight) {
    event.flight = flight;
    if (!event.category) {
      event.category = 'flight';
    }
  }

  return event;
}

function parseReservations(value: unknown): ItineraryDay['reservations'] {
  if (!Array.isArray(value)) return undefined;

  const reservations = value
    .map((item) => parseReservation(item) ?? null)
    .filter((item): item is NonNullable<ItineraryDay['reservations']>[number] => item !== null);

  return reservations.length > 0 ? reservations : undefined;
}

function parseDay(value: unknown): ItineraryDay | null {
  if (
    !isRecord(value) ||
    !isString(value.day) ||
    !isString(value.title) ||
    !isString(value.date) ||
    !isString(value.summary) ||
    !Array.isArray(value.events)
  ) {
    return null;
  }

  const events = value.events
    .map(parseEvent)
    .filter((event): event is ItineraryEvent => event !== null);

  if (events.length !== value.events.length) {
    return null;
  }

  const day: ItineraryDay = {
    day: value.day,
    title: value.title,
    date: value.date,
    summary: value.summary,
    events,
  };

  if (isString(value.mapHint)) day.mapHint = value.mapHint;
  if (isString(value.city)) day.city = value.city;
  if (isCoordinatePair(value.cityCoordinates)) day.cityCoordinates = value.cityCoordinates;

  const reservations = parseReservations(value.reservations);
  if (reservations) day.reservations = reservations;

  return day;
}

export function serializeItinerary(days: ItineraryDay[]) {
  const payload: ItineraryExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    days,
  };

  return JSON.stringify(payload, null, 2);
}

export function parseItineraryJson(text: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 올바르지 않습니다.');
  }

  const rawDays = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.days)
      ? parsed.days
      : null;

  if (!rawDays || rawDays.length === 0) {
    throw new Error('불러올 일정 데이터가 없습니다.');
  }

  const days = rawDays
    .map(parseDay)
    .filter((day): day is ItineraryDay => day !== null);

  if (days.length !== rawDays.length) {
    throw new Error('지원하지 않는 일정 JSON 형식입니다.');
  }

  return days;
}
