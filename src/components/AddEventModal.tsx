import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventAttachment, ItineraryEvent } from '../data/itinerary';
import { CATEGORIES, CATEGORY_ORDER, type EventCategory } from '../data/categories';
import GlassSelect from './GlassSelect';

type Props = {
  initialEvent?: ItineraryEvent | null;
  events?: ItineraryEvent[];
  mode?: 'create' | 'edit';
  onClose: () => void;
  onSave: (event: ItineraryEvent) => void;
  onRequestRoute?: (request: RouteDraftRequest) => void;
};

export type RouteDraftRequest = {
  originIndex: number;
  destinationIndex: number;
  departureTime: string;
};

type GeoResult = {
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
};

type ReverseGeoResult = {
  display_name?: string;
  name?: string;
};

function getCurrentTimeValue() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const roundedMinutes = (Math.round(now.getMinutes() / 5) * 5) % 60;
  const minutes = String(roundedMinutes).padStart(2, '0');
  return `${hours}:${minutes}`;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function getShortPlaceName(label?: string) {
  if (!label) return '현재 위치';
  return label.split(',')[0].trim() || '현재 위치';
}

function formatCoordinate(value?: number) {
  return typeof value === 'number' ? value.toFixed(6) : '';
}

function buildDescriptionValue(description?: string, note?: string) {
  const parts = [description?.trim(), note?.trim()].filter((value): value is string => !!value);
  return [...new Set(parts)].join('\n');
}

function buildEventLabel(event: ItineraryEvent) {
  const time = event.time?.trim() ? `${event.time} · ` : '';
  return `${time}${event.title}`;
}

function findEventIndexByCoordinates(
  events: Array<{ event: ItineraryEvent; index: number }>,
  coordinates?: [number, number]
) {
  if (!coordinates) return -1;
  return events.find((item) => {
    const target = item.event.coordinates;
    return !!target && target[0] === coordinates[0] && target[1] === coordinates[1];
  })?.index ?? -1;
}

export default function AddEventModal({
  initialEvent,
  events = [],
  mode,
  onClose,
  onSave,
  onRequestRoute,
}: Props) {
  const isEditing = mode ? mode === 'edit' : !!initialEvent;
  const hasInitialReservationContent = Boolean(
    initialEvent?.reservation?.label?.trim() ||
    initialEvent?.reservation?.details?.trim() ||
    initialEvent?.attachment
  );

  const [category, setCategory] = useState<EventCategory>(initialEvent?.category ?? 'sightseeing');
  const [time, setTime] = useState(initialEvent?.time ?? getCurrentTimeValue());
  const [title, setTitle] = useState(initialEvent?.title ?? '');
  const [location, setLocation] = useState(initialEvent?.location ?? '');
  const [description, setDescription] = useState(
    buildDescriptionValue(initialEvent?.description, initialEvent?.note)
  );
  const [reservationLabel, setReservationLabel] = useState(initialEvent?.reservation?.label ?? '');
  const [reservationDetails, setReservationDetails] = useState(initialEvent?.reservation?.details ?? '');
  const [lat, setLat] = useState(formatCoordinate(initialEvent?.coordinates?.[0]));
  const [lng, setLng] = useState(formatCoordinate(initialEvent?.coordinates?.[1]));
  const [attachment, setAttachment] = useState<EventAttachment | null>(initialEvent?.attachment ?? null);
  const [showReservationSection, setShowReservationSection] = useState(hasInitialReservationContent);
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoError, setGeoError] = useState('');

  const [query, setQuery] = useState(initialEvent?.location ?? '');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const skipNextSearch = useRef(false);

  const plannerEvents = useMemo(
    () =>
      events
        .map((event, index) => ({ event, index }))
        .filter((item) => !!item.event.coordinates && !item.event.route && !item.event.flight),
    [events]
  );

  const initialFlightOriginIndex = findEventIndexByCoordinates(
    plannerEvents,
    initialEvent?.flight?.originCoordinates
  );
  const initialFlightDestinationIndex = findEventIndexByCoordinates(
    plannerEvents,
    initialEvent?.flight?.destinationCoordinates
  );

  const [routeOriginIndex, setRouteOriginIndex] = useState(plannerEvents[0]?.index ?? -1);
  const [routeDestinationIndex, setRouteDestinationIndex] = useState(plannerEvents[1]?.index ?? -1);

  const [flightMovementMode, setFlightMovementMode] = useState(Boolean(initialEvent?.flight));
  const [flightOriginIndex, setFlightOriginIndex] = useState(
    initialFlightOriginIndex >= 0 ? initialFlightOriginIndex : plannerEvents[0]?.index ?? -1
  );
  const [flightDestinationIndex, setFlightDestinationIndex] = useState(
    initialFlightDestinationIndex >= 0 ? initialFlightDestinationIndex : plannerEvents[1]?.index ?? -1
  );
  const [flightAirline, setFlightAirline] = useState(initialEvent?.flight?.airline ?? '');
  const [flightNumber, setFlightNumber] = useState(initialEvent?.flight?.flightNumber ?? '');
  const [flightDuration, setFlightDuration] = useState(initialEvent?.flight?.durationText ?? '');
  const [flightArrivalTime, setFlightArrivalTime] = useState(initialEvent?.flight?.arrivalTimeText ?? '');
  const [flightBookingReference, setFlightBookingReference] = useState(
    initialEvent?.flight?.bookingReference ?? ''
  );

  const isRouteCategory = category === 'route';
  const isFlightCategory = category === 'flight';
  const isFlightMovement = isFlightCategory && flightMovementMode;
  const plannerDestinationOptions = plannerEvents.filter((item) => item.index > routeOriginIndex);
  const flightDestinationOptions = plannerEvents.filter((item) => item.index > flightOriginIndex);
  const hasEnoughPlannerEvents = plannerEvents.length >= 2;

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ko&q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal, headers: { 'Accept-Language': 'ko' } }
        );
        const data = (await response.json()) as GeoResult[];
        setResults(data);
        setShowResults(true);
      } catch {
        // ignored
      } finally {
        setSearching(false);
      }
    }, 600);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!hasEnoughPlannerEvents) {
      setRouteOriginIndex(-1);
      setRouteDestinationIndex(-1);
      setFlightOriginIndex(-1);
      setFlightDestinationIndex(-1);
      return;
    }

    if (!plannerEvents.some((item) => item.index === routeOriginIndex)) {
      setRouteOriginIndex(plannerEvents[0].index);
      return;
    }

    if (!plannerDestinationOptions.some((item) => item.index === routeDestinationIndex)) {
      setRouteDestinationIndex(plannerDestinationOptions[0]?.index ?? -1);
    }

    if (!plannerEvents.some((item) => item.index === flightOriginIndex)) {
      setFlightOriginIndex(plannerEvents[0].index);
      return;
    }

    if (!flightDestinationOptions.some((item) => item.index === flightDestinationIndex)) {
      setFlightDestinationIndex(flightDestinationOptions[0]?.index ?? -1);
    }
  }, [
    flightDestinationIndex,
    flightDestinationOptions,
    flightOriginIndex,
    hasEnoughPlannerEvents,
    plannerDestinationOptions,
    plannerEvents,
    routeDestinationIndex,
    routeOriginIndex,
  ]);

  const pickResult = (result: GeoResult) => {
    const shortName = getShortPlaceName(result.display_name);
    setLat(parseFloat(result.lat).toFixed(6));
    setLng(parseFloat(result.lon).toFixed(6));
    if (!title.trim()) setTitle(shortName);
    setLocation(shortName);
    skipNextSearch.current = true;
    setQuery(shortName);
    setResults([]);
    setShowResults(false);
    setGeoError('');
  };

  const clearCoords = () => {
    setLat('');
    setLng('');
    setQuery(location.trim());
    setResults([]);
    setShowResults(false);
    setGeoError('');
  };

  const fillCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('이 브라우저에서는 현재 위치를 가져올 수 없습니다.');
      return;
    }

    setGeoLocating(true);
    setGeoError('');

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const nextLat = coords.latitude.toFixed(6);
        const nextLng = coords.longitude.toFixed(6);
        let nextLocation = '현재 위치';

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&lat=${coords.latitude}&lon=${coords.longitude}`,
            { headers: { 'Accept-Language': 'ko' } }
          );

          if (response.ok) {
            const data = (await response.json()) as ReverseGeoResult;
            nextLocation = getShortPlaceName(data.name || data.display_name);
          }
        } catch {
          nextLocation = '현재 위치';
        }

        setLat(nextLat);
        setLng(nextLng);
        setLocation(nextLocation);
        if (!title.trim()) setTitle(nextLocation);
        skipNextSearch.current = true;
        setQuery(nextLocation);
        setResults([]);
        setShowResults(false);
        setGeoLocating(false);
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? '위치 권한이 거부되었습니다.'
            : error.code === error.TIMEOUT
              ? '현재 위치를 가져오는 시간이 초과되었습니다.'
              : '현재 위치를 가져오지 못했습니다.';
        setGeoError(message);
        setGeoLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    );
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({
        name: file.name,
        dataUrl: reader.result as string,
        type: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isRouteCategory) {
      if (!onRequestRoute || !hasEnoughPlannerEvents) return;
      if (routeOriginIndex < 0 || routeDestinationIndex < 0 || routeDestinationIndex <= routeOriginIndex) return;

      onRequestRoute({
        originIndex: routeOriginIndex,
        destinationIndex: routeDestinationIndex,
        departureTime: time.trim() || getCurrentTimeValue(),
      });
      onClose();
      return;
    }

    if (isFlightMovement) {
      if (!hasEnoughPlannerEvents) return;
      if (flightOriginIndex < 0 || flightDestinationIndex < 0 || flightDestinationIndex <= flightOriginIndex) return;
      if (!flightDuration.trim()) return;

      const origin = plannerEvents.find((item) => item.index === flightOriginIndex)?.event;
      const destination = plannerEvents.find((item) => item.index === flightDestinationIndex)?.event;
      if (!origin?.coordinates || !destination?.coordinates) return;

      const airline = flightAirline.trim();
      const number = flightNumber.trim();
      const generatedTitle = [airline, number].filter(Boolean).join(' ') || '항공 이동';
      const generatedDescription = [
        flightDuration.trim() ? `소요 ${flightDuration.trim()}` : null,
        flightArrivalTime.trim() ? `도착 ${flightArrivalTime.trim()}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const event: ItineraryEvent = {
        title: generatedTitle,
        category: 'flight',
        time: time.trim() || getCurrentTimeValue(),
        flight: {
          originTitle: origin.title,
          destinationTitle: destination.title,
          originCoordinates: origin.coordinates,
          destinationCoordinates: destination.coordinates,
          path: [origin.coordinates, destination.coordinates],
          durationText: flightDuration.trim(),
          airline: airline || undefined,
          flightNumber: number || undefined,
          arrivalTimeText: flightArrivalTime.trim() || undefined,
          bookingReference: flightBookingReference.trim() || undefined,
        },
      };

      onSave(event);
      onClose();
      return;
    }

    if (!title.trim()) return;

    const event: ItineraryEvent = {
      title: title.trim(),
      category,
      time: time.trim() || getCurrentTimeValue(),
    };

    if (location.trim() || query.trim()) event.location = location.trim() || query.trim();
    if (description.trim()) event.description = description.trim();
    if (attachment) event.attachment = attachment;

    if (reservationDetails.trim()) {
      event.reservation = {
        label: reservationLabel.trim() || title.trim(),
        details: reservationDetails.trim(),
      };
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
      event.coordinates = [latNum, lngNum];
    }

    onSave(event);
    onClose();
  };

  const hasCoords = lat !== '' && lng !== '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="field">
            <span>카테고리</span>
            <div className="cat-picker">
              {CATEGORY_ORDER.map((key) => {
                const config = CATEGORIES[key];
                const active = category === key;

                return (
                  <button
                    key={key}
                    type="button"
                    className={`cat-chip${active ? ' active' : ''}`}
                    onClick={() => setCategory(key)}
                    style={active ? { background: config.color, borderColor: config.color, color: 'white' } : undefined}
                  >
                    <span>{config.icon}</span> {config.label}
                  </button>
                );
              })}
            </div>
          </div>

          {isFlightCategory && (
            <div className="planner-mode-toggle">
              <button
                type="button"
                className={`planner-mode-btn${!flightMovementMode ? ' is-active' : ''}`}
                onClick={() => setFlightMovementMode(false)}
              >
                일반 항공 일정
              </button>
              <button
                type="button"
                className={`planner-mode-btn${flightMovementMode ? ' is-active' : ''}`}
                onClick={() => setFlightMovementMode(true)}
              >
                항공 이동 선 연결
              </button>
            </div>
          )}

          {isRouteCategory ? (
            <>
              <div className="field-row route-draft-row">
                <label className="field">
                  <span>출발지</span>
                  <select
                    value={routeOriginIndex}
                    onChange={(e) => setRouteOriginIndex(Number(e.target.value))}
                    disabled={!hasEnoughPlannerEvents}
                  >
                    {plannerEvents.map((item) => (
                      <option key={item.index} value={item.index}>
                        {buildEventLabel(item.event)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="field field-time">
                  <span>출발 시간</span>
                  <div className="time-selects">
                    <GlassSelect
                      value={time.split(':')[0] ?? '00'}
                      options={HOUR_OPTIONS}
                      onChange={(h) => setTime(`${h}:${time.split(':')[1] ?? '00'}`)}
                      ariaLabel="시간"
                    />
                    <span className="time-colon">:</span>
                    <GlassSelect
                      value={time.split(':')[1] ?? '00'}
                      options={MINUTE_OPTIONS}
                      onChange={(m) => setTime(`${time.split(':')[0] ?? '00'}:${m}`)}
                      ariaLabel="분"
                    />
                  </div>
                </div>
              </div>

              <label className="field">
                <span>도착지</span>
                <select
                  value={routeDestinationIndex}
                  onChange={(e) => setRouteDestinationIndex(Number(e.target.value))}
                  disabled={!hasEnoughPlannerEvents || plannerDestinationOptions.length === 0}
                >
                  {plannerDestinationOptions.map((item) => (
                    <option key={item.index} value={item.index}>
                      {buildEventLabel(item.event)}
                    </option>
                  ))}
                </select>
              </label>

              {!hasEnoughPlannerEvents ? (
                <p className="field-hint route-draft-hint">
                  좌표가 있는 일반 일정이 2개 이상 있어야 경로를 만들 수 있습니다.
                </p>
              ) : plannerDestinationOptions.length === 0 ? (
                <p className="field-hint route-draft-hint">
                  도착지는 출발지 뒤에 있는 일정만 선택할 수 있습니다.
                </p>
              ) : (
                <p className="field-hint route-draft-hint">
                  다음 단계에서 교통수단과 대체 경로를 고른 뒤 저장합니다.
                </p>
              )}
            </>
          ) : isFlightMovement ? (
            <>
              <div className="field-row route-draft-row">
                <label className="field">
                  <span>출발지</span>
                  <select
                    value={flightOriginIndex}
                    onChange={(e) => setFlightOriginIndex(Number(e.target.value))}
                    disabled={!hasEnoughPlannerEvents}
                  >
                    {plannerEvents.map((item) => (
                      <option key={item.index} value={item.index}>
                        {buildEventLabel(item.event)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="field field-time">
                  <span>출발 시간</span>
                  <div className="time-selects">
                    <GlassSelect
                      value={time.split(':')[0] ?? '00'}
                      options={HOUR_OPTIONS}
                      onChange={(h) => setTime(`${h}:${time.split(':')[1] ?? '00'}`)}
                      ariaLabel="시간"
                    />
                    <span className="time-colon">:</span>
                    <GlassSelect
                      value={time.split(':')[1] ?? '00'}
                      options={MINUTE_OPTIONS}
                      onChange={(m) => setTime(`${time.split(':')[0] ?? '00'}:${m}`)}
                      ariaLabel="분"
                    />
                  </div>
                </div>
              </div>

              <label className="field">
                <span>도착지</span>
                <select
                  value={flightDestinationIndex}
                  onChange={(e) => setFlightDestinationIndex(Number(e.target.value))}
                  disabled={!hasEnoughPlannerEvents || flightDestinationOptions.length === 0}
                >
                  {flightDestinationOptions.map((item) => (
                    <option key={item.index} value={item.index}>
                      {buildEventLabel(item.event)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="field-row flight-draft-grid">
                <label className="field">
                  <span>항공사</span>
                  <input
                    value={flightAirline}
                    onChange={(e) => setFlightAirline(e.target.value)}
                    placeholder="예: Korean Air"
                  />
                </label>
                <label className="field">
                  <span>항공편</span>
                  <input
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value)}
                    placeholder="예: KE964"
                  />
                </label>
              </div>

              <div className="field-row flight-draft-grid">
                <label className="field">
                  <span>소요시간 *</span>
                  <input
                    value={flightDuration}
                    onChange={(e) => setFlightDuration(e.target.value)}
                    placeholder="예: 12시간 30분"
                  />
                </label>
                <label className="field">
                  <span>도착 시간</span>
                  <input
                    value={flightArrivalTime}
                    onChange={(e) => setFlightArrivalTime(e.target.value)}
                    placeholder="예: 18:40"
                  />
                </label>
              </div>

              <label className="field">
                <span>예약 번호</span>
                <input
                  value={flightBookingReference}
                  onChange={(e) => setFlightBookingReference(e.target.value)}
                  placeholder="예: ABC123"
                />
              </label>

              {!hasEnoughPlannerEvents ? (
                <p className="field-hint route-draft-hint">
                  좌표가 있는 일반 일정이 2개 이상 있어야 항공 이동 선을 만들 수 있습니다.
                </p>
              ) : flightDestinationOptions.length === 0 ? (
                <p className="field-hint route-draft-hint">
                  도착지는 출발지 뒤에 있는 일정만 선택할 수 있습니다.
                </p>
              ) : (
                <p className="field-hint route-draft-hint">
                  지도에는 출발지와 도착지를 잇는 직선이 표시되고, 일정 카드에는 항공사, 편명, 소요시간이 저장됩니다.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="field-row">
                <label className="field">
                  <span>제목 *</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="예: 프라하성 방문"
                    autoFocus
                  />
                </label>

                <div className="field field-time">
                  <span>시간</span>
                  <div className="time-selects">
                    <GlassSelect
                      value={time.split(':')[0] ?? '00'}
                      options={HOUR_OPTIONS}
                      onChange={(h) => setTime(`${h}:${time.split(':')[1] ?? '00'}`)}
                      ariaLabel="시간"
                    />
                    <span className="time-colon">:</span>
                    <GlassSelect
                      value={time.split(':')[1] ?? '00'}
                      options={MINUTE_OPTIONS}
                      onChange={(m) => setTime(`${time.split(':')[0] ?? '00'}:${m}`)}
                      ariaLabel="분"
                    />
                  </div>
                </div>
              </div>

              <label className="field">
                <span>설명</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="간단한 메모"
                  rows={2}
                />
              </label>

              <div className="field geo-field">
                <span>위치 검색</span>
                {hasCoords ? (
                  <div className="geo-picked">
                    <span className="geo-picked-text">
                      좌표 설정됨 <small>({lat}, {lng})</small>
                    </span>
                    <button type="button" className="geo-clear" onClick={clearCoords}>
                      변경
                    </button>
                  </div>
                ) : (
                  <div className="geo-search">
                    <div className="geo-search-input-wrap">
                      <input
                        value={query}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setQuery(nextValue);
                          setLocation(nextValue);
                        }}
                        onFocus={() => results.length > 0 && setShowResults(true)}
                        placeholder="주소명을 검색하세요 (예: 프라하성)"
                      />
                      <button
                        type="button"
                        className="field-action-btn"
                        onClick={fillCurrentLocation}
                        disabled={geoLocating}
                        title="현재 위치 가져오기"
                        aria-label="현재 위치 가져오기"
                      >
                        {geoLocating ? '...' : '📍'}
                      </button>
                    </div>
                    {searching && <span className="geo-spinner">검색 중...</span>}
                    {showResults && results.length > 0 && (
                      <ul className="geo-results">
                        {results.map((result, index) => (
                          <li key={index} onClick={() => pickResult(result)}>
                            <strong>{getShortPlaceName(result.display_name)}</strong>
                            <span>{result.display_name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {geoError && <p className="field-error">{geoError}</p>}
              </div>

              <div className="reservation-section">
                <button
                  type="button"
                  className={`reservation-section-toggle${showReservationSection ? ' open' : ''}`}
                  onClick={() => setShowReservationSection((prev) => !prev)}
                >
                  <span>예약 섹션</span>
                  <span className="reservation-section-toggle-icon">{showReservationSection ? '-' : '+'}</span>
                </button>

                {showReservationSection && (
                  <div className="reservation-section-body">
                    <label className="field">
                      <span>예약 이름</span>
                      <input
                        value={reservationLabel}
                        onChange={(e) => setReservationLabel(e.target.value)}
                        placeholder="예: 호텔 / 항공권 / 기차"
                      />
                    </label>

                    <label className="field">
                      <span>예약 정보</span>
                      <textarea
                        value={reservationDetails}
                        onChange={(e) => setReservationDetails(e.target.value)}
                        placeholder="예: 체크인 시간, 예약 번호, 좌석 정보"
                        rows={3}
                      />
                    </label>

                    <p className="field-hint">
                      예약 정보를 입력하면 아래 예약정보 영역에 함께 표시됩니다.
                    </p>

                    <div className="field">
                      <span>첨부 PDF 추가</span>
                      {attachment ? (
                        <div className="attach-chip">
                          <span className="attach-name">파일 {attachment.name}</span>
                          <button type="button" className="attach-remove" onClick={() => setAttachment(null)}>
                            ×
                          </button>
                        </div>
                      ) : (
                        <label className="attach-input">
                          <input
                            type="file"
                            accept="application/pdf,image/*"
                            onChange={handleFile}
                            hidden
                          />
                          <span>파일 선택 (PDF / 이미지)</span>
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              취소
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={
                (isRouteCategory && (!hasEnoughPlannerEvents || routeDestinationIndex < 0)) ||
                (isFlightMovement && (!hasEnoughPlannerEvents || flightDestinationIndex < 0 || !flightDuration.trim()))
              }
            >
              {isRouteCategory ? '경로 찾기' : isEditing ? '수정하기' : '추가하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
