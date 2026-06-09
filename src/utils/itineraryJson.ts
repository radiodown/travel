import { CATEGORIES, type EventCategory } from '../data/categories';
import type { EventAttachment, ItineraryDay, ItineraryEvent, ReservationInfo } from '../data/itinerary';

type ItineraryExportPayload = {
  version: 1;
  exportedAt: string;
  days: ItineraryDay[];
};

const VALID_CATEGORIES = new Set<EventCategory>(Object.keys(CATEGORIES) as EventCategory[]);

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
