import { useState, useRef, useEffect, useCallback } from 'react';
import type { ItineraryDay, ItineraryEvent } from '../data/itinerary';
import { CATEGORIES } from '../data/categories';
import MapView from '../components/MapView';
import AddEventModal from '../components/AddEventModal';
import { parseItineraryJson, serializeItinerary } from '../utils/itineraryJson';
import { getDayReservationItems } from '../utils/reservations';
import { useDaysWeather } from '../hooks/useDaysWeather';
import { geocodeCity } from '../utils/weather';

type Props = {
  days: ItineraryDay[];
  setDays: React.Dispatch<React.SetStateAction<ItineraryDay[]>>;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
};

const MIN_WIDTH = 280;
const MAX_WIDTH = 620;
const MAP_CLEAN_MODE_STORAGE_KEY = 'travel-map-clean-mode';

type TransferMessage = {
  kind: 'success' | 'error';
  text: string;
};

type ToastMotion = 'default' | 'next' | 'prev';

function getEventDescription(description?: string, note?: string) {
  const parts = [description?.trim(), note?.trim()].filter((value): value is string => !!value);
  return [...new Set(parts)].join(' · ');
}

export default function SchedulePage({ days, setDays, selectedDayIndex, onSelectDay, onBack }: Props) {
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [toastMotion, setToastMotion] = useState<ToastMotion>('default');
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
  const [editingDayTitle, setEditingDayTitle] = useState(false);
  const [dayTitleDraft, setDayTitleDraft] = useState('');
  const [cityDraft, setCityDraft] = useState('');
  const [savingCity, setSavingCity] = useState(false);
  const [transferMessage, setTransferMessage] = useState<TransferMessage | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [resizing, setResizing] = useState(false);
  const [cleanMapMode, setCleanMapMode] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(MAP_CLEAN_MODE_STORAGE_KEY) !== 'false';
  });
  const [draftEvent, setDraftEvent] = useState<ItineraryEvent | null>(null);
  // Below this width the sidebar stacks on top instead of on the left,
  // so no horizontal offset is needed for centering in the visible area.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const transferMessageTimeoutRef = useRef<number | null>(null);
  const toastTouchStartX = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const day = days[selectedDayIndex];
  const editingEvent = editingEventIndex !== null ? day.events[editingEventIndex] : null;
  const daysWeather = useDaysWeather(days);

  const selectEvent = useCallback((index: number | null, motion: ToastMotion = 'default') => {
    setToastMotion(motion);
    setSelectedEventIndex(index);
  }, []);

  // Reset selected event when day changes
  useEffect(() => {
    selectEvent(null);
    setEditingEventIndex(null);
    setDraftEvent(null);
    setShowEventModal(false);
  }, [selectEvent, selectedDayIndex]);

  useEffect(() => {
    setEditingDayTitle(false);
    setDayTitleDraft(day.title);
    setCityDraft(day.city ?? '');
  }, [day.title, day.city, selectedDayIndex]);

  // Scroll active tab into view
  useEffect(() => {
    const el = tabsRef.current?.querySelector('.day-chip.active') as HTMLElement;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedDayIndex]);

  useEffect(() => {
    return () => {
      if (transferMessageTimeoutRef.current !== null) {
        window.clearTimeout(transferMessageTimeoutRef.current);
      }
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MAP_CLEAN_MODE_STORAGE_KEY, String(cleanMapMode));
  }, [cleanMapMode]);

  // Track whether the sidebar is stacked (narrow) or on the left (wide)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Center selected place / toast within the visible map area (right of sidebar)
  const visibleOffsetX = isNarrow ? 0 : sidebarWidth / 2;

  // ── Sidebar resize ──
  const startResize = useCallback(() => setResizing(true), []);

  const showTransferStatus = useCallback((kind: TransferMessage['kind'], text: string) => {
    setTransferMessage({ kind, text });

    if (transferMessageTimeoutRef.current !== null) {
      window.clearTimeout(transferMessageTimeoutRef.current);
    }

    transferMessageTimeoutRef.current = window.setTimeout(() => {
      setTransferMessage(null);
      transferMessageTimeoutRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setSidebarWidth(w);
    };
    const onUp = () => setResizing(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  // ── Add / delete events ──
  const handleSaveEvent = (event: ItineraryEvent) => {
    setDays((prev) =>
      prev.map((d, i) =>
        i === selectedDayIndex
          ? {
              ...d,
              events:
                editingEventIndex === null
                  ? [...d.events, event]
                  : d.events.map((existingEvent, ei) => (ei === editingEventIndex ? event : existingEvent)),
            }
          : d
      )
    );

    if (editingEventIndex !== null) {
      selectEvent(editingEventIndex);
    }

    setDraftEvent(null);
  };

  const openAddModal = () => {
    setEditingEventIndex(null);
    setDraftEvent(null);
    setShowEventModal(true);
  };

  const openEditModal = (eventIndex: number) => {
    setDraftEvent(null);
    setEditingEventIndex(eventIndex);
    setShowEventModal(true);
  };

  const closeEventModal = () => {
    setShowEventModal(false);
    setEditingEventIndex(null);
    setDraftEvent(null);
  };

  const handleAddLocationFromMap = (event: ItineraryEvent) => {
    selectEvent(null);
    setDraftEvent(event);
    setEditingEventIndex(null);
    setShowEventModal(true);
  };

  const openDayTitleEditor = () => {
    setDayTitleDraft(day.title);
    setCityDraft(day.city ?? '');
    setEditingDayTitle(true);
  };

  const cancelDayTitleEdit = () => {
    setDayTitleDraft(day.title);
    setCityDraft(day.city ?? '');
    setEditingDayTitle(false);
  };

  const saveDayTitle = async () => {
    const nextTitle = dayTitleDraft.trim();
    if (!nextTitle) {
      cancelDayTitleEdit();
      return;
    }

    const nextCity = cityDraft.trim();
    const cityChanged = nextCity !== (day.city ?? '');

    // Resolve the city to coordinates so the weather badge can use it.
    let cityCoordinates = day.cityCoordinates;
    if (cityChanged) {
      if (!nextCity) {
        cityCoordinates = undefined;
      } else {
        setSavingCity(true);
        try {
          cityCoordinates = (await geocodeCity(nextCity)) ?? undefined;
          if (!cityCoordinates) {
            showTransferStatus('error', `'${nextCity}' 위치를 찾지 못했습니다. 날씨는 기존 기준을 사용합니다.`);
          }
        } catch {
          cityCoordinates = undefined;
          showTransferStatus('error', '도시 위치 조회에 실패했습니다.');
        } finally {
          setSavingCity(false);
        }
      }
    }

    setDays((prev) =>
      prev.map((currentDay, index) =>
        index === selectedDayIndex
          ? {
              ...currentDay,
              title: nextTitle,
              city: nextCity || undefined,
              cityCoordinates,
            }
          : currentDay
      )
    );

    setEditingDayTitle(false);
  };

  const handleExportJson = () => {
    try {
      const json = serializeItinerary(days);
      const blob = new Blob([json], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);

      link.href = url;
      link.download = `travel-itinerary-${today}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      showTransferStatus('success', '일정 JSON을 내보냈습니다.');
    } catch {
      showTransferStatus('error', '일정 JSON 내보내기에 실패했습니다.');
    }
  };

  const openImportJson = () => {
    importInputRef.current?.click();
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedDays = parseItineraryJson(text);

      setDays(importedDays);
      onSelectDay(0);
      selectEvent(null);
      setEditingEventIndex(null);
      setShowEventModal(false);
      showTransferStatus('success', `${importedDays.length}일 일정 데이터를 불러왔습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '일정 JSON 불러오기에 실패했습니다.';
      showTransferStatus('error', message);
    } finally {
      e.target.value = '';
    }
  };

  const handleDeleteEvent = (eventIndex: number) => {
    setDays((prev) =>
      prev.map((d, i) =>
        i === selectedDayIndex
          ? { ...d, events: d.events.filter((_, ei) => ei !== eventIndex) }
          : d
      )
    );
    selectEvent(null);
  };

  // ── Reorder events (drag & drop) ──
  const handleReorder = (from: number, to: number) => {
    if (from === to) return;
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== selectedDayIndex) return d;
        const events = [...d.events];
        const [moved] = events.splice(from, 1);
        events.splice(to, 0, moved);
        return { ...d, events };
      })
    );
    selectEvent(null);
  };

  const handleDrop = (to: number) => {
    if (dragIndex !== null) handleReorder(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  };

  // ── Swipe between mappable events (mobile toast) ──
  const goToAdjacentEvent = (dir: 1 | -1) => {
    const selectable = day.events.flatMap((e, i) => (e.coordinates ? [i] : []));
    if (selectable.length === 0) return;
    const cur = selectedEventIndex !== null ? selectable.indexOf(selectedEventIndex) : -1;
    const next = cur === -1 ? 0 : (cur + dir + selectable.length) % selectable.length;
    const nextIndex = selectable[next];
    if (nextIndex === selectedEventIndex) return;
    selectEvent(nextIndex, dir === 1 ? 'next' : 'prev');
  };

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const startLongPress = () => {
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      if (selectedEventIndex !== null) openEditModal(selectedEventIndex);
    }, 500);
  };

  const handleToastTouchStart = (e: React.TouchEvent) => {
    toastTouchStartX.current = e.touches[0].clientX;
    startLongPress();
  };

  const handleToastTouchMove = (e: React.TouchEvent) => {
    // Any meaningful movement means it's a swipe, not a long press
    if (toastTouchStartX.current === null) return;
    if (Math.abs(e.touches[0].clientX - toastTouchStartX.current) > 10) clearLongPress();
  };

  const handleToastTouchEnd = (e: React.TouchEvent) => {
    clearLongPress();
    if (longPressFired.current) {
      longPressFired.current = false;
      toastTouchStartX.current = null;
      return; // edit already opened
    }
    if (toastTouchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - toastTouchStartX.current;
    toastTouchStartX.current = null;
    if (Math.abs(dx) < 40) return; // ignore taps / tiny moves
    goToAdjacentEvent(dx < 0 ? 1 : -1); // swipe left → next, right → previous
  };

  // Mouse long-press (desktop): hold the toast to edit
  const handleToastMouseDown = () => startLongPress();
  const handleToastMouseUp = () => clearLongPress();
  const handleToastMouseLeave = () => clearLongPress();

  // Build map number for each event (only those with coordinates)
  const mapNumbers: Record<number, number> = {};
  let counter = 1;
  day.events.forEach((e, i) => {
    if (e.coordinates) mapNumbers[i] = counter++;
  });
  const reservationItems = getDayReservationItems(day);

  return (
    <div className="schedule-page">
      {/* Full-bleed map background */}
      <div className="schedule-map">
        <MapView
          events={day.events}
          selectedIndex={selectedEventIndex}
          onSelectEvent={(i) => selectEvent(selectedEventIndex === i ? null : i)}
          cleanMode={cleanMapMode}
          onAddLocation={handleAddLocationFromMap}
          visibleOffsetX={visibleOffsetX}
        />

        {/* Selected place toast */}
        {selectedEventIndex !== null && day.events[selectedEventIndex] && (() => {
          const ev = day.events[selectedEventIndex];
          const cat = ev.category ? CATEGORIES[ev.category] : null;
          const eventDescription = getEventDescription(ev.description, ev.note);
          return (
            <div
              key={`${selectedEventIndex}-${toastMotion}`}
              className={`map-toast toast-motion-${toastMotion}`}
              style={{ ['--toast-shift' as string]: `${visibleOffsetX}px` } as React.CSSProperties}
              onTouchStart={handleToastTouchStart}
              onTouchMove={handleToastTouchMove}
              onTouchEnd={handleToastTouchEnd}
              onTouchCancel={handleToastMouseUp}
              onMouseDown={handleToastMouseDown}
              onMouseUp={handleToastMouseUp}
              onMouseLeave={handleToastMouseLeave}
            >
              <div className="map-toast-body">
                <div className="map-toast-top">
                  {cat && (
                    <span
                      className="map-toast-cat"
                      style={{ background: cat.light, color: cat.color }}
                    >
                      {cat.icon} {cat.label}
                    </span>
                  )}
                  {ev.time && <span className="map-toast-time">{ev.time}</span>}
                </div>
                <h4 className="map-toast-title">{ev.title}</h4>
                {ev.location && <p className="map-toast-loc">📍 {ev.location}</p>}
                {eventDescription && <p className="map-toast-desc">{eventDescription}</p>}
                {ev.attachment && (
                  <div className="map-toast-actions">
                    <a
                      className="map-toast-attach"
                      href={ev.attachment.dataUrl}
                      download={ev.attachment.name}
                      target="_blank"
                      rel="noreferrer"
                    >
                      📎 {ev.attachment.name} 열기
                    </a>
                  </div>
                )}
              </div>
              <button
                className="map-toast-close"
                onClick={() => selectEvent(null)}
                type="button"
              >
                ×
              </button>
            </div>
          );
        })()}
      </div>

      {/* Top nav */}
      <nav className="schedule-nav">
        <span className="schedule-nav-title">2026 Europe · Schedule</span>
        <div className="schedule-nav-tools">
          {transferMessage && (
            <span className={`schedule-transfer-message ${transferMessage.kind}`}>
              {transferMessage.text}
            </span>
          )}
          <button
            className={`schedule-map-mode-btn${cleanMapMode ? ' is-active' : ''}`}
            onClick={() => setCleanMapMode((prev) => !prev)}
            title={cleanMapMode ? '기본 지도 보기' : '클린 맵 보기'}
            aria-pressed={cleanMapMode}
            type="button"
          >
            <span className="schedule-map-mode-label">Map</span>
            <span className="schedule-map-mode-value">{cleanMapMode ? 'Clean' : 'Default'}</span>
          </button>
          <button
            className="schedule-icon-btn schedule-add-btn"
            onClick={openAddModal}
            title="일정 추가"
            aria-label="일정 추가"
            type="button"
          >
            ＋
          </button>
          <button
            className="schedule-icon-btn"
            onClick={handleExportJson}
            title="JSON 내보내기"
            aria-label="JSON 내보내기"
            type="button"
          >
            ⤓
          </button>
          <button
            className="schedule-icon-btn"
            onClick={openImportJson}
            title="JSON 불러오기"
            aria-label="JSON 불러오기"
            type="button"
          >
            ⤒
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJson}
            hidden
          />
        </div>
      </nav>

      {/* Sidebar + Map */}
      <div className="schedule-layout">
        {/* ── Left Sidebar ── */}
        <aside className="schedule-sidebar" style={{ width: sidebarWidth }}>
          {/* Day chip tabs */}
          <div className="sidebar-tabs-wrap">
            <div className="sidebar-tabs" ref={tabsRef}>
              {days.map((d, i) => (
                <button
                  key={d.day}
                  className={`day-chip${i === selectedDayIndex ? ' active' : ''}`}
                  onClick={() => onSelectDay(i)}
                  type="button"
                >
                  {d.day}
                </button>
              ))}
            </div>
          </div>

          {/* Day header */}
          <div className="sidebar-day-header">
            <div className="sidebar-day-label-row">
              <p className="sidebar-day-label">{day.day}</p>
              {daysWeather[selectedDayIndex] && (
                <span className="day-weather" aria-hidden="true">
                  <span
                    className="dw-half"
                    title={`오전${daysWeather[selectedDayIndex].am.temp !== null ? ` ${daysWeather[selectedDayIndex].am.temp}°` : ''}`}
                  >
                    {daysWeather[selectedDayIndex].am.icon}
                    {daysWeather[selectedDayIndex].am.temp !== null && (
                      <span className="dw-temp">{daysWeather[selectedDayIndex].am.temp}°</span>
                    )}
                  </span>
                  <span
                    className="dw-half"
                    title={`오후${daysWeather[selectedDayIndex].pm.temp !== null ? ` ${daysWeather[selectedDayIndex].pm.temp}°` : ''}`}
                  >
                    {daysWeather[selectedDayIndex].pm.icon}
                    {daysWeather[selectedDayIndex].pm.temp !== null && (
                      <span className="dw-temp">{daysWeather[selectedDayIndex].pm.temp}°</span>
                    )}
                  </span>
                </span>
              )}
            </div>
            <div className="sidebar-day-title-row">
              {editingDayTitle ? (
                <div className="sidebar-day-edit">
                  <div className="sidebar-day-edit-fields">
                    <input
                      className="sidebar-day-title-input"
                      value={dayTitleDraft}
                      placeholder="일자 제목"
                      onChange={(e) => setDayTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveDayTitle();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelDayTitleEdit();
                        }
                      }}
                      autoFocus
                    />
                    <input
                      className="sidebar-day-city-input"
                      value={cityDraft}
                      placeholder="🌤 날씨 기준 도시 (예: 프라하)"
                      onChange={(e) => setCityDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveDayTitle();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelDayTitleEdit();
                        }
                      }}
                    />
                  </div>
                  <div className="sidebar-day-title-actions">
                    <button
                      className="sidebar-day-title-btn save"
                      onClick={saveDayTitle}
                      title="저장"
                      type="button"
                      disabled={savingCity}
                    >
                      {savingCity ? '…' : '✓'}
                    </button>
                    <button
                      className="sidebar-day-title-btn cancel"
                      onClick={cancelDayTitleEdit}
                      title="취소"
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="sidebar-day-title">{day.title}</h2>
                  <button
                    className="sidebar-day-title-edit"
                    onClick={openDayTitleEditor}
                    title="일자 제목 수정"
                    type="button"
                  >
                    ✎
                  </button>
                </>
              )}
            </div>
            <p className="sidebar-day-date">{day.date}</p>
          </div>

          {/* Event list */}
          <ul className="sidebar-event-list">
            {day.events.map((event, i) => {
              const num = mapNumbers[i];
              const active = selectedEventIndex === i;
              const clickable = !!event.coordinates;
              const eventDescription = getEventDescription(event.description, event.note);
              return (
                <li
                  key={`${event.title}-${i}`}
                  className={
                    `sidebar-event${active ? ' active' : ''}${clickable ? ' clickable' : ''}` +
                    `${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== i ? ' drag-over' : ''}`
                  }
                  onClick={() => clickable && selectEvent(active ? null : i)}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnter={() => setOverIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(i);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  <span className="ev-drag" title="드래그하여 순서 변경">⠿</span>
                  <div className={`ev-num${num ? '' : ' ev-num--none'}`}>
                    {num ?? '·'}
                  </div>
                  <div className="ev-info">
                    <div className="ev-meta-row">
                      {event.time && <span className="ev-time">{event.time}</span>}
                      {event.category && (
                        <span
                          className="ev-cat"
                          style={{
                            background: CATEGORIES[event.category].light,
                            color: CATEGORIES[event.category].color,
                          }}
                        >
                          {CATEGORIES[event.category].icon} {CATEGORIES[event.category].label}
                        </span>
                      )}
                    </div>
                    <p className="ev-title">{event.title}</p>
                    {event.location && <p className="ev-loc">📍 {event.location}</p>}
                    {eventDescription && <p className="ev-desc">{eventDescription}</p>}
                    {event.attachment && (
                      <a
                        className="ev-attach"
                        href={event.attachment.dataUrl}
                        download={event.attachment.name}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        📎 {event.attachment.name}
                      </a>
                    )}
                  </div>
                  <div className="ev-actions">
                    <button
                      className="ev-action-btn ev-edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(i);
                      }}
                      title="수정"
                      type="button"
                    >
                      ✎
                    </button>
                    <button
                      className="ev-action-btn ev-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteEvent(i);
                      }}
                      title="삭제"
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Add button */}
          <button className="add-event-btn" onClick={openAddModal} type="button">
            ＋ 일정 추가
          </button>

          {/* Reservations */}
          {!!reservationItems.length && (
            <div className="sidebar-res">
              <p className="sidebar-res-label">예약 정보</p>
              {reservationItems.map((r, i) => (
                <div key={i} className="res-item">
                  <p className="res-label">{r.label}</p>
                  <p className="res-details">{r.details}</p>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Resize handle */}
        <div
          className={`resize-handle${resizing ? ' resizing' : ''}`}
          onMouseDown={startResize}
        />
      </div>

      {showEventModal && (
        <AddEventModal
          initialEvent={draftEvent ?? editingEvent}
          mode={editingEventIndex !== null ? 'edit' : 'create'}
          onClose={closeEventModal}
          onSave={handleSaveEvent}
        />
      )}
    </div>
  );
}
