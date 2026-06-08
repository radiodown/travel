import type { ItineraryDay } from '../data/itinerary';

type Props = {
  day: ItineraryDay;
};

function getEventDescription(description?: string, note?: string) {
  const parts = [description?.trim(), note?.trim()].filter((value): value is string => !!value);
  return [...new Set(parts)].join(' · ');
}

export default function DayDetails({ day }: Props) {
  return (
    <div className="day-details">
      <div className="day-details-main">
        <div className="day-summary-card">
          <p className="eyebrow">{day.day}</p>
          <h3>{day.title}</h3>
          <p className="day-date">{day.date}</p>
          <p>{day.summary}</p>
        </div>

        <div className="event-list">
          {day.events.map((event, index) => {
            const eventDescription = getEventDescription(event.description, event.note);

            return (
              <article key={`${event.title}-${index}`} className="event-card">
                {event.time && <span className="event-time">{event.time}</span>}
                <div>
                  <h4>{event.title}</h4>
                  {event.location && <p className="event-location">{event.location}</p>}
                  {eventDescription && <p>{eventDescription}</p>}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <aside className="detail-aside">
        <div className="map-card">
          <p className="eyebrow">지도 아이디어</p>
          <h4>예상 이동 경로</h4>
          <p>{day.mapHint ?? '이번 여행의 이동 경로를 이곳에 표시합니다.'}</p>
          <div className="map-placeholder">Map Preview</div>
        </div>

        <div className="reservation-card">
          <p className="eyebrow">예약 정보</p>
          <h4>바로 확인</h4>
          {day.reservations?.length ? (
            <ul>
              {day.reservations.map((reservation, index) => (
                <li key={`${reservation.label}-${index}`}>
                  <strong>{reservation.label}</strong>
                  <p>{reservation.details}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>아직 추가된 예약 정보가 없습니다.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
