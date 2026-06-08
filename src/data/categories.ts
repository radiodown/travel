export type EventCategory =
  | 'move'
  | 'flight'
  | 'food'
  | 'sightseeing'
  | 'shopping'
  | 'stay'
  | 'etc';

export type CategoryConfig = {
  label: string;
  icon: string;
  color: string;
  light: string;
};

export const CATEGORIES: Record<EventCategory, CategoryConfig> = {
  move: { label: '이동', icon: '🚆', color: '#0284c7', light: '#e0f2fe' },
  flight: { label: '항공', icon: '✈️', color: '#0f766e', light: '#ccfbf1' },
  food: { label: '식사', icon: '🍽️', color: '#ea580c', light: '#ffedd5' },
  sightseeing: { label: '관광', icon: '📷', color: '#7c3aed', light: '#f3e8ff' },
  shopping: { label: '쇼핑', icon: '🛍️', color: '#db2777', light: '#fce7f3' },
  stay: { label: '숙박', icon: '🏨', color: '#16a34a', light: '#dcfce7' },
  etc: { label: '기타', icon: '📌', color: '#64748b', light: '#f1f5f9' },
};

export const CATEGORY_ORDER: EventCategory[] = [
  'move',
  'flight',
  'food',
  'sightseeing',
  'shopping',
  'stay',
  'etc',
];
