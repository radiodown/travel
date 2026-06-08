import { useEffect, useRef, useState } from 'react';
import type { EventAttachment, ItineraryEvent } from '../data/itinerary';
import { CATEGORIES, CATEGORY_ORDER, type EventCategory } from '../data/categories';

type Props = {
  initialEvent?: ItineraryEvent | null;
  onClose: () => void;
  onSave: (event: ItineraryEvent) => void;
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
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

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

export default function AddEventModal({ initialEvent, onClose, onSave }: Props) {
  const isEditing = !!initialEvent;
  const [category, setCategory] = useState<EventCategory>(initialEvent?.category ?? 'sightseeing');
  const [time, setTime] = useState(initialEvent?.time ?? getCurrentTimeValue());
  const [title, setTitle] = useState(initialEvent?.title ?? '');
  const [location, setLocation] = useState(initialEvent?.location ?? '');
  const [description, setDescription] = useState(buildDescriptionValue(initialEvent?.description, initialEvent?.note));
  const [lat, setLat] = useState(formatCoordinate(initialEvent?.coordinates?.[0]));
  const [lng, setLng] = useState(formatCoordinate(initialEvent?.coordinates?.[1]));
  const [attachment, setAttachment] = useState<EventAttachment | null>(initialEvent?.attachment ?? null);
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoError, setGeoError] = useState('');

  const [query, setQuery] = useState(initialEvent?.location ?? '');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const skipNextSearch = useRef(false);

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ko&q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal, headers: { 'Accept-Language': 'ko' } }
        );
        const data = (await res.json()) as GeoResult[];
        setResults(data);
        setShowResults(true);
      } catch {
        /* aborted or failed */
      } finally {
        setSearching(false);
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

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
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&lat=${coords.latitude}&lon=${coords.longitude}`,
            { headers: { 'Accept-Language': 'ko' } }
          );

          if (res.ok) {
            const data = (await res.json()) as ReverseGeoResult;
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
    if (!title.trim()) return;

    const event: ItineraryEvent = {
      title: title.trim(),
      category,
      time: time.trim() || getCurrentTimeValue(),
    };

    if (location.trim() || query.trim()) event.location = location.trim() || query.trim();
    if (description.trim()) event.description = description.trim();
    if (attachment) event.attachment = attachment;

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
        <div className="modal-header">
          <h3>{isEditing ? '일정 수정' : '일정 추가'}</h3>
          <button className="modal-close" onClick={onClose} type="button">×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="field">
            <span>카테고리</span>
            <div className="cat-picker">
              {CATEGORY_ORDER.map((key) => {
                const c = CATEGORIES[key];
                const active = category === key;

                return (
                  <button
                    key={key}
                    type="button"
                    className={`cat-chip${active ? ' active' : ''}`}
                    onClick={() => setCategory(key)}
                    style={active ? { background: c.color, borderColor: c.color, color: 'white' } : undefined}
                  >
                    <span>{c.icon}</span> {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="field">
            <span>제목 *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 프라하 성 방문"
              autoFocus
            />
          </label>

          <label className="field">
            <span>시간</span>
            <input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="비워두면 현재 시각"
            />
          </label>

          <p className="field-hint">
            시간을 비우면 현재 시각이 저장됩니다.
          </p>

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
                  ✓ 좌표 설정됨 <small>({lat}, {lng})</small>
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
                    placeholder="장소명을 검색하세요 (예: 프라하 성)"
                  />
                  <button
                    type="button"
                    className="field-action-btn"
                    onClick={fillCurrentLocation}
                    disabled={geoLocating}
                    title="현재 위치 가져오기"
                    aria-label="현재 위치 가져오기"
                  >
                    {geoLocating ? '…' : '📍'}
                  </button>
                </div>
                {searching && <span className="geo-spinner">검색 중…</span>}
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
            <p className="field-hint">검색창에서 장소를 입력하거나 GPS 아이콘을 눌러 현재 위치와 좌표를 설정할 수 있습니다.</p>
            {geoError && <p className="field-error">{geoError}</p>}
          </div>

          <div className="field">
            <span>티켓 / PDF 첨부</span>
            {attachment ? (
              <div className="attach-chip">
                <span className="attach-name">📎 {attachment.name}</span>
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
                <span>＋ 파일 선택 (PDF / 이미지)</span>
              </label>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>취소</button>
            <button type="submit" className="btn-primary">{isEditing ? '수정하기' : '추가하기'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
