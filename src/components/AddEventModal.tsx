import { useState } from 'react';
import type { ItineraryEvent } from '../data/itinerary';

type Props = {
  onClose: () => void;
  onAdd: (event: ItineraryEvent) => void;
};

export default function AddEventModal({ onClose, onAdd }: Props) {
  const [time, setTime] = useState('');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const event: ItineraryEvent = { title: title.trim() };
    if (time.trim()) event.time = time.trim();
    if (location.trim()) event.location = location.trim();
    if (description.trim()) event.description = description.trim();

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
      event.coordinates = [latNum, lngNum];
    }

    onAdd(event);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>일정 추가</h3>
          <button className="modal-close" onClick={onClose} type="button">×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <label className="field">
            <span>제목 *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 프라하 성 방문"
              autoFocus
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>시간</span>
              <input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="10:00"
              />
            </label>
            <label className="field">
              <span>장소</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="난바"
              />
            </label>
          </div>

          <label className="field">
            <span>설명</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="간단한 메모"
              rows={2}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>위도 (lat)</span>
              <input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="50.0906"
              />
            </label>
            <label className="field">
              <span>경도 (lng)</span>
              <input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="14.4017"
              />
            </label>
          </div>
          <p className="field-hint">좌표를 입력하면 지도에 핀으로 표시됩니다.</p>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>취소</button>
            <button type="submit" className="btn-primary">추가하기</button>
          </div>
        </form>
      </div>
    </div>
  );
}
