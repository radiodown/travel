import type { ItineraryDay, ReservationInfo } from '../data/itinerary';

export function getDayReservationItems(day: ItineraryDay): ReservationInfo[] {
  const legacyReservations = day.reservations ?? [];
  const eventReservations = day.events.flatMap((event) => {
    if (!event.reservation) return [];

    const label = event.reservation.label.trim() || event.title.trim();
    const details = event.reservation.details.trim();
    if (!label || !details) return [];

    return [{ label, details }];
  });

  return [...legacyReservations, ...eventReservations];
}
