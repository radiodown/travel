import type { RouteOption, TravelModeKey } from '../utils/directions';

type TransitPreferenceKey = 'FEWER_TRANSFERS' | 'LESS_WALKING';

type Props = {
  originTitle: string;
  destinationTitle: string;
  mode: TravelModeKey;
  departureTime: string;
  transitPreference: TransitPreferenceKey;
  loading: boolean;
  error: string | null;
  options: RouteOption[];
  onModeChange: (mode: TravelModeKey) => void;
  onDepartureTimeChange: (time: string) => void;
  onTransitPreferenceChange: (preference: TransitPreferenceKey) => void;
  onSelect: (option: RouteOption) => void;
  onClose: () => void;
};

const MODE_OPTIONS: Array<{ mode: TravelModeKey; label: string; icon: string }> = [
  { mode: 'TRANSIT', label: '대중교통', icon: '🚇' },
  { mode: 'DRIVING', label: '자동차', icon: '🚗' },
  { mode: 'WALKING', label: '도보', icon: '🚶' },
  { mode: 'BICYCLING', label: '자전거', icon: '🚲' },
];

const TRANSIT_PREFERENCES: Array<{ key: TransitPreferenceKey; label: string; note: string }> = [
  { key: 'FEWER_TRANSFERS', label: '환승 적게', note: '갈아타는 횟수를 줄입니다.' },
  { key: 'LESS_WALKING', label: '도보 적게', note: '걷는 구간을 줄입니다.' },
];

function getTransferLabel(option: RouteOption) {
  if (option.mode !== 'TRANSIT') return null;
  return option.transferCount > 0 ? `환승 ${option.transferCount}회` : '직행';
}

function getMetaLabels(option: RouteOption) {
  const labels = [getTransferLabel(option)];
  if (option.walkingDurationText) {
    labels.push(`도보 ${option.walkingDurationText}`);
  }
  if (option.departureText && option.arrivalText) {
    labels.push(`${option.departureText} - ${option.arrivalText}`);
  }
  return labels.filter(Boolean) as string[];
}

export default function RoutePickerModal({
  originTitle,
  destinationTitle,
  mode,
  departureTime,
  transitPreference,
  loading,
  error,
  options,
  onModeChange,
  onDepartureTimeChange,
  onTransitPreferenceChange,
  onSelect,
  onClose,
}: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal route-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>경로 저장</h3>
          <button className="modal-close" onClick={onClose} type="button" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="route-modal-body">
          <p className="route-modal-leg">
            <span className="route-modal-from">{originTitle}</span>
            <span className="route-modal-arrow" aria-hidden="true">
              →
            </span>
            <span className="route-modal-to">{destinationTitle}</span>
          </p>

          <div className="route-mode-picker" role="tablist" aria-label="교통수단 선택">
            {MODE_OPTIONS.map((item) => (
              <button
                key={item.mode}
                className={`route-mode-chip${mode === item.mode ? ' is-active' : ''}`}
                onClick={() => onModeChange(item.mode)}
                type="button"
                role="tab"
                aria-selected={mode === item.mode}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {mode === 'TRANSIT' && (
            <div className="route-transit-controls">
              <label className="field route-time-field">
                <span>출발 시간</span>
                <input
                  type="time"
                  step={300}
                  value={departureTime}
                  onChange={(e) => onDepartureTimeChange(e.target.value)}
                />
              </label>

              <div className="route-pref-group">
                <span className="route-pref-label">선호 옵션</span>
                <div className="route-pref-grid">
                  {TRANSIT_PREFERENCES.map((item) => (
                    <button
                      key={item.key}
                      className={`route-pref-chip${transitPreference === item.key ? ' is-active' : ''}`}
                      onClick={() => onTransitPreferenceChange(item.key)}
                      type="button"
                    >
                      <strong>{item.label}</strong>
                      <span>{item.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {loading && <p className="route-modal-status">경로를 찾는 중입니다...</p>}

          {!loading && error && <p className="route-modal-status error">{error}</p>}

          {!loading && !error && options.length === 0 && (
            <p className="route-modal-status">선택한 조건으로 찾은 경로가 없습니다.</p>
          )}

          {!loading && options.length > 0 && (
            <ul className="route-option-list">
              {options.map((option) => (
                <li key={option.id}>
                  <button className="route-option" onClick={() => onSelect(option)} type="button">
                    <span className="route-option-icon" aria-hidden="true">
                      {option.modeIcon}
                    </span>
                    <span className="route-option-info">
                      <span className="route-option-top">
                        <span className="route-option-mode">{option.modeLabel}</span>
                        <span className="route-option-duration">{option.durationText}</span>
                      </span>
                      <span className="route-option-summary">{option.summary}</span>
                      <span className="route-option-meta route-option-meta-tight">
                        {getMetaLabels(option).map((label) => (
                          <span key={label} className="route-option-tag">
                            {label}
                          </span>
                        ))}
                        {option.distanceText && (
                          <span className="route-option-distance">{option.distanceText}</span>
                        )}
                      </span>
                      {option.transfers.length > 0 && (
                        <span className="route-option-transfer-list">
                          {option.transfers.slice(0, 3).map((transfer, index) => (
                            <span key={`${transfer.type}-${transfer.title}-${index}`} className="route-option-transfer">
                              <strong>{transfer.title}</strong>
                              {transfer.detail && <span>{transfer.detail}</span>}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="route-option-add" aria-hidden="true">
                      +
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
