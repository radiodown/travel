import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type { ItineraryDay, ItineraryEvent, SavedFlight, SavedRoute } from '../data/itinerary';
import { CATEGORIES, CATEGORY_ORDER, type EventCategory } from '../data/categories';
import MapView from '../components/MapView';
import AddEventModal, { type RouteDraftRequest } from '../components/AddEventModal';
import RoutePickerModal from '../components/RoutePickerModal';
import {
  fetchRouteOptions,
  formatDistanceFromMeters,
  type RouteOption,
  type RouteSearchOptions,
  type TravelModeKey,
} from '../utils/directions';
import { parseItineraryJson, serializeItinerary } from '../utils/itineraryJson';
import { getDayReservationItems } from '../utils/reservations';
import { useDaysWeather } from '../hooks/useDaysWeather';
import { geocodeCity } from '../utils/weather';
import { getAirportCodeLabel } from '../utils/airports';

type Props = {
  days: ItineraryDay[];
  setDays: Dispatch<SetStateAction<ItineraryDay[]>>;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
};

const MIN_WIDTH = 280;
const MAX_WIDTH = 620;
const MAP_CLEAN_MODE_STORAGE_KEY = 'travel-map-clean-mode';
const ALL_DAYS_INDEX = -1;
const EMPTY_DAY: ItineraryDay = {
  day: '',
  title: '',
  date: '',
  summary: '',
  events: [],
};

type TransferMessage = {
  kind: 'success' | 'error';
  text: string;
};

type ToastMotion = 'default' | 'next' | 'prev';
type CategoryFilter = EventCategory | 'all';

type DisplayEventEntry = {
  event: ItineraryEvent;
  index: number;
  dayIndex: number;
  day: ItineraryDay;
  eventIndex: number;
};

type EventContextRouteAction = {
  label: '경로 추가' | '경로 다시 찾기';
  kind: 'create' | 'edit';
  draft?: {
    originIndex: number;
    destinationIndex: number;
    departureTime: string;
  };
};

type EventContextMenu = {
  eventIndex: number;
  x: number;
  y: number;
  mode: 'actions' | 'move';
  routeAction: EventContextRouteAction | null;
};

type RoutePickerState = {
  originIndex: number;
  destinationIndex: number;
  originTitle: string;
  destinationTitle: string;
  originCoordinates: [number, number];
  destinationCoordinates: [number, number];
  replaceIndex: number | null;
  mode: TravelModeKey;
  departureTime: string;
  transitPreference: 'FEWER_TRANSFERS' | 'LESS_WALKING';
  loading: boolean;
  error: string | null;
  options: RouteOption[];
};

function getEventDescription(description?: string, note?: string) {
  const parts = [description?.trim(), note?.trim()].filter((value): value is string => !!value);
  return [...new Set(parts)].join(' · ');
}

function getRoundedTimeValue(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const roundedMinutes = (Math.round(date.getMinutes() / 5) * 5) % 60;
  const minutes = String(roundedMinutes).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getInitialRouteDepartureTime(event?: ItineraryEvent) {
  return event?.time && /^\d{2}:\d{2}$/.test(event.time) ? event.time : getRoundedTimeValue();
}

function getDateRangeLabel(days: ItineraryDay[]) {
  const firstDate = days[0]?.date;
  const lastDate = days[days.length - 1]?.date;
  if (!firstDate) return '';
  return lastDate && lastDate !== firstDate ? `${firstDate} - ${lastDate}` : firstDate;
}

function toLocalDateTime(date: string, time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) return undefined;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

function isRouteEvent(event: ItineraryEvent): event is ItineraryEvent & { route: SavedRoute } {
  return !!event.route && event.route.path.length > 0;
}

function isFlightMovementEvent(event: ItineraryEvent): event is ItineraryEvent & { flight: SavedFlight } {
  return !!event.flight && event.flight.path.length > 1;
}

function isRoutePointEvent(event: ItineraryEvent) {
  return !!event.coordinates && !isRouteEvent(event) && !isFlightMovementEvent(event);
}

function isSelectableEvent(event: ItineraryEvent) {
  return !!event.coordinates || isRouteEvent(event) || isFlightMovementEvent(event);
}

function getRouteWalkingDistanceText(route: SavedRoute) {
  if (route.walkingDistanceText) return route.walkingDistanceText;

  const walkingMeters = route.segments
    .filter((segment) => segment.mode === 'WALKING')
    .reduce((sum, segment) => sum + segment.distanceValue, 0);

  return walkingMeters > 0 ? formatDistanceFromMeters(walkingMeters) : undefined;
}

function getRouteWalkingLabel(route: SavedRoute) {
  const walking = [route.walkingDurationText, getRouteWalkingDistanceText(route)].filter(Boolean).join(' · ');
  return walking ? `도보 ${walking}` : null;
}

function getRouteSummaryText(route: SavedRoute) {
  const transferLabel =
    route.mode === 'TRANSIT'
      ? route.transferCount > 0
        ? `환승 ${route.transferCount}회`
        : '직행'
      : null;
  const walking = getRouteWalkingLabel(route);
  const timing =
    route.departureText && route.arrivalText ? `${route.departureText} - ${route.arrivalText}` : null;
  return [route.durationText, transferLabel, walking, timing].filter(Boolean).join(' · ');
}

function getRouteTransfersPreview(route: SavedRoute) {
  return route.transfers.slice(0, 3);
}

function getRouteWidgetTitle(route: SavedRoute) {
  if (route.mode === 'TRANSIT' && route.transitLines.length > 0) {
    const lines = route.transitLines.slice(0, 3);
    return route.transitLines.length > 3
      ? `${lines.join(' · ')} +${route.transitLines.length - 3}`
      : lines.join(' · ');
  }

  return `${route.modeIcon} ${route.modeLabel}`;
}

function getRouteWidgetSummary(route: SavedRoute) {
  const parts = [route.durationText];

  if (route.mode === 'TRANSIT') {
    parts.push(route.transferCount > 0 ? `환승 ${route.transferCount}회` : '직행');
    const walking = getRouteWalkingLabel(route);
    if (walking) parts.push(walking);
  } else if (route.distanceText) {
    parts.push(route.distanceText);
  }

  if (route.departureText && route.arrivalText) {
    parts.push(`${route.departureText} - ${route.arrivalText}`);
  }

  return parts.join(' · ');
}

function isSameRouteQuery(
  current: RoutePickerState,
  snapshot: Pick<
    RoutePickerState,
    'originIndex' | 'destinationIndex' | 'mode' | 'departureTime' | 'transitPreference' | 'replaceIndex'
  >
) {
  return (
    current.originIndex === snapshot.originIndex &&
    current.destinationIndex === snapshot.destinationIndex &&
    current.mode === snapshot.mode &&
    current.departureTime === snapshot.departureTime &&
    current.transitPreference === snapshot.transitPreference &&
    current.replaceIndex === snapshot.replaceIndex
  );
}

function getRouteMetaLabels(route: SavedRoute) {
  const labels = [`${route.modeIcon} ${route.modeLabel}`, route.durationText];
  if (route.mode === 'TRANSIT') {
    labels.push(route.transferCount > 0 ? `환승 ${route.transferCount}회` : '직행');
  }
  const walking = getRouteWalkingLabel(route);
  if (walking) labels.push(walking);
  return labels;
}

function getFlightEndpointLabels(flight: SavedFlight) {
  return {
    origin: getAirportCodeLabel(flight.originTitle, undefined, flight.originCoordinates),
    destination: getAirportCodeLabel(flight.destinationTitle, undefined, flight.destinationCoordinates),
  };
}

function getCompactTimeLabel(value?: string) {
  const text = value?.trim();
  if (!text) return null;

  const periodMatch = text.match(/^(오전|오후)\s*(\d{1,2})(?::|시\s*)(\d{1,2})?/);
  if (periodMatch) {
    const period = periodMatch[1];
    let hour = Number(periodMatch[2]);
    const minute = Number(periodMatch[3] ?? 0);

    if (period === '오전' && hour === 12) hour = 0;
    if (period === '오후' && hour < 12) hour += 12;

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const timeMatch = text.match(/^(\d{1,2})(?::|시\s*)(\d{1,2})?/);
  if (timeMatch) {
    return `${String(Number(timeMatch[1])).padStart(2, '0')}:${String(Number(timeMatch[2] ?? 0)).padStart(2, '0')}`;
  }

  return text;
}

function getCompactDurationLabel(value: string) {
  const text = value.trim();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:시간|h|hr|hour)/i);
  const minuteMatch = text.match(/(\d+)\s*(?:분|m|min|minute)/i);
  const parts: string[] = [];

  if (hourMatch) parts.push(`${hourMatch[1]}H`);
  if (minuteMatch) parts.push(`${minuteMatch[1]}M`);

  return parts.length > 0 ? parts.join(' ') : text;
}

function getFlightScheduleText(flight: SavedFlight, departureTime?: string) {
  const endpoints = getFlightEndpointLabels(flight);
  const departure = getCompactTimeLabel(departureTime);
  const arrival = getCompactTimeLabel(flight.arrivalTimeText);
  const duration = getCompactDurationLabel(flight.durationText);
  const origin = departure ? `${endpoints.origin} (${departure})` : endpoints.origin;
  const destination = arrival ? `${endpoints.destination} (${arrival})` : endpoints.destination;

  return duration ? `${origin} → ${duration} → ${destination}` : `${origin} → ${destination}`;
}

function getRouteEditorState(routeEventIndex: number, events: ItineraryEvent[]) {
  const previous = [...events.slice(0, routeEventIndex)]
    .reverse()
    .find((event) => !!event.coordinates && !isRouteEvent(event));
  const next = events
    .slice(routeEventIndex + 1)
    .find((event) => !!event.coordinates && !isRouteEvent(event));

  if (!previous?.coordinates || !next?.coordinates) {
    return null;
  }

  const originIndex = events.indexOf(previous);
  const destinationIndex = events.indexOf(next);

  if (originIndex < 0 || destinationIndex < 0 || destinationIndex <= originIndex) {
    return null;
  }

  const route = events[routeEventIndex].route;

  return {
    originIndex,
    destinationIndex,
    originTitle: previous.title,
    destinationTitle: next.title,
    originCoordinates: previous.coordinates,
    destinationCoordinates: next.coordinates,
    replaceIndex: routeEventIndex,
    mode: route?.mode ?? 'TRANSIT',
    departureTime: route?.requestedDepartureTime ?? getInitialRouteDepartureTime(previous),
    transitPreference: route?.transitPreference ?? 'FEWER_TRANSFERS',
  } as const;
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
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches
  );
  const [showMobileEventList, setShowMobileEventList] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [showCategoryFilter, setShowCategoryFilter] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<EventContextMenu | null>(null);
  const [routePicker, setRoutePicker] = useState<RoutePickerState | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const transferMessageTimeoutRef = useRef<number | null>(null);
  const toastTouchStartX = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const eventLongPressTimer = useRef<number | null>(null);
  const eventLongPressFired = useRef(false);
  const eventTouchStartPoint = useRef<{ x: number; y: number } | null>(null);
  const touchDragOriginIndex = useRef<number | null>(null);
  const touchDragOverIndex = useRef<number | null>(null);
  const touchDragging = useRef(false);
  const suppressSidebarClick = useRef(false);
  const pendingMovedEventSelection = useRef<{ dayIndex: number; eventIndex: number } | null>(null);
  const isAllDays = selectedDayIndex === ALL_DAYS_INDEX;
  const activeDay = days[selectedDayIndex] ?? days[0] ?? EMPTY_DAY;
  const displayEventEntries = useMemo<DisplayEventEntry[]>(() => {
    if (isAllDays) {
      const entries: DisplayEventEntry[] = [];
      days.forEach((entryDay, dayIndex) => {
        entryDay.events.forEach((event, eventIndex) => {
          entries.push({
            event,
            index: entries.length,
            dayIndex,
            day: entryDay,
            eventIndex,
          });
        });
      });
      return entries;
    }

    return (activeDay?.events ?? []).map((event, eventIndex) => ({
      event,
      index: eventIndex,
      dayIndex: selectedDayIndex,
      day: activeDay,
      eventIndex,
    }));
  }, [activeDay, days, isAllDays, selectedDayIndex]);
  const displayEvents = useMemo(
    () => displayEventEntries.map(({ event }) => event),
    [displayEventEntries]
  );
  const day: ItineraryDay = isAllDays
    ? {
        day: '전체',
        title: '모든 일정',
        date: getDateRangeLabel(days),
        summary: '전체 일정',
        events: displayEvents,
      }
    : activeDay;
  const editingEvent = !isAllDays && editingEventIndex !== null ? day.events[editingEventIndex] : null;
  const daysWeather = useDaysWeather(days);
  const categoryCounts = useMemo(() => {
    const counts = new Map<EventCategory, number>();
    day.events.forEach((event) => {
      if (!event.category) return;
      counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
    });
    return counts;
  }, [day.events]);
  const availableCategories = useMemo(
    () => CATEGORY_ORDER.filter((category) => categoryCounts.has(category)),
    [categoryCounts]
  );
  const visibleEventEntries = useMemo(
    () => displayEventEntries.filter(({ event }) => categoryFilter === 'all' || event.category === categoryFilter),
    [categoryFilter, displayEventEntries]
  );
  const visibleEventIndexSet = useMemo(
    () => new Set(visibleEventEntries.map(({ index }) => index)),
    [visibleEventEntries]
  );
  const activeCategory = categoryFilter === 'all' ? null : CATEGORIES[categoryFilter];
  const activeCategoryLabel = activeCategory?.label ?? '전체';

  const selectEvent = useCallback((index: number | null, motion: ToastMotion = 'default') => {
    setToastMotion(motion);
    setSelectedEventIndex(index);
  }, []);

  useEffect(() => {
    const pendingSelection = pendingMovedEventSelection.current;
    if (pendingSelection && pendingSelection.dayIndex === selectedDayIndex) {
      selectEvent(pendingSelection.eventIndex);
      pendingMovedEventSelection.current = null;
    } else {
      selectEvent(null);
    }
    setEditingEventIndex(null);
    setDraftEvent(null);
    setShowEventModal(false);
    setContextMenu(null);
    setRoutePicker(null);
    setCategoryFilter('all');
  }, [selectEvent, selectedDayIndex]);

  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryCounts.has(categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryCounts, categoryFilter]);

  useEffect(() => {
    if (selectedEventIndex !== null && !visibleEventIndexSet.has(selectedEventIndex)) {
      selectEvent(null);
    }
  }, [selectEvent, selectedEventIndex, visibleEventIndexSet]);

  useEffect(() => {
    if (!routePicker || isAllDays) return;

    const snapshot = {
      originIndex: routePicker.originIndex,
      destinationIndex: routePicker.destinationIndex,
      mode: routePicker.mode,
      departureTime: routePicker.departureTime,
      transitPreference: routePicker.transitPreference,
      replaceIndex: routePicker.replaceIndex,
    };

    const searchOptions: RouteSearchOptions = {
      mode: routePicker.mode,
    };

    if (routePicker.mode === 'TRANSIT') {
      const departureTime = toLocalDateTime(day.date, routePicker.departureTime);
      if (departureTime) {
        searchOptions.departureTime = departureTime;
      }
      searchOptions.transitPreference = {
        routingPreference: routePicker.transitPreference,
      };
    }

    let cancelled = false;
    setRoutePicker((prev) =>
      prev && isSameRouteQuery(prev, snapshot) ? { ...prev, loading: true, error: null } : prev
    );

    void fetchRouteOptions(
      routePicker.originCoordinates,
      routePicker.destinationCoordinates,
      searchOptions
    )
      .then((options) => {
        if (cancelled) return;
        setRoutePicker((prev) =>
          prev && isSameRouteQuery(prev, snapshot)
            ? {
                ...prev,
                loading: false,
                options,
                error: options.length ? null : '선택한 조건에 맞는 경로를 찾지 못했습니다.',
              }
            : prev
        );
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '경로 검색에 실패했습니다.';
        setRoutePicker((prev) =>
          prev && isSameRouteQuery(prev, snapshot)
            ? { ...prev, loading: false, error: message, options: [] }
            : prev
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    day.date,
    isAllDays,
    routePicker?.departureTime,
    routePicker?.destinationCoordinates,
    routePicker?.destinationIndex,
    routePicker?.mode,
    routePicker?.originCoordinates,
    routePicker?.originIndex,
    routePicker?.replaceIndex,
    routePicker?.transitPreference,
  ]);

  useEffect(() => {
    setEditingDayTitle(false);
    setDayTitleDraft(day.title);
    setCityDraft(day.city ?? '');
  }, [day.title, day.city, selectedDayIndex]);

  useEffect(() => {
    const el = tabsRef.current?.querySelector('.day-chip.active') as HTMLElement | null;
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
      if (eventLongPressTimer.current !== null) {
        window.clearTimeout(eventLongPressTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MAP_CLEAN_MODE_STORAGE_KEY, String(cleanMapMode));
  }, [cleanMapMode]);

  useEffect(() => {
    if (!showSettingsMenu) return;

    const onPointerDown = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSettingsMenu(false);
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showSettingsMenu]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!isNarrow) {
      setShowMobileEventList(false);
    }
  }, [isNarrow]);

  const visibleOffsetX = isNarrow ? 0 : sidebarWidth / 2;

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
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setSidebarWidth(width);
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

  const buildRoutePickerState = useCallback(
    ({
      originIndex,
      destinationIndex,
      replaceIndex = null,
      mode = 'TRANSIT' as TravelModeKey,
      departureTime,
      transitPreference = 'FEWER_TRANSFERS' as const,
    }: {
      originIndex: number;
      destinationIndex: number;
      replaceIndex?: number | null;
      mode?: TravelModeKey;
      departureTime?: string;
      transitPreference?: 'FEWER_TRANSFERS' | 'LESS_WALKING';
    }) => {
      const origin = day.events[originIndex];
      const destination = day.events[destinationIndex];

      if (!origin?.coordinates || !destination?.coordinates || isRouteEvent(origin) || isRouteEvent(destination)) {
        showTransferStatus('error', '출발지와 도착지에 위치 정보가 필요합니다.');
        return;
      }

      setRoutePicker({
        originIndex,
        destinationIndex,
        originTitle: origin.title,
        destinationTitle: destination.title,
        originCoordinates: origin.coordinates,
        destinationCoordinates: destination.coordinates,
        replaceIndex,
        mode,
        departureTime: departureTime ?? getInitialRouteDepartureTime(origin),
        transitPreference,
        loading: true,
        error: null,
        options: [],
      });
    },
    [day.events, showTransferStatus]
  );

  const handleSaveEvent = (event: ItineraryEvent) => {
    if (isAllDays) return;

    setDays((prev) =>
      prev.map((currentDay, index) =>
        index === selectedDayIndex
          ? {
              ...currentDay,
              events:
                editingEventIndex === null
                  ? [...currentDay.events, event]
                  : currentDay.events.map((existingEvent, eventIndex) =>
                      eventIndex === editingEventIndex ? event : existingEvent
                    ),
            }
          : currentDay
      )
    );

    if (editingEventIndex !== null) {
      selectEvent(editingEventIndex);
    }

    setDraftEvent(null);
  };

  const openAddModal = () => {
    if (isAllDays) return;
    setEditingEventIndex(null);
    setDraftEvent(null);
    setShowEventModal(true);
  };

  const openEditModal = (eventIndex: number) => {
    if (isAllDays) return;
    const event = day.events[eventIndex];

    if (event && isRouteEvent(event)) {
      const routeEditorState = getRouteEditorState(eventIndex, day.events);
      if (!routeEditorState) {
        showTransferStatus('error', '경로 앞뒤에 위치가 있는 일반 일정이 필요합니다.');
        return;
      }

      setEditingEventIndex(null);
      setDraftEvent(null);
      setShowEventModal(false);
      buildRoutePickerState(routeEditorState);
      return;
    }

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
    if (isAllDays) return;
    selectEvent(null);
    setDraftEvent(event);
    setEditingEventIndex(null);
    setShowEventModal(true);
  };

  const handleRouteDraftRequest = (request: RouteDraftRequest) => {
    if (isAllDays) return;
    setShowEventModal(false);
    setEditingEventIndex(null);
    setDraftEvent(null);
    buildRoutePickerState({
      originIndex: request.originIndex,
      destinationIndex: request.destinationIndex,
      departureTime: request.departureTime,
    });
  };

  const openDayTitleEditor = () => {
    if (isAllDays) return;
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
    if (isAllDays) return;

    const nextTitle = dayTitleDraft.trim();
    if (!nextTitle) {
      cancelDayTitleEdit();
      return;
    }

    const nextCity = cityDraft.trim();
    const cityChanged = nextCity !== (day.city ?? '');

    let cityCoordinates = day.cityCoordinates;
    if (cityChanged) {
      if (!nextCity) {
        cityCoordinates = undefined;
      } else {
        setSavingCity(true);
        try {
          cityCoordinates = (await geocodeCity(nextCity)) ?? undefined;
          if (!cityCoordinates) {
            showTransferStatus('error', `'${nextCity}' 위치를 찾지 못했습니다.`);
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

  const handleResetData = () => {
    setShowSettingsMenu(false);

    const confirmed = window.confirm(
      '저장된 모든 일정 데이터를 삭제하고 기본 셋팅 데이터로 되돌립니다. 계속하시겠습니까?'
    );
    if (!confirmed) return;

    try {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key && key.startsWith('travel-')) {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      // localStorage 접근이 막혀 있어도 새로고침으로 기본 데이터를 복원한다.
    }

    window.location.reload();
  };

  const handleDeleteEvent = (eventIndex: number) => {
    if (isAllDays) return;

    setDays((prev) =>
      prev.map((currentDay, index) =>
        index === selectedDayIndex
          ? { ...currentDay, events: currentDay.events.filter((_, itemIndex) => itemIndex !== eventIndex) }
          : currentDay
      )
    );
    selectEvent(null);
  };

  const handleRouteModeChange = (mode: TravelModeKey) => {
    setRoutePicker((prev) =>
      prev
        ? {
            ...prev,
            mode,
            loading: true,
            error: null,
            options: [],
          }
        : prev
    );
  };

  const handleRouteDepartureTimeChange = (departureTime: string) => {
    setRoutePicker((prev) =>
      prev
        ? {
            ...prev,
            departureTime,
            loading: true,
            error: null,
            options: [],
          }
        : prev
    );
  };

  const handleRouteTransitPreferenceChange = (transitPreference: 'FEWER_TRANSFERS' | 'LESS_WALKING') => {
    setRoutePicker((prev) =>
      prev
        ? {
            ...prev,
            transitPreference,
            loading: true,
            error: null,
            options: [],
          }
        : prev
    );
  };

  const handleSelectRoute = (option: RouteOption) => {
    if (!routePicker || isAllDays) return;

    const insertAt = routePicker.replaceIndex ?? routePicker.originIndex + 1;

    const route: SavedRoute = {
      mode: option.mode,
      modeLabel: option.modeLabel,
      modeIcon: option.modeIcon,
      originTitle: routePicker.originTitle,
      destinationTitle: routePicker.destinationTitle,
      summary: option.summary,
      durationText: option.durationText,
      durationValue: option.durationValue,
      distanceText: option.distanceText,
      departureText: option.departureText,
      arrivalText: option.arrivalText,
      requestedDepartureTime: routePicker.mode === 'TRANSIT' ? routePicker.departureTime : undefined,
      transitPreference: routePicker.mode === 'TRANSIT' ? routePicker.transitPreference : undefined,
      transferCount: option.transferCount,
      walkingDurationText: option.walkingDurationText,
      walkingDistanceText: option.walkingDistanceText,
      transitLines: option.transitLines,
      path: option.path,
      segments: option.segments,
      transfers: option.transfers,
    };

    const routeEvent: ItineraryEvent = {
      title: option.modeLabel,
      time: option.departureText ?? routePicker.departureTime,
      category: 'route',
      route,
    };

    setDays((prev) =>
      prev.map((currentDay, index) => {
        if (index !== selectedDayIndex) return currentDay;

        if (routePicker.replaceIndex !== null) {
          return {
            ...currentDay,
            events: currentDay.events.map((event, eventIndex) =>
              eventIndex === routePicker.replaceIndex ? routeEvent : event
            ),
          };
        }

        return {
          ...currentDay,
          events: [
            ...currentDay.events.slice(0, insertAt),
            routeEvent,
            ...currentDay.events.slice(insertAt),
          ],
        };
      })
    );

    setRoutePicker(null);
    selectEvent(insertAt);
    showTransferStatus(
      'success',
      routePicker.replaceIndex !== null ? '경로를 업데이트했습니다.' : '경로를 일정에 추가했습니다.'
    );
  };

  const handleReorder = useCallback((from: number, to: number) => {
    if (isAllDays) return;
    if (from === to) return;
    setDays((prev) =>
      prev.map((currentDay, index) => {
        if (index !== selectedDayIndex) return currentDay;
        const events = [...currentDay.events];
        const [moved] = events.splice(from, 1);
        events.splice(to, 0, moved);
        return { ...currentDay, events };
      })
    );
    selectEvent(null);
  }, [isAllDays, selectEvent, selectedDayIndex, setDays]);

  const handleDrop = (to: number) => {
    if (dragIndex !== null) handleReorder(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  };

  const clampContextMenuPosition = useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };

    const menuWidth = 248;
    const menuHeight = 360;
    const margin = 12;

    return {
      x: Math.min(x, window.innerWidth - menuWidth - margin),
      y: Math.min(y, window.innerHeight - menuHeight - margin),
    };
  }, []);

  const findSidebarEventIndexAtPoint = useCallback((x: number, y: number) => {
    if (typeof document === 'undefined') return null;
    const element = document.elementFromPoint(x, y) as HTMLElement | null;
    const item = element?.closest<HTMLElement>('[data-event-index]');
    if (!item) return null;
    const value = Number(item.dataset.eventIndex);
    return Number.isInteger(value) ? value : null;
  }, []);

  const getRouteDraftFromListIndex = useCallback(
    (eventIndex: number) => {
      const findPreviousRoutePoint = (fromIndex: number) => {
        for (let index = fromIndex - 1; index >= 0; index -= 1) {
          if (isRoutePointEvent(day.events[index])) return index;
        }
        return -1;
      };

      const findNextRoutePoint = (fromIndex: number) => {
        for (let index = fromIndex + 1; index < day.events.length; index += 1) {
          if (isRoutePointEvent(day.events[index])) return index;
        }
        return -1;
      };

      const currentEvent = day.events[eventIndex];
      if (!currentEvent) return null;

      if (isRoutePointEvent(currentEvent)) {
        const nextIndex = findNextRoutePoint(eventIndex);
        if (nextIndex >= 0) {
          return {
            originIndex: eventIndex,
            destinationIndex: nextIndex,
            departureTime: getInitialRouteDepartureTime(currentEvent),
          };
        }

        const previousIndex = findPreviousRoutePoint(eventIndex);
        if (previousIndex >= 0) {
          return {
            originIndex: previousIndex,
            destinationIndex: eventIndex,
            departureTime: getInitialRouteDepartureTime(day.events[previousIndex]),
          };
        }

        return null;
      }

      const previousIndex = findPreviousRoutePoint(eventIndex);
      const nextIndex = findNextRoutePoint(eventIndex);
      if (previousIndex < 0 || nextIndex < 0) {
        return null;
      }

      return {
        originIndex: previousIndex,
        destinationIndex: nextIndex,
        departureTime: getInitialRouteDepartureTime(day.events[previousIndex]),
      };
    },
    [day.events]
  );

  const openEventContextMenu = useCallback(
    (eventIndex: number, x: number, y: number) => {
      if (isAllDays) return;

      const event = day.events[eventIndex];
      if (!event) return;

      const position = clampContextMenuPosition(x, y);
      let routeAction: EventContextRouteAction | null = null;

      if (isRouteEvent(event)) {
        routeAction = {
          label: '경로 다시 찾기',
          kind: 'edit',
        };
      } else {
        const draft = getRouteDraftFromListIndex(eventIndex);
        if (draft) {
          routeAction = {
            label: '경로 추가',
            kind: 'create',
            draft,
          };
        }
      }

      setContextMenu({
        eventIndex,
        x: position.x,
        y: position.y,
        mode: 'actions',
        routeAction,
      });
    },
    [clampContextMenuPosition, day.events, getRouteDraftFromListIndex, isAllDays]
  );

  const handleContextRouteAction = () => {
    if (!contextMenu || !contextMenu.routeAction) return;

    const { eventIndex, routeAction } = contextMenu;
    setContextMenu(null);

    if (routeAction.kind === 'edit') {
      openEditModal(eventIndex);
      return;
    }

    if (!routeAction.draft) return;
    setShowEventModal(false);
    setEditingEventIndex(null);
    setDraftEvent(null);
    buildRoutePickerState(routeAction.draft);
  };

  const handleContextMoveStart = () => {
    setContextMenu((prev) => (prev ? { ...prev, mode: 'move' } : prev));
  };

  const handleContextMoveBack = () => {
    setContextMenu((prev) => (prev ? { ...prev, mode: 'actions' } : prev));
  };

  const handleMoveEventToDay = (targetDayIndex: number) => {
    if (isAllDays || !contextMenu || targetDayIndex === selectedDayIndex) return;

    const eventToMove = day.events[contextMenu.eventIndex];
    const targetDay = days[targetDayIndex];
    if (!eventToMove || !targetDay) return;

    pendingMovedEventSelection.current = {
      dayIndex: targetDayIndex,
      eventIndex: targetDay.events.length,
    };

    setDays((prev) =>
      prev.map((currentDay, index) => {
        if (index === selectedDayIndex) {
          return {
            ...currentDay,
            events: currentDay.events.filter((_, eventIndex) => eventIndex !== contextMenu.eventIndex),
          };
        }

        if (index === targetDayIndex) {
          return {
            ...currentDay,
            events: [...currentDay.events, eventToMove],
          };
        }

        return currentDay;
      })
    );

    setContextMenu(null);
    onSelectDay(targetDayIndex);
    showTransferStatus('success', `'${eventToMove.title}' 일정을 ${targetDay.day}로 옮겼습니다.`);
  };

  const handleEventContextMenu = (e: React.MouseEvent, eventIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    openEventContextMenu(eventIndex, e.clientX, e.clientY);
    return;
    /*

    const event = day.events[eventIndex];
    if (!event) return;

    if (isRouteEvent(event)) {
      openEditModal(eventIndex);
      return;
    }

    const draft = getRouteDraftFromListIndex(eventIndex);
    if (!draft) {
      showTransferStatus('error', '경로 앞뒤에 위치가 있는 일반 일정이 필요합니다.');
      return;
    }

    setShowEventModal(false);
    setEditingEventIndex(null);
    setDraftEvent(null);
    buildRoutePickerState(draft);
    */
  };

  const goToAdjacentEvent = (dir: 1 | -1) => {
    const selectable = day.events.flatMap((event, index) => (isSelectableEvent(event) ? [index] : []));
    if (selectable.length === 0) return;
    const current = selectedEventIndex !== null ? selectable.indexOf(selectedEventIndex) : -1;
    const next = current === -1 ? 0 : (current + dir + selectable.length) % selectable.length;
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
    if (isAllDays) return;
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
    if (toastTouchStartX.current === null) return;
    if (Math.abs(e.touches[0].clientX - toastTouchStartX.current) > 10) clearLongPress();
  };

  const handleToastTouchEnd = (e: React.TouchEvent) => {
    clearLongPress();
    if (longPressFired.current) {
      longPressFired.current = false;
      toastTouchStartX.current = null;
      return;
    }
    if (toastTouchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - toastTouchStartX.current;
    toastTouchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    goToAdjacentEvent(dx < 0 ? 1 : -1);
  };

  const handleToastMouseDown = () => startLongPress();
  const handleToastMouseUp = () => clearLongPress();
  const handleToastMouseLeave = () => clearLongPress();

  const clearEventLongPress = () => {
    if (eventLongPressTimer.current !== null) {
      window.clearTimeout(eventLongPressTimer.current);
      eventLongPressTimer.current = null;
    }
  };

  const startEventLongPress = (eventIndex: number, x: number, y: number) => {
    if (isAllDays) return;
    eventLongPressFired.current = false;
    eventTouchStartPoint.current = { x, y };
    clearEventLongPress();
    eventLongPressTimer.current = window.setTimeout(() => {
      eventLongPressFired.current = true;
      selectEvent(eventIndex);
      openEventContextMenu(eventIndex, x, y);
    }, 520);
  };

  const handleSidebarEventTouchStart = (e: React.TouchEvent, eventIndex: number) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.ev-drag')) {
      handleTouchDragStart(e, eventIndex);
      return;
    }
    const touch = e.touches[0];
    startEventLongPress(eventIndex, touch.clientX, touch.clientY);
  };

  const handleSidebarEventTouchMove = (e: React.TouchEvent) => {
    if (touchDragging.current) return;
    if (!eventTouchStartPoint.current) return;
    const touch = e.touches[0];
    if (
      Math.abs(touch.clientX - eventTouchStartPoint.current.x) > 10 ||
      Math.abs(touch.clientY - eventTouchStartPoint.current.y) > 10
    ) {
      clearEventLongPress();
    }
  };

  const handleSidebarEventTouchEnd = () => {
    if (touchDragging.current) return;
    clearEventLongPress();
    eventTouchStartPoint.current = null;
  };

  const finishTouchDrag = useCallback(
    (commit: boolean) => {
      const from = touchDragOriginIndex.current;
      const to = touchDragOverIndex.current;

      touchDragging.current = false;
      touchDragOriginIndex.current = null;
      touchDragOverIndex.current = null;
      setDragIndex(null);
      setOverIndex(null);

      if (commit && from !== null && to !== null && from !== to) {
        handleReorder(from, to);
      }
    },
    [handleReorder]
  );

  useEffect(() => {
    if (dragIndex === null || !touchDragging.current) return;

    const onTouchMove = (event: TouchEvent) => {
      if (!event.touches.length) return;
      const touch = event.touches[0];
      const nextIndex = findSidebarEventIndexAtPoint(touch.clientX, touch.clientY);
      if (nextIndex !== null) {
        touchDragOverIndex.current = nextIndex;
        setOverIndex(nextIndex);
      }
      event.preventDefault();
    };

    const onTouchEnd = () => {
      suppressSidebarClick.current = true;
      finishTouchDrag(true);
      window.setTimeout(() => {
        suppressSidebarClick.current = false;
      }, 0);
    };

    const onTouchCancel = () => {
      finishTouchDrag(false);
    };

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchCancel);

    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [dragIndex, findSidebarEventIndexAtPoint, finishTouchDrag]);

  const handleTouchDragStart = (e: React.TouchEvent, index: number) => {
    if (isAllDays) return;
    if (e.touches.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    clearEventLongPress();
    eventTouchStartPoint.current = null;
    setContextMenu(null);
    touchDragging.current = true;
    touchDragOriginIndex.current = index;
    touchDragOverIndex.current = index;
    setDragIndex(index);
    setOverIndex(index);
  };

  const handleSidebarEventClick = (index: number, active: boolean, clickable: boolean) => {
    if (suppressSidebarClick.current) {
      suppressSidebarClick.current = false;
      return;
    }

    if (eventLongPressFired.current) {
      eventLongPressFired.current = false;
      return;
    }

    if (clickable) {
      selectEvent(active ? null : index);
    }
  };

  const mapNumbers: Record<number, number> = {};
  let counter = 1;
  displayEventEntries.forEach(({ event, index }) => {
    if (visibleEventIndexSet.has(index) && event.coordinates && !isRouteEvent(event)) {
      mapNumbers[index] = counter;
      counter += 1;
    }
  });
  const contextMoveTargets = isAllDays
    ? []
    : days.flatMap((candidateDay, index) =>
        index === selectedDayIndex ? [] : [{ index, day: candidateDay }]
      );
  const reservationItems = isAllDays ? [] : getDayReservationItems(day);

  return (
    <div className="schedule-page">
      <div className="schedule-map">
        <MapView
          events={day.events}
          selectedIndex={selectedEventIndex}
          onSelectEvent={(index) => selectEvent(selectedEventIndex === index ? null : index)}
          cleanMode={cleanMapMode}
          onAddLocation={isAllDays ? undefined : handleAddLocationFromMap}
          visibleOffsetX={visibleOffsetX}
          visibleEventIndexes={visibleEventIndexSet}
        />

        {selectedEventIndex !== null && day.events[selectedEventIndex] && (() => {
          const event = day.events[selectedEventIndex];
          const selectedEntry = displayEventEntries[selectedEventIndex];
          const category = event.category ? CATEGORIES[event.category] : null;
          const eventDescription = getEventDescription(event.description, event.note);
          const isRoute = isRouteEvent(event);
          const isFlightMovement = isFlightMovementEvent(event);
          const routeTitle = isRoute ? getRouteWidgetTitle(event.route) : null;
          const routeSummary = isRoute ? getRouteWidgetSummary(event.route) : null;
          const routeTransfers = isRoute ? getRouteTransfersPreview(event.route) : [];
          const flightSchedule = isFlightMovement ? getFlightScheduleText(event.flight, event.time) : null;

          return (
            <div
              key={`${selectedEventIndex}-${toastMotion}`}
              className={`map-toast toast-motion-${toastMotion}`}
              style={{ ['--toast-shift' as string]: `${visibleOffsetX}px` } as CSSProperties}
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
                  {isAllDays && selectedEntry && <span className="map-toast-day">{selectedEntry.day.day}</span>}
                  {category && (
                    <span
                      className="map-toast-cat"
                      style={{ background: category.light, color: category.color }}
                    >
                      {category.icon} {category.label}
                    </span>
                  )}
                  {event.time && !isFlightMovement && <span className="map-toast-time">{event.time}</span>}
                </div>
                <h4 className="map-toast-title">{routeTitle ?? event.title}</h4>
                {isFlightMovement && (
                  <p className="map-toast-flight-summary">{flightSchedule}</p>
                )}
                {false && isRoute && (
                  <>
                    <p className="map-toast-route-leg">
                      {routeTitle}
                    </p>
                    <div className="map-toast-route-tags">
                      {routeSummary && <span className="map-toast-route-tag">{routeSummary}</span>}
                    </div>
                  </>
                )}
                {!isRouteEvent(event) && event.location && <p className="map-toast-loc">📍 {event.location}</p>}
                {!isRouteEvent(event) && eventDescription && <p className="map-toast-desc">{eventDescription}</p>}
                {routeSummary && <p className="map-toast-route-meta">{routeSummary}</p>}
                {routeTransfers.length > 0 && (
                  <div className="map-toast-route-steps">
                    {routeTransfers.map((transfer, index) => (
                      <p key={`${transfer.type}-${transfer.title}-${index}`} className="map-toast-route-step">
                        <strong>{transfer.title}</strong>
                        {transfer.detail && <span>{transfer.detail}</span>}
                      </p>
                    ))}
                  </div>
                )}
                {event.attachment && (
                  <div className="map-toast-actions">
                    <a
                      className="map-toast-attach"
                      href={event.attachment.dataUrl}
                      download={event.attachment.name}
                      target="_blank"
                      rel="noreferrer"
                    >
                      📎 {event.attachment.name} 열기
                    </a>
                  </div>
                )}
              </div>
              <button className="map-toast-close" onClick={() => selectEvent(null)} type="button">
                ×
              </button>
            </div>
          );
        })()}
      </div>

      <nav className="schedule-nav">
        <span className="schedule-nav-title">2026 Europe · Schedule</span>
        <div className="schedule-nav-tools">
          {transferMessage && (
            <span className={`schedule-transfer-message ${transferMessage.kind}`}>
              {transferMessage.text}
            </span>
          )}
          <button
            className={`schedule-icon-btn schedule-list-btn${showMobileEventList ? ' is-active' : ''}`}
            onClick={() => setShowMobileEventList((prev) => !prev)}
            title="Reorder schedule"
            aria-label="Reorder schedule"
            aria-pressed={showMobileEventList}
            type="button"
          >
            ☰
          </button>
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
          {!isAllDays && (
            <button
              className="schedule-icon-btn schedule-add-btn"
              onClick={openAddModal}
              title="일정 추가"
              aria-label="일정 추가"
              type="button"
            >
              ＋
            </button>
          )}
          <div className="schedule-settings" ref={settingsMenuRef}>
            <button
              className={`schedule-icon-btn schedule-settings-btn${showSettingsMenu ? ' is-active' : ''}`}
              onClick={() => setShowSettingsMenu((prev) => !prev)}
              title="설정"
              aria-label="설정"
              aria-haspopup="true"
              aria-expanded={showSettingsMenu}
              type="button"
            >
              ⚙
            </button>
            {showSettingsMenu && (
              <div className="schedule-settings-menu" role="menu">
                <button
                  className="schedule-settings-item"
                  onClick={() => {
                    setShowSettingsMenu(false);
                    handleExportJson();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="schedule-settings-item-icon">⤓</span>
                  JSON 내보내기
                </button>
                <button
                  className="schedule-settings-item"
                  onClick={() => {
                    setShowSettingsMenu(false);
                    openImportJson();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="schedule-settings-item-icon">⤒</span>
                  JSON 불러오기
                </button>
                <button
                  className="schedule-settings-item"
                  onClick={() => {
                    setShowSettingsMenu(false);
                    onBack();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="schedule-settings-item-icon">←</span>
                  메인으로
                </button>
                <div className="schedule-settings-divider" />
                <button
                  className="schedule-settings-item schedule-settings-item-danger"
                  onClick={handleResetData}
                  role="menuitem"
                  type="button"
                >
                  <span className="schedule-settings-item-icon">↺</span>
                  데이터 초기화
                </button>
              </div>
            )}
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJson}
            hidden
          />
        </div>
      </nav>

      <div className="schedule-layout">
        <aside
          className={`schedule-sidebar${showMobileEventList ? ' is-mobile-list-open' : ''}`}
          style={{ width: sidebarWidth }}
        >
          <div className="sidebar-tabs-wrap">
            <div className="sidebar-tabs" ref={tabsRef}>
              <button
                className={`day-chip all-days-chip${isAllDays ? ' active' : ''}`}
                onClick={() => onSelectDay(ALL_DAYS_INDEX)}
                type="button"
              >
                전체
              </button>
              {days.map((item, index) => (
                <button
                  key={item.day}
                  className={`day-chip${index === selectedDayIndex ? ' active' : ''}`}
                  onClick={() => onSelectDay(index)}
                  type="button"
                >
                  {item.day}
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-day-header">
            <div className="sidebar-day-label-row">
              <p className="sidebar-day-label">{day.day}</p>
              {!isAllDays && daysWeather[selectedDayIndex] && (
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
              {!isAllDays && editingDayTitle ? (
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
                          void saveDayTitle();
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
                      placeholder="날씨 기준 도시 (예: 프라하)"
                      onChange={(e) => setCityDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void saveDayTitle();
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
                      onClick={() => void saveDayTitle()}
                      title="저장"
                      type="button"
                      disabled={savingCity}
                    >
                      {savingCity ? '...' : '✓'}
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
                  {!isAllDays && (
                    <button
                      className="sidebar-day-title-edit"
                      onClick={openDayTitleEditor}
                      title="일자 제목 수정"
                      type="button"
                    >
                      ✎
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="sidebar-day-date">{day.date}</p>
          </div>

          {availableCategories.length > 0 && (
            <div
              className={`sidebar-category-filter${showCategoryFilter ? ' is-open' : ' is-collapsed'}`}
              aria-label="카테고리 필터"
            >
              <button
                className="category-filter-toggle"
                onClick={() => setShowCategoryFilter((prev) => !prev)}
                type="button"
                aria-expanded={showCategoryFilter}
                aria-label={showCategoryFilter ? '카테고리 필터 숨기기' : '카테고리 필터 보기'}
              >
                <span className="category-filter-toggle-title">필터</span>
                <span className="category-filter-toggle-current">
                  {activeCategory ? `${activeCategory.icon} ${activeCategoryLabel}` : activeCategoryLabel} · {visibleEventEntries.length}
                </span>
                <span className="category-filter-toggle-arrow" aria-hidden="true">
                  ▾
                </span>
              </button>

              {showCategoryFilter && (
                <div className="category-filter-options">
                  <button
                    className={`category-filter-chip${categoryFilter === 'all' ? ' is-active' : ''}`}
                    onClick={() => setCategoryFilter('all')}
                    type="button"
                  >
                    <span>전체</span>
                    <small>{day.events.length}</small>
                  </button>
                  {availableCategories.map((categoryKey) => {
                    const category = CATEGORIES[categoryKey];
                    const count = categoryCounts.get(categoryKey) ?? 0;
                    return (
                      <button
                        key={categoryKey}
                        className={`category-filter-chip${categoryFilter === categoryKey ? ' is-active' : ''}`}
                        onClick={() => setCategoryFilter(categoryKey)}
                        style={
                          {
                            '--filter-color': category.color,
                            '--filter-light': category.light,
                          } as CSSProperties
                        }
                        type="button"
                      >
                        <span>
                          {category.icon} {category.label}
                        </span>
                        <small>{count}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <ul className="sidebar-event-list">
            {visibleEventEntries.map(({ event, index, day: entryDay }) => {
              const num = mapNumbers[index];
              const active = selectedEventIndex === index;
              const clickable = isSelectableEvent(event);
              const isRoute = isRouteEvent(event);
              const isFlightMovement = isFlightMovementEvent(event);
              const routeTitle = isRoute ? getRouteWidgetTitle(event.route) : null;
              const routeSummary = isRoute ? getRouteWidgetSummary(event.route) : null;
              const eventDescription = getEventDescription(event.description, event.note);
              const routeTransfers = isRoute ? getRouteTransfersPreview(event.route) : [];
              const flightSchedule = isFlightMovement ? getFlightScheduleText(event.flight, event.time) : null;

              return (
                <li
                  key={`${event.title}-${index}`}
                  data-event-index={index}
                  className={
                    `sidebar-event${active ? ' active' : ''}${clickable ? ' clickable' : ''}${isAllDays ? ' all-days-event' : ''}` +
                    `${dragIndex === index ? ' dragging' : ''}${overIndex === index && dragIndex !== index ? ' drag-over' : ''}`
                  }
                  onClick={() => handleSidebarEventClick(index, active, clickable)}
                  onContextMenu={isAllDays ? undefined : (e) => handleEventContextMenu(e, index)}
                  onTouchStart={isAllDays ? undefined : (e) => handleSidebarEventTouchStart(e, index)}
                  onTouchMove={handleSidebarEventTouchMove}
                  onTouchEnd={handleSidebarEventTouchEnd}
                  onTouchCancel={handleSidebarEventTouchEnd}
                  draggable={!isAllDays && !isNarrow}
                  onDragStart={() => {
                    if (!isAllDays && !isNarrow) setDragIndex(index);
                  }}
                  onDragEnter={() => setOverIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(index);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  <span className="ev-drag" title="드래그해서 순서 변경">
                    ⋮⋮
                  </span>
                  <div className={`ev-num${num ? '' : ' ev-num--none'}`}>{num ?? '·'}</div>
                  <div className="ev-info">
                    <div className="ev-meta-row">
                      {isAllDays && <span className="ev-day-chip">{entryDay.day}</span>}
                      {event.time && !isFlightMovement && <span className="ev-time">{event.time}</span>}
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
                    <p className="ev-title">{routeTitle ?? event.title}</p>
                    {isRoute ? (
                      <>
                        {routeSummary && <p className="ev-route-summary">{routeSummary}</p>}
                        {false && <p className="ev-route-leg">
                          <span>{routeTitle}</span>
                          <span className="ev-route-arrow" aria-hidden="true">
                            →
                          </span>
                          <span>{routeTitle}</span>
                        </p>}
                        {false && <div className="ev-route-meta">
                          {routeSummary && <span className="ev-route-chip">{routeSummary}</span>}
                        </div>}
                        {routeTransfers.length > 0 && (
                          <div className="ev-route-transfer-list">
                            {routeTransfers.map((transfer, transferIndex) => (
                              <p
                                key={`${transfer.type}-${transfer.title}-${transferIndex}`}
                                className="ev-route-transfer"
                              >
                                <strong>{transfer.title}</strong>
                                {transfer.detail && <span>{transfer.detail}</span>}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    ) : isFlightMovement ? (
                      <p className="ev-flight-summary">{flightSchedule}</p>
                    ) : (
                      <>
                        {event.location && <p className="ev-loc">📍 {event.location}</p>}
                        {eventDescription && <p className="ev-desc">{eventDescription}</p>}
                      </>
                    )}
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
                        openEditModal(index);
                      }}
                      title={isRoute ? '경로 다시 찾기' : '수정'}
                      type="button"
                    >
                      {isRoute ? '↻' : '✎'}
                    </button>
                    <button
                      className="ev-action-btn ev-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteEvent(index);
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

          {!isAllDays && (
            <button className="add-event-btn" onClick={openAddModal} type="button">
              ＋ 일정 추가
            </button>
          )}

          {!!reservationItems.length && (
            <div className="sidebar-res">
              <p className="sidebar-res-label">예약 정보</p>
              {reservationItems.map((reservation, index) => (
                <div key={index} className="res-item">
                  <p className="res-label">{reservation.label}</p>
                  <p className="res-details">{reservation.details}</p>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className={`resize-handle${resizing ? ' resizing' : ''}`} onMouseDown={startResize} />
      </div>

      {contextMenu && (
        <div
          className="event-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.mode === 'actions' ? (
            <>
              {contextMenu.routeAction && (
                <button className="event-context-item" onClick={handleContextRouteAction} type="button">
                  <span className="event-context-icon" aria-hidden="true">
                    🧭
                  </span>
                  {contextMenu.routeAction.label}
                </button>
              )}
              <button
                className="event-context-item"
                disabled={!contextMoveTargets.length}
                onClick={handleContextMoveStart}
                type="button"
              >
                <span className="event-context-icon" aria-hidden="true">
                  ↗
                </span>
                다른 일정으로 보내기
              </button>
              {!contextMoveTargets.length && (
                <p className="event-context-hint">이동할 다른 일정이 없습니다.</p>
              )}
            </>
          ) : (
            <>
              <button className="event-context-back" onClick={handleContextMoveBack} type="button">
                ← 돌아가기
              </button>
              <p className="event-context-title">보낼 일정 선택</p>
              <div className="event-context-day-list">
                {contextMoveTargets.map(({ index, day: moveTarget }) => (
                  <button
                    key={`${moveTarget.day}-${index}`}
                    className="event-context-day-item"
                    onClick={() => handleMoveEventToDay(index)}
                    type="button"
                  >
                    <span className="event-context-day-label">{moveTarget.day}</span>
                    <span className="event-context-day-title">{moveTarget.title}</span>
                  </button>
                ))}
              </div>
              <p className="event-context-hint">선택한 일차의 마지막 일정으로 이동합니다.</p>
            </>
          )}
        </div>
      )}

      {routePicker && (
        <RoutePickerModal
          originTitle={routePicker.originTitle}
          destinationTitle={routePicker.destinationTitle}
          mode={routePicker.mode}
          departureTime={routePicker.departureTime}
          transitPreference={routePicker.transitPreference}
          loading={routePicker.loading}
          error={routePicker.error}
          options={routePicker.options}
          onModeChange={handleRouteModeChange}
          onDepartureTimeChange={handleRouteDepartureTimeChange}
          onTransitPreferenceChange={handleRouteTransitPreferenceChange}
          onSelect={handleSelectRoute}
          onClose={() => setRoutePicker(null)}
        />
      )}

      {showEventModal && (
        <AddEventModal
          initialEvent={draftEvent ?? editingEvent}
          events={day.events}
          mode={editingEventIndex !== null ? 'edit' : 'create'}
          onClose={closeEventModal}
          onSave={handleSaveEvent}
          onRequestRoute={handleRouteDraftRequest}
        />
      )}
    </div>
  );
}
