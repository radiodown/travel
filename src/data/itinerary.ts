import type { EventCategory } from './categories';
import itineraryData from './itinerary.json';

export type EventAttachment = {
  name: string;
  dataUrl: string;
  type: string;
};

export type ReservationInfo = {
  label: string;
  details: string;
};

export type RouteTravelMode = 'TRANSIT' | 'DRIVING' | 'WALKING' | 'BICYCLING';

export type RouteTransitPreference = 'FEWER_TRANSFERS' | 'LESS_WALKING';

export type SavedRouteSegment = {
  mode: RouteTravelMode;
  modeLabel: string;
  modeIcon: string;
  durationText: string;
  durationValue: number;
  distanceText?: string;
  distanceValue: number;
  summary?: string;
  path: [number, number][];
  departureStop?: string;
  arrivalStop?: string;
  departureTimeText?: string;
  arrivalTimeText?: string;
  stopCount?: number;
  lineColor?: string;
  lineTextColor?: string;
};

export type SavedRouteTransfer = {
  type: 'TRANSFER' | 'WALK';
  title: string;
  detail?: string;
};

export type SavedRoute = {
  mode: RouteTravelMode;
  modeLabel: string;
  modeIcon: string;
  originTitle: string;
  destinationTitle: string;
  summary: string;
  durationText: string;
  durationValue: number;
  distanceText: string;
  departureText?: string;
  arrivalText?: string;
  requestedDepartureTime?: string;
  transitPreference?: RouteTransitPreference;
  transferCount: number;
  walkingDurationText?: string;
  walkingDistanceText?: string;
  transitLines: string[];
  path: [number, number][];
  segments: SavedRouteSegment[];
  transfers: SavedRouteTransfer[];
};

export type SavedFlight = {
  originTitle: string;
  destinationTitle: string;
  originCoordinates: [number, number];
  destinationCoordinates: [number, number];
  path: [number, number][];
  durationText: string;
  airline?: string;
  flightNumber?: string;
  arrivalTimeText?: string;
  bookingReference?: string;
};

export type ItineraryEvent = {
  time?: string;
  title: string;
  description?: string;
  location?: string;
  note?: string;
  coordinates?: [number, number]; // [lat, lng]
  category?: EventCategory;
  attachment?: EventAttachment;
  reservation?: ReservationInfo;
  route?: SavedRoute;
  flight?: SavedFlight;
};

export type ItineraryDay = {
  day: string;
  title: string;
  date: string;
  summary: string;
  events: ItineraryEvent[];
  reservations?: ReservationInfo[];
  city?: string;
  cityCoordinates?: [number, number]; // [lat, lng] used as the weather location
};

const itinerary = itineraryData as unknown as { days: ItineraryDay[] };

export default itinerary;
