import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { ItineraryEvent } from '../data/itinerary';

function createPin(number: number, active: boolean) {
  return L.divIcon({
    html: `<div class="map-pin${active ? ' map-pin--active' : ''}"><span>${number}</span></div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -20],
  });
}

function FlyTo({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, 14, { duration: 0.7 });
  }, [center, map]);
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

  const defaultCenter: [number, number] =
    mapped.length > 0 ? mapped[0].event.coordinates! : [50.0755, 14.4378];

  const flyTarget: [number, number] =
    selectedIndex !== null && events[selectedIndex]?.coordinates
      ? events[selectedIndex].coordinates!
      : defaultCenter;

  return (
    <MapContainer
      center={defaultCenter}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FlyTo center={flyTarget} />
      {mapped.map(({ event, origIndex }, nth) => (
        <Marker
          key={origIndex}
          position={event.coordinates!}
          icon={createPin(nth + 1, selectedIndex === origIndex)}
          eventHandlers={{ click: () => onSelectEvent(origIndex) }}
        >
          <Popup>
            <strong>{event.title}</strong>
            {event.location && <><br />{event.location}</>}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
