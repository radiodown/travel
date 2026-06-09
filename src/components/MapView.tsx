import { useEffect, useRef } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
} from '@vis.gl/react-google-maps';
import type { ItineraryEvent } from '../data/itinerary';
import { CATEGORIES } from '../data/categories';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

type MapCenter = { lat: number; lng: number };

const CENTER_EPSILON = 0.000001;
const ZOOM_EPSILON = 0.01;

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
  return projection
    .fromPointToLatLng(new google.maps.Point(point.x - offsetX / scale, point.y), true)
    .toJSON();
}

function AnimateCamera({
  center,
  zoom,
  offsetX,
}: {
  center: MapCenter;
  zoom: number;
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
    if (!map) return;

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
  }, [center.lat, center.lng, zoom, offsetX, map]);

  return null;
}

type Props = {
  events: ItineraryEvent[];
  selectedIndex: number | null;
  onSelectEvent: (index: number) => void;
  /** Horizontal pixels covered by the floating sidebar, so the map can center
   *  the selected place within the remaining visible area. */
  visibleOffsetX?: number;
};

export default function MapView({ events, selectedIndex, onSelectEvent, visibleOffsetX = 0 }: Props) {
  const mapped = events
    .map((e, i) => ({ event: e, origIndex: i }))
    .filter(({ event }) => !!event.coordinates);

  const defaultCenter = mapped.length > 0
    ? { lat: mapped[0].event.coordinates![0], lng: mapped[0].event.coordinates![1] }
    : { lat: 50.0755, lng: 14.4378 };

  const selectedCoord =
    selectedIndex !== null && events[selectedIndex]?.coordinates
      ? events[selectedIndex].coordinates!
      : null;

  const panTarget = selectedCoord
    ? { lat: selectedCoord[0], lng: selectedCoord[1] }
    : defaultCenter;

  // Closer zoom when a place is selected, wider overview otherwise
  const panZoom = selectedCoord ? 17 : 13;

  if (!API_KEY) {
    return (
      <div className="map-no-key">
        <p className="map-no-key-title">🗺️ Google Maps API 키가 필요합니다</p>
        <p className="map-no-key-desc">
          프로젝트 루트의 <code>.env</code> 파일에 아래처럼 키를 추가한 뒤
          개발 서버를 재시작하세요.
        </p>
        <pre className="map-no-key-code">VITE_GOOGLE_MAPS_API_KEY=발급받은_키</pre>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY}>
      <Map
        defaultCenter={defaultCenter}
        defaultZoom={13}
        mapId="DEMO_MAP_ID"
        gestureHandling="greedy"
        disableDefaultUI={true}
        style={{ width: '100%', height: '100%' }}
      >
        <AnimateCamera center={panTarget} zoom={panZoom} offsetX={visibleOffsetX} />
        {mapped.map(({ event, origIndex }, nth) => {
          const active = selectedIndex === origIndex;
          const color = event.category ? CATEGORIES[event.category].color : 'var(--accent)';
          return (
            <AdvancedMarker
              key={origIndex}
              position={{ lat: event.coordinates![0], lng: event.coordinates![1] }}
              onClick={() => onSelectEvent(origIndex)}
              title={event.title}
              zIndex={active ? 999 : nth}
            >
              <div
                className={`map-pin${active ? ' map-pin--active' : ''}`}
                style={{ background: active ? undefined : color }}
              >
                <span>{nth + 1}</span>
              </div>
            </AdvancedMarker>
          );
        })}
      </Map>
    </APIProvider>
  );
}
