import { useEffect } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
} from '@vis.gl/react-google-maps';
import type { ItineraryEvent } from '../data/itinerary';
import { CATEGORIES } from '../data/categories';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

function PanTo({ center, zoom }: { center: { lat: number; lng: number }; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.panTo(center);
    map.setZoom(zoom);
  }, [center, zoom, map]);
  return null;
}

type Props = {
  events: ItineraryEvent[];
  selectedIndex: number | null;
  onSelectEvent: (index: number) => void;
};

export default function MapView({ events, selectedIndex, onSelectEvent }: Props) {
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
        disableDefaultUI={false}
        style={{ width: '100%', height: '100%' }}
      >
        <PanTo center={panTarget} zoom={panZoom} />
        {mapped.map(({ event, origIndex }, nth) => {
          const active = selectedIndex === origIndex;
          const color = event.category ? CATEGORIES[event.category].color : '#4f46e5';
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
