import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type { ItineraryDay, ItineraryEvent, SavedFlight, SavedRoute } from '../data/itinerary';
import { CATEGORIES } from '../data/categories';
import MapView from '../components/MapView';
import AddEventModal, { type RouteDraftRequest } from '../components/AddEventModal';
import RoutePickerModal from '../components/RoutePickerModal';
import {
  fetchRouteOptions,
  type RouteOption,
  type RouteSearchOptions,
  type TravelModeKey,
} from '../utils/directions';
import { parseItineraryJson, serializeItinerary } from '../utils/itineraryJson';
import { getDayReservationItems } from '../utils/reservations';
import { useDaysWeather } from '../hooks/useDaysWeather';
import { geocodeCity } from '../utils/weather';

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

type TransferMessage = {
  kind: 'success' | 'error';
  text: string;
};

type ToastMotion = 'default' | 'next' | 'prev';

type EventContextMenu = {
  eventIndex: number;
  x: number;
  y: number;
  label: '경로 추가' | '경로 다시 찾기';
  kind: 'create' | 'edit';
  draft?: {
    originIndex: number;
    destinationIndex: number;
    departureTime: string;
  };
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

function getRouteSummaryText(route: SavedRoute) {
  const transferLabel =
    route.mode === 'TRANSIT'
      ? route.transferCount > 0
        ? `환승 ${route.transferCount}회`
        : '직행'
      : null;
  const walking = route.walkingDurationText ? `도보 ${route.walkingDurationText}` : null;
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
    if (route.walkingDurationText) {
      parts.push(`도보 ${route.walkingDurationText}`);
    }
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
  if (route.walkingDurationText) {
    labels.push(`도보 ${route.walkingDurationText}`);
  }
  return labels;
}

function getFlightSummaryText(flight: SavedFlight) {
  const carrier = [flight.airline, flight.flightNumber].filter(Boolean).join(' ');
  const arrival = flight.arrivalTimeText ? `도착 ${flight.arrivalTimeText}` : null;
  const booking = flight.bookingReference ? `예약 ${flight.bookingReference}` : null;
  return [flight.durationText, carrier || null, arrival, booking].filter(Boolean).join(' · ');
}

function getFlightMetaLabels(flight: SavedFlight) {
  const labels = ['✈ 항공 이동', flight.durationText];
  const carrier = [flight.airline, flight.flightNumber].filter(Boolean).join(' ');
  if (carrier) labels.push(carrier);
  if (flight.arrivalTimeText) labels.push(`도착 ${flight.arrivalTimeText}`);
  if (flight.bookingReference) labels.push(`예약 ${flight.bookingReference}`);
  return labels;
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<EventContextMenu | null>(null);
  const [routePicker, setRoutePicker] = useState<RoutePickerState | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
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
  const day = days[selectedDayIndex];
  const editingEvent = editingEventIndex !== null ? day.events[editingEventIndex] : null;
  const daysWeather = useDaysWeather(days);

  const selectEvent = useCallback((index: number | null, motion: ToastMotion = 'default') => {
    setToastMotion(motion);
    setSelectedEventIndex(index);
  }, []);

  useEffect(() => {
    selectEvent(null);
    setEditingEventIndex(null);
    setDraftEvent(null);
    setShowEventModal(false);
    setContextMenu(null);
    setRoutePicker(null);
  }, [selectEvent, selectedDayIndex]);

  useEffect(() => {
    if (!routePicker) return;

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
    setEditingEventIndex(null);
    setDraftEvent(null);
    setShowEventModal(true);
  };

  const openEditModal = (eventIndex: number) => {
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
    selectEvent(null);
    setDraftEvent(event);
    setEditingEventIndex(null);
    setShowEventModal(true);
  };

  const handleRouteDraftRequest = (request: RouteDraftRequest) => {
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

  const handleDeleteEvent = (eventIndex: number) => {
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
    if (!routePicker) return;

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
  }, [selectEvent, selectedDayIndex, setDays]);

  const handleDrop = (to: number) => {
    if (dragIndex !== null) handleReorder(dragIndex, to);
    setDragIndex(null);
    setOverIndex(null);
  };

  const clampContextMenuPosition = useCallback((x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };

    const menuWidth = 188;
    const menuHeight = 64;
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
      const event = day.events[eventIndex];
      if (!event) return;

      const position = clampContextMenuPosition(x, y);

      if (isRouteEvent(event)) {
        setContextMenu({
          eventIndex,
          x: position.x,
          y: position.y,
          label: '경로 다시 찾기',
          kind: 'edit',
        });
        return;
      }

      const draft = getRouteDraftFromListIndex(eventIndex);
      if (!draft) {
        showTransferStatus('error', '경로 앞뒤에 위치가 있는 일반 일정이 필요합니다.');
        return;
      }

      setContextMenu({
        eventIndex,
        x: position.x,
        y: position.y,
        label: '경로 추가',
        kind: 'create',
        draft,
      });
    },
    [clampContextMenuPosition, day.events, getRouteDraftFromListIndex, showTransferStatus]
  );

  const handleContextMenuAction = useCallback(() => {
    if (!contextMenu) return;

    const menu = contextMenu;
    setContextMenu(null);

    if (menu.kind === 'edit') {
      openEditModal(menu.eventIndex);
      return;
    }

    if (!menu.draft) return;
    setShowEventModal(false);
    setEditingEventIndex(null);
    setDraftEvent(null);
    buildRoutePickerState(menu.draft);
  }, [buildRoutePickerState, contextMenu]);

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
  day.events.forEach((event, index) => {
    if (event.coordinates && !isRouteEvent(event)) {
      mapNumbers[index] = counter;
      counter += 1;
    }
  });
  const reservationItems = getDayReservationItems(day);

  return (
    <div className="schedule-page">
      <div className="schedule-map">
        <MapView
          events={day.events}
          selectedIndex={selectedEventIndex}
          onSelectEvent={(index) => selectEvent(selectedEventIndex === index ? null : index)}
          cleanMode={cleanMapMode}
          onAddLocation={handleAddLocationFromMap}
          visibleOffsetX={visibleOffsetX}
        />

        {selectedEventIndex !== null && day.events[selectedEventIndex] && (() => {
          const event = day.events[selectedEventIndex];
          const category = event.category ? CATEGORIES[event.category] : null;
          const eventDescription = getEventDescription(event.description, event.note);
          const isRoute = isRouteEvent(event);
          const isFlightMovement = isFlightMovementEvent(event);
          const routeTitle = isRoute ? getRouteWidgetTitle(event.route) : null;
          const routeSummary = isRoute ? getRouteWidgetSummary(event.route) : null;
          const routeTransfers = isRoute ? getRouteTransfersPreview(event.route) : [];
          const flightSummary = isFlightMovement ? getFlightSummaryText(event.flight) : null;

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
                  {category && (
                    <span
                      className="map-toast-cat"
                      style={{ background: category.light, color: category.color }}
                    >
                      {category.icon} {category.label}
                    </span>
                  )}
                  {event.time && <span className="map-toast-time">{event.time}</span>}
                </div>
                <h4 className="map-toast-title">{routeTitle ?? event.title}</h4>
                {isFlightMovement && (
                  <>
                    <p className="map-toast-route-leg">
                      {event.flight.originTitle} <span aria-hidden="true">→</span> {event.flight.destinationTitle}
                    </p>
                  </>
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
                {flightSummary && <p className="map-toast-route-meta">{flightSummary}</p>}
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
          <button
            className="schedule-icon-btn"
            onClick={onBack}
            title="메인으로"
            aria-label="메인으로"
            type="button"
          >
            ←
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

      <div className="schedule-layout">
        <aside
          className={`schedule-sidebar${showMobileEventList ? ' is-mobile-list-open' : ''}`}
          style={{ width: sidebarWidth }}
        >
          <div className="sidebar-tabs-wrap">
            <div className="sidebar-tabs" ref={tabsRef}>
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

          <ul className="sidebar-event-list">
            {day.events.map((event, index) => {
              const num = mapNumbers[index];
              const active = selectedEventIndex === index;
              const clickable = isSelectableEvent(event);
              const isRoute = isRouteEvent(event);
              const isFlightMovement = isFlightMovementEvent(event);
              const routeTitle = isRoute ? getRouteWidgetTitle(event.route) : null;
              const routeSummary = isRoute ? getRouteWidgetSummary(event.route) : null;
              const eventDescription = getEventDescription(event.description, event.note);
              const routeTransfers = isRoute ? getRouteTransfersPreview(event.route) : [];

              return (
                <li
                  key={`${event.title}-${index}`}
                  data-event-index={index}
                  className={
                    `sidebar-event${active ? ' active' : ''}${clickable ? ' clickable' : ''}` +
                    `${dragIndex === index ? ' dragging' : ''}${overIndex === index && dragIndex !== index ? ' drag-over' : ''}`
                  }
                  onClick={() => handleSidebarEventClick(index, active, clickable)}
                  onContextMenu={(e) => handleEventContextMenu(e, index)}
                  onTouchStart={(e) => handleSidebarEventTouchStart(e, index)}
                  onTouchMove={handleSidebarEventTouchMove}
                  onTouchEnd={handleSidebarEventTouchEnd}
                  onTouchCancel={handleSidebarEventTouchEnd}
                  draggable={!isNarrow}
                  onDragStart={() => {
                    if (!isNarrow) setDragIndex(index);
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
                      <>
                        <p className="ev-route-leg">
                          <span>{event.flight.originTitle}</span>
                          <span className="ev-route-arrow" aria-hidden="true">
                            →
                          </span>
                          <span>{event.flight.destinationTitle}</span>
                        </p>
                        <div className="ev-route-meta">
                          {getFlightMetaLabels(event.flight).map((label) => (
                            <span key={label} className="ev-route-chip">
                              {label}
                            </span>
                          ))}
                        </div>
                      </>
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

          <button className="add-event-btn" onClick={openAddModal} type="button">
            ＋ 일정 추가
          </button>

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
          <button className="event-context-item" onClick={handleContextMenuAction} type="button">
            <span className="event-context-icon" aria-hidden="true">
              🧭
            </span>
            {contextMenu.label}
          </button>
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
