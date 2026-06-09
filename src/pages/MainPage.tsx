import { mainBg } from '../assets';

type Props = {
  onViewSchedule: () => void;
};

export default function MainPage({ onViewSchedule }: Props) {
  return (
    <div
      className="main-page"
      style={{ backgroundImage: `url(${mainBg})` }}
    >
      <div className="main-overlay" />

      {/* Top badge */}
      <div className="main-top">
        <span className="main-badge">✈ &nbsp; HONEYMOON</span>
      </div>

      {/* Bottom content */}
      <div className="main-content">
        <h1 className="main-title">
          <span className="main-title-year">2026</span>
          <span className="main-title-main">Europe</span>
        </h1>
        <div className="main-divider" />
        <p className="main-cities">Praha &nbsp;·&nbsp; Wien &nbsp;·&nbsp; Budapest</p>
        <p className="main-meta">2026.06.15 — 06.25 &nbsp;&nbsp;|&nbsp;&nbsp; 10박 11일 &nbsp;&nbsp;|&nbsp;&nbsp; 5개 도시</p>
        <button className="main-cta" onClick={onViewSchedule}>
          일정 확인하기 &nbsp;→
        </button>
      </div>
    </div>
  );
}
