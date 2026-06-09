import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  APIProvider,
  Map,
  Marker,
  Polyline,
  RenderingType,
  type MapMouseEvent,
  useMap,
} from '@vis.gl/react-google-maps';
import type { ItineraryEvent, SavedFlight, SavedRouteSegment } from '../data/itinerary';
import { CATEGORIES } from '../data/categories';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const CLEAN_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f8fafc' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f8fafc' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#eef2f7' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
];

type MapCenter = { lat: number; lng: number };
type RoutePath = [number, number][];

const CENTER_EPSILON = 0.000001;
const ZOOM_EPSILON = 0.01;
const ACTIVE_MARKER_COLOR = '#dc2626';
const DEFAULT_MARKER_COLOR = '#2563eb';
const ROUTE_MODE_COLORS = {
  TRANSIT: '#0284c7',
  DRIVING: '#1d4ed8',
  WALKING: '#16a34a',
  BICYCLING: '#ea580c',
} as const;

type MapDraftEvent = ItineraryEvent & {
  coordinates: [number, number];
};

type PlaceSelectionDetails = {
  title?: string;
  location?: string;
  position?: MapCenter;
  primaryTypeLabel?: string;
  priceLabel?: string;
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
  googleMapsUri?: string;
  photoUri?: string;
  photoAttributionName?: string;
  photoAttributionUri?: string;
};

type SelectionPayload = {
  draft: MapDraftEvent;
  details: PlaceSelectionDetails;
};

type PoiCandidate = {
  draft: MapDraftEvent;
  details: PlaceSelectionDetails;
  position: MapCenter;
};

type RouteTransferMarker = {
  position: MapCenter;
  title: string;
  kind: 'TRANSFER' | 'WALK';
};

function createCurrentLocationSymbol(): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: '#2563eb',
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeOpacity: 1,
    strokeWeight: 3,
    scale: 7,
  };
}

function isFlightMovementEvent(event: ItineraryEvent): event is ItineraryEvent & { flight: SavedFlight } {
  return !!event.flight && event.flight.path.length > 1;
}

function getRouteCenter(path: RoutePath): MapCenter | null {
  if (path.length === 0) return null;
  const mid = path[Math.floor(path.length / 2)];
  return { lat: mid[0], lng: mid[1] };
}

function toPolylinePath(path: RoutePath) {
  return path.map(([lat, lng]) => ({ lat, lng }));
}

function getSegmentColor(segment: SavedRouteSegment) {
  if (segment.mode === 'TRANSIT' && segment.lineColor) {
    return segment.lineColor;
  }
  return ROUTE_MODE_COLORS[segment.mode] ?? ROUTE_MODE_COLORS.TRANSIT;
}

function getWalkingDashIcons(color: string, active: boolean): google.maps.IconSequence[] {
  return [
    {
      icon: {
        path: 'M 0,-1 0,1',
        strokeColor: color,
        strokeOpacity: active ? 0.95 : 0.7,
        strokeWeight: active ? 3 : 2.4,
        scale: active ? 3.5 : 3,
      },
      offset: '0',
      repeat: '12px',
    },
  ];
}

function getTransferMarkerSymbol(kind: RouteTransferMarker['kind']): google.maps.Symbol {
  if (kind === 'WALK') {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: '#ffffff',
      fillOpacity: 1,
      strokeColor: '#16a34a',
      strokeOpacity: 1,
      strokeWeight: 3,
      scale: 5,
    };
  }

  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: '#0f766e',
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeOpacity: 1,
    strokeWeight: 2.5,
    scale: 6,
  };
}

function buildTransferMarkers(segments: SavedRouteSegment[]): RouteTransferMarker[] {
  const markers: RouteTransferMarker[] = [];
  let skipNextTransfer = false;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const firstPoint = segment.path[0];
    if (!firstPoint) continue;

    if (segment.mode === 'WALKING') {
      const previousTransit = [...segments.slice(0, index)].reverse().find((item) => item.mode === 'TRANSIT');
      const nextTransit = segments.slice(index + 1).find((item) => item.mode === 'TRANSIT');

      if (previousTransit && nextTransit) {
        markers.push({
          position: { lat: firstPoint[0], lng: firstPoint[1] },
          title: `도보 ${segment.durationText}`,
          kind: 'WALK',
        });
        skipNextTransfer = true;
      }
      continue;
    }

    if (segment.mode !== 'TRANSIT') continue;

    const previousTransit = [...segments.slice(0, index)].reverse().find((item) => item.mode === 'TRANSIT');
    if (!previousTransit) continue;

    if (skipNextTransfer) {
      skipNextTransfer = false;
      continue;
    }

    markers.push({
      position: { lat: firstPoint[0], lng: firstPoint[1] },
      title: segment.departureStop ? `${segment.departureStop} 환승` : '환승',
      kind: 'TRANSFER',
    });
  }

  return markers;
}

function getShortPlaceName(label?: string) {
  if (!label) return 'Selected place';
  return label.split(',')[0].trim() || 'Selected place';
}

function getBrowserLanguage() {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.language || undefined;
}

function formatPriceLabel(priceLevel?: google.maps.places.PriceLevelString | null) {
  switch (priceLevel) {
    case 'FREE':
      return 'Free';
    case 'INEXPENSIVE':
      return '$';
    case 'MODERATE':
      return '$$';
    case 'EXPENSIVE':
      return '$$$';
    case 'VERY_EXPENSIVE':
      return '$$$$';
    default:
      return undefined;
  }
}

function formatRatingCount(value?: number) {
  if (!value) return undefined;
  return new Intl.NumberFormat().format(value);
}

async function summarizePlaceSelection(
  place: google.maps.places.Place
): Promise<PlaceSelectionDetails> {
  const photo = place.photos?.[0];
  const primaryAttribution = photo?.authorAttributions?.[0];
  let openNow: boolean | undefined;

  try {
    openNow = await place.isOpen();
  } catch {
    openNow = undefined;
  }

  return {
    title: place.displayName ?? getShortPlaceName(place.formattedAddress ?? undefined),
    location: place.formattedAddress ?? place.displayName ?? undefined,
    position: place.location?.toJSON(),
    primaryTypeLabel: place.primaryTypeDisplayName ?? undefined,
    priceLabel: formatPriceLabel(place.priceLevel),
    rating: place.rating ?? undefined,
    userRatingCount: place.userRatingCount ?? undefined,
    openNow,
    googleMapsUri: place.googleMapsURI ?? undefined,
    photoUri: photo?.getURI({ maxWidth: 560, maxHeight: 320 }),
    photoAttributionName: primaryAttribution?.displayName ?? undefined,
    photoAttributionUri: primaryAttribution?.uri ?? undefined,
  };
}

async function reverseGeocodeSelection(latLng: MapCenter): Promise<PlaceSelectionDetails | null> {
  try {
    const { Geocoder } = await google.maps.importLibrary('geocoding') as google.maps.GeocodingLibrary;
    const geocoder = new Geocoder();
    const response = await geocoder.geocode({ location: latLng });
    const result = response.results[0];

    if (!result) return null;

    return {
      title: getShortPlaceName(result.formatted_address),
      location: result.formatted_address,
      position: result.geometry.location?.toJSON() ?? latLng,
    };
  } catch {
    return null;
  }
}

async function geocodePlaceSelection(placeId: string): Promise<PlaceSelectionDetails | null> {
  try {
    const { Geocoder } = await google.maps.importLibrary('geocoding') as google.maps.GeocodingLibrary;
    const geocoder = new Geocoder();
    const response = await geocoder.geocode({ placeId });
    const result = response.results[0];

    if (!result) return null;

    return {
      title: getShortPlaceName(result.formatted_address),
      location: result.formatted_address,
      position: result.geometry.location?.toJSON(),
    };
  } catch {
    return null;
  }
}

async function getPlaceSelectionDetails(placeId: string): Promise<PlaceSelectionDetails | null> {
  try {
    const { Place } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary;
    const place = new Place({
      id: placeId,
      requestedLanguage: getBrowserLanguage() ?? null,
    });

    await place.fetchFields({
      fields: [
        'displayName',
        'formattedAddress',
        'location',
        'primaryTypeDisplayName',
        'priceLevel',
        'rating',
        'userRatingCount',
        'googleMapsURI',
        'photos',
      ],
    });

    return summarizePlaceSelection(place);
  } catch {
    return geocodePlaceSelection(placeId);
  }
}

async function findNearbyPlaceSelection(latLng: MapCenter): Promise<PlaceSelectionDetails | null> {
  try {
    const { Place } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary;
    const response = await Place.searchNearby({
      fields: [
        'displayName',
        'formattedAddress',
        'location',
        'primaryTypeDisplayName',
        'priceLevel',
        'rating',
        'userRatingCount',
        'googleMapsURI',
        'photos',
      ],
      language: getBrowserLanguage(),
      locationRestriction: {
        center: latLng,
        radius: 30,
      },
      maxResultCount: 1,
      rankPreference: 'DISTANCE',
    });
    const place = response.places[0];
    const position = place?.location?.toJSON();

    if (!place || !position) return null;
    if (haversineKm(latLng, position) > 0.08) return null;

    return summarizePlaceSelection(place);
  } catch {
    return null;
  }
}

async function buildDraftEventFromSelection(
  latLng: MapCenter,
  placeId?: string | null
): Promise<SelectionPayload> {
  let placeDetails = placeId ? await getPlaceSelectionDetails(placeId) : null;

  if (!placeDetails) {
    placeDetails = await findNearbyPlaceSelection(latLng);
  }

  if (!placeDetails) {
    placeDetails = await reverseGeocodeSelection(latLng);
  }

  const fallbackLocation = `${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}`;
  const details = placeDetails ?? {
    title: 'Selected place',
    location: fallbackLocation,
    position: latLng,
  };
  const resolvedPosition = details.position ?? latLng;
  const coordinates: [number, number] = [resolvedPosition.lat, resolvedPosition.lng];

  return {
    draft: {
      title: details.title ?? 'Selected place',
      location: details.location ?? fallbackLocation,
      coordinates,
      category: 'sightseeing',
    },
    details: {
      ...details,
      title: details.title ?? 'Selected place',
      location: details.location ?? fallbackLocation,
      position: resolvedPosition,
    },
  };
}

function createMarkerSymbol(fillColor: string, active: boolean): google.maps.Symbol {
  const radius = active ? 16 : 13;

  return {
    path: [
      `M 0 ${radius}`,
      `A ${radius} ${radius} 0 1 1 0 -${radius}`,
      `A ${radius} ${radius} 0 1 1 0 ${radius}`,
      'Z',
    ].join(' '),
    fillColor,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeOpacity: 1,
    strokeWeight: active ? 4 : 3,
    scale: 1,
  };
}

function createMarkerLabel(index: number, active: boolean): google.maps.MarkerLabel {
  return {
    text: String(index),
    color: '#ffffff',
    fontSize: active ? '12px' : '11px',
    fontWeight: '700',
  };
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function normalizeLng(value: number) {
  return ((value + 540) % 360) - 180;
}

function getLngDelta(from: number, to: number) {
  return normalizeLng(to - from);
}

function interpolateCenter(from: MapCenter, to: MapCenter, t: number): MapCenter {
  return {
    lat: lerp(from.lat, to.lat, t),
    lng: normalizeLng(from.lng + getLngDelta(from.lng, to.lng) * t),
  };
}

function areCentersClose(a: MapCenter, b: MapCenter) {
  return (
    Math.abs(a.lat - b.lat) < CENTER_EPSILON &&
    Math.abs(getLngDelta(a.lng, b.lng)) < CENTER_EPSILON
  );
}

function haversineKm(a: MapCenter, b: MapCenter) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const latDelta = toRad(b.lat - a.lat);
  const lngDelta = toRad(getLngDelta(a.lng, b.lng));
  const startLat = toRad(a.lat);
  const endLat = toRad(b.lat);
  const h =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getAnimationDurationMs(distanceKm: number, zoomDelta: number) {
  const distanceWeight = distanceKm > 0 ? Math.log2(distanceKm + 1) * 140 : 0;
  const zoomWeight = zoomDelta * 60;
  return Math.max(380, Math.min(1400, 320 + distanceWeight + zoomWeight));
}

function getFlightMidZoom(startZoom: number, endZoom: number, distanceKm: number) {
  if (distanceKm < 8) return null;
  const lift = Math.min(7, Math.max(1.5, Math.log2(distanceKm + 1) * 0.7));
  const midZoom = Math.max(4, Math.min(startZoom, endZoom) - lift);
  return midZoom < Math.min(startZoom, endZoom) - 0.35 ? midZoom : null;
}

function getFrameZoom(startZoom: number, endZoom: number, midZoom: number | null, t: number) {
  if (midZoom === null) {
    return lerp(startZoom, endZoom, easeInOutCubic(t));
  }

  if (t < 0.5) {
    return lerp(startZoom, midZoom, easeInOutCubic(t * 2));
  }

  return lerp(midZoom, endZoom, easeInOutCubic((t - 0.5) * 2));
}

function getOffsetCenter(
  map: google.maps.Map,
  center: MapCenter,
  zoom: number,
  offsetX: number
): MapCenter {
  if (!offsetX) return center;
  const projection = map.getProjection();
  if (!projection) return center;

  const point = projection.fromLatLngToPoint(center);
  if (!point) return center;

  const scale = 2 ** zoom;
  const offsetLatLng = projection.fromPointToLatLng(
    new google.maps.Point(point.x - offsetX / scale, point.y),
    true
  );

  return offsetLatLng ? offsetLatLng.toJSON() : center;
}

function ContextMenuSelectionHandler({
  onSelectLocation,
}: {
  onSelectLocation?: (latLng: MapCenter) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !onSelectLocation) return;

    const overlay = new google.maps.OverlayView();
    overlay.onAdd = () => {};
    overlay.draw = () => {};
    overlay.onRemove = () => {};
    overlay.setMap(map);

    const mapDiv = map.getDiv();
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();

      const projection = overlay.getProjection();
      if (!projection) return;

      const bounds = mapDiv.getBoundingClientRect();
      const point = new google.maps.Point(
        event.clientX - bounds.left,
        event.clientY - bounds.top
      );
      const latLng = projection.fromContainerPixelToLatLng(point);
      if (!latLng) return;

      onSelectLocation(latLng.toJSON());
    };

    mapDiv.addEventListener('contextmenu', handleContextMenu);

    return () => {
      mapDiv.removeEventListener('contextmenu', handleContextMenu);
      overlay.setMap(null);
    };
  }, [map, onSelectLocation]);

  return null;
}

function CurrentLocationControl({
  onLocate,
}: {
  onLocate?: (position: MapCenter) => void;
}) {
  const map = useMap();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [currentLocation, setCurrentLocation] = useState<MapCenter | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current !== null) {
        window.clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!map) return;

    const element = document.createElement('div');
    element.className = 'map-control-slot';

    const controls = map.controls[google.maps.ControlPosition.RIGHT_BOTTOM];
    controls.push(element);
    setContainer(element);

    return () => {
      for (let index = controls.getLength() - 1; index >= 0; index -= 1) {
        if (controls.getAt(index) === element) {
          controls.removeAt(index);
          break;
        }
      }
      setContainer((current) => (current === element ? null : current));
      element.remove();
    };
  }, [map]);

  const showLocationError = (message: string) => {
    setLocationError(message);
    if (errorTimeoutRef.current !== null) {
      window.clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = window.setTimeout(() => {
      setLocationError(null);
      errorTimeoutRef.current = null;
    }, 2600);
  };

  const handleLocate = () => {
    if (!map || locating) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      showLocationError('Location unavailable');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nextPosition = { lat: coords.latitude, lng: coords.longitude };
        const nextZoom = Math.max(map.getZoom() ?? 13, 16);
        setCurrentLocation(nextPosition);
        map.moveCamera({ center: nextPosition, zoom: nextZoom });
        onLocate?.(nextPosition);
        setLocating(false);
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location blocked'
            : error.code === error.TIMEOUT
              ? 'Location timeout'
              : 'Location failed';
        showLocationError(message);
        setLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

  return (
    <>
      {currentLocation && (
        <Marker
          position={currentLocation}
          zIndex={920}
          icon={createCurrentLocationSymbol()}
          title="Current location"
        />
      )}
      {container &&
        createPortal(
          <div className="map-control-stack">
            {locationError && <p className="map-control-hint">{locationError}</p>}
            <button
              className={`map-locate-btn${locating ? ' is-loading' : ''}`}
              onClick={handleLocate}
              type="button"
              aria-label="Go to my location"
              title="Go to my location"
              disabled={locating}
            >
              <span className="map-locate-btn-icon" aria-hidden="true">
                ◎
              </span>
            </button>
          </div>,
          container
        )}
    </>
  );
}

function PoiGlassOverlay({
  candidate,
  onClose,
  onAddLocation,
}: {
  candidate: PoiCandidate;
  onClose: () => void;
  onAddLocation?: (event: ItineraryEvent) => void;
}) {
  const map = useMap();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const ratingCount = formatRatingCount(candidate.details.userRatingCount);
  const addTriggeredRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    const overlay = new google.maps.OverlayView();
    const element = document.createElement('div');
    element.className = 'map-poi-overlay';
    element.style.position = 'absolute';
    element.style.left = '0';
    element.style.top = '0';
    element.style.pointerEvents = 'none';

    overlay.onAdd = () => {
      const pane = overlay.getPanes()?.overlayMouseTarget ?? overlay.getPanes()?.floatPane;
      if (!pane) return;
      pane.appendChild(element);
      google.maps.OverlayView.preventMapHitsAndGesturesFrom(element);
      setContainer(element);
    };

    overlay.draw = () => {
      const projection = overlay.getProjection();
      if (!projection) return;

      const point = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(candidate.position.lat, candidate.position.lng)
      );
      if (!point) return;

      element.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
    };

    overlay.onRemove = () => {
      setContainer((current) => (current === element ? null : current));
      element.remove();
    };

    overlay.setMap(map);

    return () => {
      overlay.setMap(null);
    };
  }, [map, candidate.position.lat, candidate.position.lng]);

  useEffect(() => {
    addTriggeredRef.current = false;
  }, [candidate.draft]);

  if (!container) return null;

  const stopMapGesture = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  const addLocation = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (addTriggeredRef.current || !onAddLocation) return;
    addTriggeredRef.current = true;
    onClose();
    onAddLocation(candidate.draft);
  };

  return createPortal(
    <div
      className="map-poi-glass"
      role="dialog"
      aria-modal="false"
      aria-label={candidate.draft.title}
      onClick={stopMapGesture}
      onMouseDown={stopMapGesture}
      onPointerDown={stopMapGesture}
      onPointerMove={stopMapGesture}
      onPointerUp={stopMapGesture}
      onTouchStart={stopMapGesture}
      onTouchMove={stopMapGesture}
      onTouchEnd={stopMapGesture}
    >
      {candidate.details.photoUri && (
        <div className="map-poi-glass-photo-wrap">
          <img
            className="map-poi-glass-photo"
            src={candidate.details.photoUri}
            alt={candidate.draft.title}
          />
        </div>
      )}
      <div className="map-poi-glass-meta">
        {candidate.details.primaryTypeLabel && (
          <span className="map-poi-glass-chip">{candidate.details.primaryTypeLabel}</span>
        )}
        {candidate.details.priceLabel && (
          <span className="map-poi-glass-chip">{candidate.details.priceLabel}</span>
        )}
        {typeof candidate.details.openNow === 'boolean' && (
          <span
            className={`map-poi-glass-chip${candidate.details.openNow ? ' is-open' : ' is-closed'}`}
          >
            {candidate.details.openNow ? 'Open now' : 'Closed now'}
          </span>
        )}
      </div>
      <h4 className="map-poi-glass-title">{candidate.draft.title}</h4>
      {candidate.draft.location && (
        <p className="map-poi-glass-location">{candidate.draft.location}</p>
      )}
      {(candidate.details.rating || ratingCount) && (
        <div className="map-poi-glass-stats">
          {candidate.details.rating && (
            <span className="map-poi-glass-stat">
              <span className="map-poi-glass-stat-icon" aria-hidden="true">*</span>
              {candidate.details.rating.toFixed(1)}
            </span>
          )}
          {ratingCount && (
            <span className="map-poi-glass-stat muted">{ratingCount} reviews</span>
          )}
        </div>
      )}
      {(candidate.details.googleMapsUri || onAddLocation) && (
        <div className="map-poi-glass-actions">
          {candidate.details.googleMapsUri && (
            <a
              className="map-poi-glass-link secondary"
              href={candidate.details.googleMapsUri}
              target="_blank"
              rel="noreferrer"
            >
              Google Maps
            </a>
          )}
          {onAddLocation && (
            <button
              className="map-poi-glass-link map-poi-glass-link-button"
              onClick={addLocation}
              onPointerUp={addLocation}
              type="button"
            >
              Add
            </button>
          )}
        </div>
      )}
      {candidate.details.photoAttributionName && (
        <p className="map-poi-glass-credit">
          Photo by{' '}
          {candidate.details.photoAttributionUri ? (
            <a
              href={candidate.details.photoAttributionUri}
              target="_blank"
              rel="noreferrer"
            >
              {candidate.details.photoAttributionName}
            </a>
          ) : (
            candidate.details.photoAttributionName
          )}
        </p>
      )}
      <div className="map-poi-glass-pin" aria-hidden="true" />
    </div>,
    container
  );
}

function FitRouteBounds({
  path,
  offsetX,
}: {
  path: RoutePath;
  offsetX: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || path.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    path.forEach(([lat, lng]) => bounds.extend({ lat, lng }));

    map.fitBounds(bounds, 84);

    if (!offsetX) return;

    const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
      const center = map.getCenter()?.toJSON();
      const zoom = map.getZoom();
      if (!center || zoom === undefined) return;
      map.moveCamera({ center: getOffsetCenter(map, center, zoom, offsetX), zoom });
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, offsetX, path]);

  return null;
}

function AnimateCamera({
  center,
  zoom,
  offsetX,
}: {
  center: MapCenter | null;
  zoom: number | null;
  offsetX: number;
}) {
  const map = useMap();
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!map || !center || zoom === null) return;

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const nextCenter = getOffsetCenter(map, center, zoom, offsetX);
    const currentCenter = map.getCenter()?.toJSON();
    const currentZoom = map.getZoom();

    if (!currentCenter || currentZoom === undefined) {
      map.moveCamera({ center: nextCenter, zoom });
      return;
    }

    if (
      areCentersClose(currentCenter, nextCenter) &&
      Math.abs(currentZoom - zoom) < ZOOM_EPSILON
    ) {
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      map.moveCamera({ center: nextCenter, zoom });
      return;
    }

    // panTo animates only short hops, so drive long camera moves ourselves.
    const distanceKm = haversineKm(currentCenter, nextCenter);
    const durationMs = getAnimationDurationMs(distanceKm, Math.abs(currentZoom - zoom));
    const midZoom = getFlightMidZoom(currentZoom, zoom, distanceKm);
    const startedAt = performance.now();

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      map.moveCamera({
        center: interpolateCenter(currentCenter, nextCenter, easeInOutCubic(progress)),
        zoom: getFrameZoom(currentZoom, zoom, midZoom, progress),
      });

      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(animate);
      } else {
        frameRef.current = null;
      }
    };

    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [center?.lat, center?.lng, zoom, offsetX, map]);

  return null;
}

type Props = {
  events: ItineraryEvent[];
  selectedIndex: number | null;
  onSelectEvent: (index: number) => void;
  cleanMode?: boolean;
  onAddLocation?: (event: ItineraryEvent) => void;
  /** Horizontal pixels covered by the floating sidebar, so the map can center
   *  the selected place within the remaining visible area. */
  visibleOffsetX?: number;
};

export default function MapView({
  events,
  selectedIndex,
  onSelectEvent,
  cleanMode = true,
  onAddLocation,
  visibleOffsetX = 0,
}: Props) {
  const [poiCandidate, setPoiCandidate] = useState<PoiCandidate | null>(null);
  const hasFocusedSelectionRef = useRef(false);
  const mapped = events
    .map((e, i) => ({ event: e, origIndex: i }))
    .filter(({ event }) => !!event.coordinates && !event.route && !event.flight);
  const routeEvents = events
    .map((event, index) => ({ event, index }))
    .filter((item): item is { event: ItineraryEvent & { route: NonNullable<ItineraryEvent['route']> }; index: number } =>
      !!item.event.route && item.event.route.path.length > 0
    );
  const flightEvents = events
    .map((event, index) => ({ event, index }))
    .filter((item): item is { event: ItineraryEvent & { flight: SavedFlight }; index: number } =>
      isFlightMovementEvent(item.event)
    );

  const defaultCenter = mapped.length > 0
    ? { lat: mapped[0].event.coordinates![0], lng: mapped[0].event.coordinates![1] }
    : { lat: 50.0755, lng: 14.4378 };

  const selectedCoord =
    selectedIndex !== null && events[selectedIndex]?.coordinates
      ? events[selectedIndex].coordinates!
      : null;
  const selectedRoutePath =
    selectedIndex !== null && events[selectedIndex]?.route?.path.length
      ? events[selectedIndex].route!.path
      : selectedIndex !== null && events[selectedIndex]?.flight?.path.length
        ? events[selectedIndex].flight!.path
      : null;
  const selectedRouteSegments =
    selectedIndex !== null && events[selectedIndex]?.route?.segments?.length
      ? events[selectedIndex].route!.segments
      : [];
  const selectedRouteTransferMarkers = buildTransferMarkers(selectedRouteSegments);
  const selectedRouteCenter = selectedRoutePath ? getRouteCenter(selectedRoutePath) : null;

  useEffect(() => {
    hasFocusedSelectionRef.current = false;
  }, [defaultCenter.lat, defaultCenter.lng]);

  useEffect(() => {
    if (selectedCoord || selectedRoutePath) {
      hasFocusedSelectionRef.current = true;
    }
  }, [selectedCoord, selectedRoutePath]);

  const shouldShowOverview = !selectedCoord && !selectedRouteCenter && !hasFocusedSelectionRef.current;
  const panTarget = selectedCoord
    ? { lat: selectedCoord[0], lng: selectedCoord[1] }
    : selectedRouteCenter
      ? null
    : shouldShowOverview
      ? defaultCenter
      : null;

  // Closer zoom when a place is selected, wider overview otherwise
  const panZoom = selectedCoord ? 17 : shouldShowOverview ? 13 : null;
  const mapStyles = cleanMode ? CLEAN_MAP_STYLES : undefined;

  useEffect(() => {
    if (cleanMode) {
      setPoiCandidate(null);
    }
  }, [cleanMode]);

  const handleMapClick = async (event: MapMouseEvent) => {
    const latLng = event.detail.latLng;
    if (!latLng) {
      setPoiCandidate(null);
      return;
    }

    if (!event.detail.placeId) {
      setPoiCandidate(null);
      return;
    }

    event.stop();
    const selection = await buildDraftEventFromSelection(latLng, event.detail.placeId);
    setPoiCandidate({
      draft: selection.draft,
      details: selection.details,
      position: { lat: selection.draft.coordinates[0], lng: selection.draft.coordinates[1] },
    });
  };

  const handleMapContextMenu = async (latLng: MapCenter) => {
    if (!onAddLocation) return;

    setPoiCandidate(null);
    const selection = await buildDraftEventFromSelection(latLng);
    onAddLocation(selection.draft);
  };

  if (!API_KEY) {
    return (
      <div className="map-no-key">
        <p className="map-no-key-title">Google Maps API key is required</p>
        <p className="map-no-key-desc">
          Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file and restart
          the dev server.
        </p>
        <pre className="map-no-key-code">VITE_GOOGLE_MAPS_API_KEY=your_key_here</pre>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} version="beta">
      <Map
        defaultCenter={defaultCenter}
        defaultZoom={13}
        renderingType={RenderingType.RASTER}
        gestureHandling="greedy"
        clickableIcons={!cleanMode}
        disableDefaultUI={true}
        styles={mapStyles}
        onClick={handleMapClick}
        style={{ width: '100%', height: '100%' }}
      >
        <ContextMenuSelectionHandler onSelectLocation={handleMapContextMenu} />
        <CurrentLocationControl
          onLocate={() => {
            setPoiCandidate(null);
          }}
        />
        <AnimateCamera center={panTarget} zoom={panZoom} offsetX={visibleOffsetX} />
        {selectedRoutePath && <FitRouteBounds path={selectedRoutePath} offsetX={visibleOffsetX} />}
        {poiCandidate && (
          <PoiGlassOverlay
            candidate={poiCandidate}
            onClose={() => setPoiCandidate(null)}
            onAddLocation={onAddLocation}
          />
        )}
        {flightEvents.map(({ event, index }) => {
          const active = selectedIndex === index;
          return (
            <Polyline
              key={`flight-${index}`}
              path={toPolylinePath(event.flight.path)}
              geodesic
              strokeColor="#0f766e"
              strokeOpacity={active ? 0.88 : 0.45}
              strokeWeight={active ? 4 : 3}
              zIndex={active ? 680 : 280}
              clickable
              onClick={() => {
                setPoiCandidate(null);
                onSelectEvent(index);
              }}
            />
          );
        })}
        {routeEvents.map(({ event, index }) => {
          const active = selectedIndex === index;
          const segments =
            event.route.segments.length > 0
              ? event.route.segments
              : [
                  {
                    mode: event.route.mode,
                    modeLabel: event.route.modeLabel,
                    modeIcon: event.route.modeIcon,
                    durationText: event.route.durationText,
                    durationValue: event.route.durationValue,
                    distanceText: event.route.distanceText,
                    distanceValue: 0,
                    summary: event.route.summary,
                    path: event.route.path,
                  },
                ];

          return segments.map((segment, segmentIndex) => {
            const color = getSegmentColor(segment);
            const isWalking = segment.mode === 'WALKING';
            return (
              <Polyline
                key={`route-${index}-${segmentIndex}`}
                path={toPolylinePath(segment.path)}
                strokeColor={color}
                strokeOpacity={isWalking ? 0 : active ? 0.92 : 0.45}
                strokeWeight={active ? 6 : 4}
                zIndex={active ? 700 : 320}
                icons={isWalking ? getWalkingDashIcons(color, active) : undefined}
                clickable
                onClick={() => {
                  setPoiCandidate(null);
                  onSelectEvent(index);
                }}
              />
            );
          });
        })}
        {selectedRouteTransferMarkers.map((marker, index) => (
          <Marker
            key={`route-transfer-${index}`}
            position={marker.position}
            title={marker.title}
            zIndex={860}
            icon={getTransferMarkerSymbol(marker.kind)}
          />
        ))}
        {mapped.map(({ event, origIndex }, nth) => {
          const active = selectedIndex === origIndex;
          const color = event.category ? CATEGORIES[event.category].color : DEFAULT_MARKER_COLOR;
          return (
            <Marker
              key={origIndex}
              position={{ lat: event.coordinates![0], lng: event.coordinates![1] }}
              onClick={() => {
                setPoiCandidate(null);
                onSelectEvent(origIndex);
              }}
              title={event.title}
              zIndex={active ? 999 : nth + 1}
              icon={createMarkerSymbol(active ? ACTIVE_MARKER_COLOR : color, active)}
              label={createMarkerLabel(nth + 1, active)}
            />
          );
        })}
      </Map>
    </APIProvider>
  );
}
