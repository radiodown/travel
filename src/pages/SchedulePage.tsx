import { useState, useRef, useEffect, useCallback } from 'react';
import type { ItineraryDay, ItineraryEvent } from '../data/itinerary';
import MapView from '../components/MapView';
import AddEventModal from '../components/AddEventModal';

type Props = {
  days: ItineraryDay[];
  setDays: React.Dispatch<React.SetStateAction<ItineraryDay[]>>;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
};

const MIN_WIDTH = 280;
const MAX_WIDTH = 620;

export default function SchedulePage({ days, setDays, selectedDayIndex, onSelectDay, onBack }: Props) {
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [resizing, setResizing] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const day = days[selectedDayIndex];

  // Reset selected event when day changes
  useEffect(() => {
    setSelectedEventIndex(null);
  }, [selectedDayIndex]);

  // Scroll active tab into view
  useEffect(() => {
    const el = tabsRef.current?.querySelector('.day-chip.active') as HTMLElement;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedDayIndex]);

  // ── Sidebar resize ──
  const startResize = useCallback(() => setResizing(true), []);

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
  const handleAddEvent = (event: ItineraryEvent) => {
    setDays((prev) =>
      prev.map((d, i) =>
        i === selectedDayIndex ? { ...d, events: [...d.events, event] } : d
      )
    );
  };

  const handleDeleteEvent = (eventIndex: number) => {
    setDays((prev) =>
      prev.map((d, i) =>
        i === selectedDayIndex
          ? { ...d, events: d.events.filter((_, ei) => ei !== eventIndex) }
          : d
      )
    );
    setSelectedEventIndex(null);
  };

  // Build map number for each event (only those with coordinates)
  const mapNumbers: Record<number, number> = {};
  let counter = 1;
  day.events.forEach((e, i) => {
    if (e.coordinates) mapNumbers[i] = counter++;
  });

  return (
    <div className="schedule-page">
      {/* Top nav */}
      <nav className="schedule-nav">
        <button className="back-btn" onClick={onBack} type="button">
          ← 메인으로
        </button>
        <span className="schedule-nav-title">2026 유럽 허니문 · 일정표</span>
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
            <p className="sidebar-day-label">{day.day}</p>
            <h2 className="sidebar-day-title">{day.title}</h2>
            <p className="sidebar-day-date">{day.date}</p>
          </div>

          {/* Event list */}
          <ul className="sidebar-event-list">
            {day.events.map((event, i) => {
              const num = mapNumbers[i];
              const active = selectedEventIndex === i;
              const clickable = !!event.coordinates;
              return (
                <li
                  key={`${event.title}-${i}`}
                  className={`sidebar-event${active ? ' active' : ''}${clickable ? ' clickable' : ''}`}
                  onClick={() => clickable && setSelectedEventIndex(active ? null : i)}
                >
                  <div className={`ev-num${num ? '' : ' ev-num--none'}`}>
                    {num ?? '·'}
                  </div>
                  <div className="ev-info">
                    {event.time && <span className="ev-time">{event.time}</span>}
                    <p className="ev-title">{event.title}</p>
                    {event.location && <p className="ev-loc">📍 {event.location}</p>}
                    {event.description && <p className="ev-desc">{event.description}</p>}
                    {event.note && <p className="ev-note">{event.note}</p>}
                  </div>
                  <button
                    className="ev-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEvent(i);
                    }}
                    title="삭제"
                    type="button"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Add button */}
          <button className="add-event-btn" onClick={() => setShowAddModal(true)} type="button">
            ＋ 일정 추가
          </button>

          {/* Reservations */}
          {!!day.reservations?.length && (
            <div className="sidebar-res">
              <p className="sidebar-res-label">예약 정보</p>
              {day.reservations.map((r, i) => (
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

        {/* ── Map ── */}
        <div className="schedule-map">
          <MapView
            events={day.events}
            selectedIndex={selectedEventIndex}
            onSelectEvent={(i) => setSelectedEventIndex(selectedEventIndex === i ? null : i)}
          />
        </div>
      </div>

      {showAddModal && (
        <AddEventModal onClose={() => setShowAddModal(false)} onAdd={handleAddEvent} />
      )}
    </div>
  );
}
