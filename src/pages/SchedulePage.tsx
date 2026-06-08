import { useState, useRef, useEffect, useCallback } from 'react';
import type { ItineraryDay, ItineraryEvent } from '../data/itinerary';
import { CATEGORIES } from '../data/categories';
import MapView from '../components/MapView';
import AddEventModal from '../components/AddEventModal';
import { parseItineraryJson, serializeItinerary } from '../utils/itineraryJson';

type Props = {
  days: ItineraryDay[];
  setDays: React.Dispatch<React.SetStateAction<ItineraryDay[]>>;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
};

const MIN_WIDTH = 280;
const MAX_WIDTH = 620;

type TransferMessage = {
  kind: 'success' | 'error';
  text: string;
};

function getEventDescription(description?: string, note?: string) {
  const parts = [description?.trim(), note?.trim()].filter((value): value is string => !!value);
  return [...new Set(parts)].join(' · ');
}

export default function SchedulePage({ days, setDays, selectedDayIndex, onSelectDay, onBack }: Props) {
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
  const [editingDayTitle, setEditingDayTitle] = useState(false);
  const [dayTitleDraft, setDayTitleDraft] = useState('');
  const [transferMessage, setTransferMessage] = useState<TransferMessage | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [resizing, setResizing] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const transferMessageTimeoutRef = useRef<number | null>(null);
  const day = days[selectedDayIndex];
  const editingEvent = editingEventIndex !== null ? day.events[editingEventIndex] : null;

  // Reset selected event when day changes
  useEffect(() => {
    setSelectedEventIndex(null);
    setEditingEventIndex(null);
    setShowEventModal(false);
  }, [selectedDayIndex]);

  useEffect(() => {
    setEditingDayTitle(false);
    setDayTitleDraft(day.title);
  }, [day.title, selectedDayIndex]);

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
    };
  }, []);

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
      setSelectedEventIndex(editingEventIndex);
    }
  };

  const openAddModal = () => {
    setEditingEventIndex(null);
    setShowEventModal(true);
  };

  const openEditModal = (eventIndex: number) => {
    setEditingEventIndex(eventIndex);
    setShowEventModal(true);
  };

  const closeEventModal = () => {
    setShowEventModal(false);
    setEditingEventIndex(null);
  };

  const openDayTitleEditor = () => {
    setDayTitleDraft(day.title);
    setEditingDayTitle(true);
  };

  const cancelDayTitleEdit = () => {
    setDayTitleDraft(day.title);
    setEditingDayTitle(false);
  };

  const saveDayTitle = () => {
    const nextTitle = dayTitleDraft.trim();
    if (!nextTitle) {
      cancelDayTitleEdit();
      return;
    }

    if (nextTitle !== day.title) {
      setDays((prev) =>
        prev.map((currentDay, index) =>
          index === selectedDayIndex ? { ...currentDay, title: nextTitle } : currentDay
        )
      );
    }

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
      setSelectedEventIndex(null);
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
    setSelectedEventIndex(null);
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
    setSelectedEventIndex(null);
  };

  const handleDrop = (to: number) => {
    if (dragIndex !== null) handleReorder(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
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
        <span className="schedule-nav-title">2026 Europe · Schedule</span>
        <div className="schedule-nav-tools">
          {transferMessage && (
            <span className={`schedule-transfer-message ${transferMessage.kind}`}>
              {transferMessage.text}
            </span>
          )}
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
            <p className="sidebar-day-label">{day.day}</p>
            <div className="sidebar-day-title-row">
              {editingDayTitle ? (
                <>
                  <input
                    className="sidebar-day-title-input"
                    value={dayTitleDraft}
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
                  <div className="sidebar-day-title-actions">
                    <button
                      className="sidebar-day-title-btn save"
                      onClick={saveDayTitle}
                      title="저장"
                      type="button"
                    >
                      ✓
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
                </>
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
                  onClick={() => clickable && setSelectedEventIndex(active ? null : i)}
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

          {/* Selected place toast */}
          {selectedEventIndex !== null && day.events[selectedEventIndex] && (() => {
            const ev = day.events[selectedEventIndex];
            const cat = ev.category ? CATEGORIES[ev.category] : null;
            const eventDescription = getEventDescription(ev.description, ev.note);
            return (
              <div className="map-toast">
                <div
                  className="map-toast-accent"
                  style={{ background: cat?.color ?? '#4f46e5' }}
                />
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
                  onClick={() => setSelectedEventIndex(null)}
                  type="button"
                >
                  ×
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {showEventModal && (
        <AddEventModal
          initialEvent={editingEvent}
          onClose={closeEventModal}
          onSave={handleSaveEvent}
        />
      )}
    </div>
  );
}
