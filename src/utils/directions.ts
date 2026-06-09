// Fetches route candidates between two points using the Google Maps Routes API
// Route class. The map (loaded by @vis.gl/react-google-maps inside MapView)
// bootstraps the google.maps namespace, so importLibrary is available once the
// schedule page renders.

import type {
  RouteTravelMode,
  SavedRouteSegment,
  SavedRouteTransfer,
} from '../data/itinerary';

export type TravelModeKey = RouteTravelMode;

export type RouteOption = {
  id: string;
  mode: TravelModeKey;
  modeLabel: string;
  modeIcon: string;
  summary: string;
  durationText: string;
  durationValue: number;
  distanceText: string;
  departureText?: string;
  arrivalText?: string;
  transferCount: number;
  walkingDurationText?: string;
  transitLines: string[];
  path: [number, number][];
  segments: SavedRouteSegment[];
  transfers: SavedRouteTransfer[];
};

export type RouteSearchOptions = {
  mode?: TravelModeKey;
  departureTime?: Date;
  arrivalTime?: Date;
  transitPreference?: google.maps.routes.TransitPreference;
};

const MODE_META: Record<TravelModeKey, { label: string; icon: string }> = {
  TRANSIT: { label: '대중교통', icon: '🚇' },
  DRIVING: { label: '자동차', icon: '🚗' },
  WALKING: { label: '도보', icon: '🚶' },
  BICYCLING: { label: '자전거', icon: '🚲' },
};

// Order also controls fallback display order before the duration sort.
const MODES: TravelModeKey[] = ['TRANSIT', 'DRIVING', 'WALKING', 'BICYCLING'];

const ROUTE_FIELDS = [
  'description',
  'distanceMeters',
  'durationMillis',
  'staticDurationMillis',
  'localizedValues',
  'legs',
  'path',
  'routeLabels',
] as const;

const CONFIG_ERROR_STATUSES = new Set([
  'FAILED_PRECONDITION',
  'INVALID_ARGUMENT',
  'OVER_DAILY_LIMIT',
  'OVER_QUERY_LIMIT',
  'PERMISSION_DENIED',
  'REQUEST_DENIED',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'UNIMPLEMENTED',
]);

function getBrowserLanguage() {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.language || undefined;
}

function stripHtml(value?: string | null) {
  return value?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}

function formatDistanceFromMeters(distanceMeters?: number) {
  if (!Number.isFinite(distanceMeters) || !distanceMeters || distanceMeters <= 0) return '';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;

  const kilometers = distanceMeters / 1000;
  const maximumFractionDigits = kilometers >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(kilometers)} km`;
}

function formatDurationFromMillis(durationMillis?: number | null) {
  if (!Number.isFinite(durationMillis) || !durationMillis || durationMillis <= 0) {
    return '소요시간 정보 없음';
  }

  const totalMinutes = Math.round(durationMillis / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) return `${hours}시간 ${minutes}분`;
  if (hours) return `${hours}시간`;
  return `${minutes}분`;
}

function formatTime(date?: Date | null) {
  if (!date) return undefined;

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function toRouteTravelMode(
  mode: google.maps.TravelModeString | null | undefined,
  fallback: TravelModeKey
): TravelModeKey {
  switch (mode) {
    case 'TRANSIT':
    case 'DRIVING':
    case 'WALKING':
    case 'BICYCLING':
      return mode;
    default:
      return fallback;
  }
}

function toPath(points: google.maps.LatLngAltitude[] | undefined): [number, number][] {
  return (points ?? []).map((point) => [point.lat, point.lng]);
}

function appendPath(
  base: [number, number][],
  extra: [number, number][]
): [number, number][] {
  if (base.length === 0) return [...extra];
  if (extra.length === 0) return base;

  const next = [...base];
  extra.forEach(([lat, lng]) => {
    const last = next[next.length - 1];
    if (!last || last[0] !== lat || last[1] !== lng) {
      next.push([lat, lng]);
    }
  });
  return next;
}

function getTransitLines(route: google.maps.routes.Route): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const transitLine = step.transitDetails?.transitLine;
      const lineName = transitLine?.shortName ?? transitLine?.name ?? '';
      if (!lineName || seen.has(lineName)) continue;
      seen.add(lineName);
      lines.push(lineName);
    }
  }

  return lines;
}

function getRoutePath(
  route: google.maps.routes.Route,
  segments: SavedRouteSegment[]
): [number, number][] {
  const path = toPath(route.path);
  if (path.length > 0) return path;
  return segments.reduce<[number, number][]>((acc, segment) => appendPath(acc, segment.path), []);
}

function getTransitTimes(route: google.maps.routes.Route) {
  const transitSteps = (route.legs ?? [])
    .flatMap((leg) => leg.steps ?? [])
    .filter((step) => !!step.transitDetails);

  const firstDeparture = transitSteps.find((step) => step.transitDetails?.departureTime)?.transitDetails;
  const lastArrival = [...transitSteps]
    .reverse()
    .find((step) => step.transitDetails?.arrivalTime)?.transitDetails;

  return {
    departureText: formatTime(firstDeparture?.departureTime),
    arrivalText: formatTime(lastArrival?.arrivalTime),
  };
}

function getStepSummary(
  mode: TravelModeKey,
  step: google.maps.routes.RouteLegStep
) {
  if (mode === 'TRANSIT') {
    const transitLine = step.transitDetails?.transitLine;
    const lineName = transitLine?.shortName ?? transitLine?.name ?? MODE_META[mode].label;
    const headsign = step.transitDetails?.headsign;
    return headsign ? `${lineName} · ${headsign}` : lineName;
  }

  const instructions = stripHtml(step.instructions);
  if (instructions) return instructions;

  return mode === 'WALKING' ? '도보 이동' : MODE_META[mode].label;
}

function createStepSegment(
  requestedMode: TravelModeKey,
  step: google.maps.routes.RouteLegStep
): SavedRouteSegment {
  const mode = toRouteTravelMode(step.travelMode, requestedMode);
  const meta = MODE_META[mode];
  const transitDetails = step.transitDetails;
  const transitLine = transitDetails?.transitLine;
  const path = toPath(step.path);
  const durationValue = step.staticDurationMillis ?? 0;
  const distanceValue = step.distanceMeters ?? 0;

  return {
    mode,
    modeLabel: meta.label,
    modeIcon: meta.icon,
    durationText:
      step.localizedValues?.staticDuration ??
      formatDurationFromMillis(durationValue),
    durationValue,
    distanceText:
      step.localizedValues?.distance ??
      formatDistanceFromMeters(distanceValue),
    distanceValue,
    summary: getStepSummary(mode, step),
    path,
    departureStop: transitDetails?.departureStop?.name ?? undefined,
    arrivalStop: transitDetails?.arrivalStop?.name ?? undefined,
    departureTimeText: formatTime(transitDetails?.departureTime),
    arrivalTimeText: formatTime(transitDetails?.arrivalTime),
    stopCount: transitDetails?.stopCount || undefined,
    lineColor: transitLine?.color ?? undefined,
    lineTextColor: transitLine?.textColor ?? undefined,
  };
}

function mergeSegments(
  base: SavedRouteSegment,
  next: SavedRouteSegment
): SavedRouteSegment {
  const distanceValue = base.distanceValue + next.distanceValue;
  const durationValue = base.durationValue + next.durationValue;
  return {
    ...base,
    durationValue,
    durationText: formatDurationFromMillis(durationValue),
    distanceValue,
    distanceText: formatDistanceFromMeters(distanceValue),
    summary: base.mode === 'WALKING' ? '도보 이동' : base.summary ?? next.summary,
    path: appendPath(base.path, next.path),
    departureStop: base.departureStop ?? next.departureStop,
    arrivalStop: next.arrivalStop ?? base.arrivalStop,
    departureTimeText: base.departureTimeText ?? next.departureTimeText,
    arrivalTimeText: next.arrivalTimeText ?? base.arrivalTimeText,
    stopCount:
      typeof base.stopCount === 'number' || typeof next.stopCount === 'number'
        ? (base.stopCount ?? 0) + (next.stopCount ?? 0)
        : undefined,
  };
}

function buildRouteSegments(
  requestedMode: TravelModeKey,
  route: google.maps.routes.Route
): SavedRouteSegment[] {
  const firstLeg = route.legs?.[0];
  const steps = firstLeg?.steps ?? [];

  if (steps.length === 0) {
    const path = toPath(route.path);
    if (path.length === 0) return [];
    return [
      {
        mode: requestedMode,
        modeLabel: MODE_META[requestedMode].label,
        modeIcon: MODE_META[requestedMode].icon,
        durationText:
          route.localizedValues?.duration ??
          route.localizedValues?.staticDuration ??
          formatDurationFromMillis(route.durationMillis ?? route.staticDurationMillis ?? 0),
        durationValue: route.durationMillis ?? route.staticDurationMillis ?? 0,
        distanceText:
          route.localizedValues?.distance ??
          formatDistanceFromMeters(route.distanceMeters ?? 0),
        distanceValue: route.distanceMeters ?? 0,
        summary: stripHtml(route.description) || MODE_META[requestedMode].label,
        path,
      },
    ];
  }

  const segments: SavedRouteSegment[] = [];

  for (const step of steps) {
    const nextSegment = createStepSegment(requestedMode, step);
    const previous = segments[segments.length - 1];
    const shouldMerge =
      !!previous &&
      previous.mode === nextSegment.mode &&
      nextSegment.mode !== 'TRANSIT';

    if (shouldMerge) {
      segments[segments.length - 1] = mergeSegments(previous, nextSegment);
    } else {
      segments.push(nextSegment);
    }
  }

  return segments.filter((segment) => segment.path.length > 0);
}

function buildRouteTransfers(
  routeMode: TravelModeKey,
  segments: SavedRouteSegment[]
): SavedRouteTransfer[] {
  if (routeMode !== 'TRANSIT') return [];

  const transfers: SavedRouteTransfer[] = [];
  let previousTransit: SavedRouteSegment | null = null;
  let skipNextTransfer = false;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment.mode === 'WALKING') {
      const previousTransitSegment = [...segments.slice(0, index)].reverse().find((item) => item.mode === 'TRANSIT');
      const nextTransitSegment = segments.slice(index + 1).find((item) => item.mode === 'TRANSIT');

      if (previousTransitSegment && nextTransitSegment) {
        const detail = [
          previousTransitSegment.arrivalStop,
          nextTransitSegment.departureStop,
        ]
          .filter(Boolean)
          .join(' -> ');

        transfers.push({
          type: 'WALK',
          title: `도보 ${segment.durationText}`,
          detail: detail || segment.summary,
        });
        skipNextTransfer = true;
      }

      continue;
    }

    if (segment.mode !== 'TRANSIT') continue;

    if (previousTransit) {
      if (skipNextTransfer) {
        skipNextTransfer = false;
      } else {
        const stopName = segment.departureStop ?? previousTransit.arrivalStop;
        transfers.push({
          type: 'TRANSFER',
          title: stopName ? `${stopName} 환승` : '환승',
          detail: [previousTransit.summary, segment.summary].filter(Boolean).join(' -> ') || undefined,
        });
      }
    }

    previousTransit = segment;
  }

  return transfers;
}

function getWalkingDurationText(
  routeMode: TravelModeKey,
  segments: SavedRouteSegment[]
) {
  if (routeMode !== 'TRANSIT') return undefined;

  const walkingMillis = segments
    .filter((segment) => segment.mode === 'WALKING')
    .reduce((sum, segment) => sum + segment.durationValue, 0);

  return walkingMillis > 0 ? formatDurationFromMillis(walkingMillis) : undefined;
}

function getTransferCount(
  routeMode: TravelModeKey,
  segments: SavedRouteSegment[]
) {
  if (routeMode !== 'TRANSIT') return 0;
  const transitSegments = segments.filter((segment) => segment.mode === 'TRANSIT').length;
  return Math.max(0, transitSegments - 1);
}

function getRouteSummary(
  mode: TravelModeKey,
  route: google.maps.routes.Route,
  segments: SavedRouteSegment[],
  transitLines: string[]
) {
  if (mode === 'TRANSIT' && transitLines.length > 0) {
    return transitLines.join(' · ');
  }

  const firstSegmentSummary = segments.find((segment) => segment.summary)?.summary;
  if (firstSegmentSummary) return firstSegmentSummary;

  const description = stripHtml(route.description);
  if (description) return description;

  if (transitLines.length > 0) {
    return transitLines.join(' · ');
  }

  return MODE_META[mode].label;
}

function toRouteOption(
  mode: TravelModeKey,
  route: google.maps.routes.Route,
  index: number
): RouteOption {
  const meta = MODE_META[mode];
  const firstLeg = route.legs?.[0];
  const segments = buildRouteSegments(mode, route);
  const transitLines = getTransitLines(route);
  const transfers = buildRouteTransfers(mode, segments);
  const { departureText, arrivalText } = getTransitTimes(route);
  const durationValue =
    route.durationMillis ??
    route.staticDurationMillis ??
    firstLeg?.durationMillis ??
    firstLeg?.staticDurationMillis ??
    Number.MAX_SAFE_INTEGER;
  const distanceMeters = route.distanceMeters ?? firstLeg?.distanceMeters;
  const path = getRoutePath(route, segments);

  return {
    id: `${mode}-${index}-${route.routeLabels?.join('-') ?? 'route'}`,
    mode,
    modeLabel: meta.label,
    modeIcon: meta.icon,
    summary: getRouteSummary(mode, route, segments, transitLines),
    durationText:
      route.localizedValues?.duration ??
      route.localizedValues?.staticDuration ??
      firstLeg?.localizedValues?.duration ??
      firstLeg?.localizedValues?.staticDuration ??
      formatDurationFromMillis(durationValue),
    durationValue,
    distanceText:
      route.localizedValues?.distance ??
      firstLeg?.localizedValues?.distance ??
      formatDistanceFromMeters(distanceMeters),
    departureText,
    arrivalText,
    transferCount: getTransferCount(mode, segments),
    walkingDurationText: getWalkingDurationText(mode, segments),
    transitLines,
    path,
    segments,
    transfers,
  };
}

function buildRouteRequest(
  mode: TravelModeKey,
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  options?: RouteSearchOptions
): google.maps.routes.ComputeRoutesRequest {
  const request: google.maps.routes.ComputeRoutesRequest = {
    origin,
    destination,
    travelMode: mode,
    computeAlternativeRoutes: true,
    fields: ROUTE_FIELDS,
    language: getBrowserLanguage(),
  };

  if (options?.departureTime) request.departureTime = options.departureTime;
  if (options?.arrivalTime) request.arrivalTime = options.arrivalTime;

  if (mode === 'TRANSIT' && options?.transitPreference) {
    request.transitPreference = options.transitPreference;
  }

  return request;
}

function getRouteStatus(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return error instanceof Error && error.message ? error.message : 'UNKNOWN_ERROR';
  }

  if ('status' in error && error.status) {
    return String(error.status);
  }

  if ('code' in error && error.code) {
    return String(error.code);
  }

  if ('message' in error && error.message) {
    return String(error.message);
  }

  return 'UNKNOWN_ERROR';
}

function describeConfigStatus(status: string): string {
  switch (status) {
    case 'FAILED_PRECONDITION':
    case 'PERMISSION_DENIED':
    case 'REQUEST_DENIED':
      return 'Routes API가 거부되었습니다. Google Cloud에서 Routes API와 API 키 제한을 확인하세요.';
    case 'RESOURCE_EXHAUSTED':
    case 'OVER_QUERY_LIMIT':
    case 'OVER_DAILY_LIMIT':
      return 'Routes API 사용량 또는 결제 한도를 초과했습니다. Google Cloud 결제와 쿼터를 확인하세요.';
    case 'INVALID_ARGUMENT':
      return 'Routes API 요청이 올바르지 않습니다. 요청 파라미터와 beta 채널 설정을 확인하세요.';
    case 'UNIMPLEMENTED':
      return '현재 로드된 Maps JavaScript API 채널에서 Route 클래스가 지원되지 않습니다. beta 채널 설정을 확인하세요.';
    case 'UNAVAILABLE':
      return 'Routes API에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도하세요.';
    default:
      return `경로 검색에 실패했습니다 (${status}).`;
  }
}

/**
 * Fetches route candidates (across travel modes and alternatives) from origin to
 * destination, sorted by travel time. Returns an empty array if none are found.
 */
export async function fetchRouteOptions(
  origin: [number, number],
  destination: [number, number],
  searchOptions?: RouteSearchOptions
): Promise<RouteOption[]> {
  if (typeof google === 'undefined' || !google.maps?.importLibrary) {
    throw new Error('지도 서비스가 아직 준비되지 않았습니다.');
  }

  const { Route } = (await google.maps.importLibrary('routes')) as google.maps.RoutesLibrary;

  if (typeof Route?.computeRoutes !== 'function') {
    throw new Error(
      'Route 클래스가 로드되지 않았습니다. Maps JavaScript API의 routes beta 채널 설정을 확인하세요.'
    );
  }

  const originLatLng = { lat: origin[0], lng: origin[1] };
  const destinationLatLng = { lat: destination[0], lng: destination[1] };
  const modes = searchOptions?.mode ? [searchOptions.mode] : MODES;

  const statuses: string[] = [];
  const perMode = await Promise.all(
    modes.map(async (mode) => {
      try {
        const { routes } = await Route.computeRoutes(
          buildRouteRequest(mode, originLatLng, destinationLatLng, searchOptions)
        );

        return (routes ?? [])
          .map((route, index) => toRouteOption(mode, route, index))
          .filter((routeOption) => routeOption.path.length > 0);
      } catch (error) {
        const status = getRouteStatus(error);
        statuses.push(`${mode}:${status}`);
        return [] as RouteOption[];
      }
    })
  );

  const routeOptions = perMode
    .flat()
    .sort((a, b) => a.durationValue - b.durationValue || a.id.localeCompare(b.id));

  if (routeOptions.length === 0) {
    console.warn('[routes] no routes found:', statuses.join(', '));
    const configStatus = statuses
      .map((entry) => entry.split(':')[1])
      .find((status) => CONFIG_ERROR_STATUSES.has(status));

    if (configStatus) {
      throw new Error(describeConfigStatus(configStatus));
    }
  }

  return routeOptions;
}
