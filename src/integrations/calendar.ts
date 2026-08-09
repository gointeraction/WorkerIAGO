/**
 * Calendar — Google Calendar integration for bookings
 * 
 * Check availability, create events, send reminders.
 * Requires: GOOGLE_CALENDAR_API_KEY, GOOGLE_CALENDAR_ID
 */

export interface CalendarConfig {
  apiKey: string;
  calendarId: string;
  timezone?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
  status: string;
}

export class GoogleCalendar {
  private config: CalendarConfig;
  private apiBase = 'https://www.googleapis.com/calendar/v3';

  constructor(config: CalendarConfig) {
    this.config = config;
  }

  /**
   * Check available time slots for a date
   */
  async getAvailableSlots(
    date: string,
    durationMinutes = 30,
    workHours = { start: 9, end: 17 }
  ): Promise<string[]> {
    const startOfDay = `${date}T${String(workHours.start).padStart(2, '0')}:00:00Z`;
    const endOfDay = `${date}T${String(workHours.end).padStart(2, '0')}:00:00Z`;

    const res = await fetch(
      `${this.apiBase}/calendars/${this.config.calendarId}/events?key=${this.config.apiKey}` +
      `&timeMin=${startOfDay}&timeMax=${endOfDay}&singleEvents=true&orderBy=startTime`,
    );
    const data = await res.json();
    const events = data.items || [];

    // Find free slots
    const slots: string[] = [];
    let currentHour = workHours.start;

    for (const event of events) {
      const eventStart = new Date(event.start?.dateTime || event.start?.date);
      const eventHour = eventStart.getHours();

      while (currentHour < eventHour && currentHour + durationMinutes / 60 <= workHours.end) {
        slots.push(`${date}T${String(currentHour).padStart(2, '0')}:00`);
        currentHour += 1;
      }
      currentHour = Math.max(currentHour, eventStart.getHours() + 1);
    }

    while (currentHour + durationMinutes / 60 <= workHours.end) {
      slots.push(`${date}T${String(currentHour).padStart(2, '0')}:00`);
      currentHour += 1;
    }

    return slots;
  }

  /**
   * Create calendar event
   */
  async createEvent(event: {
    summary: string;
    description?: string;
    start: string; // ISO string
    end: string;
    attendees?: string[];
  }): Promise<CalendarEvent | null> {
    try {
      const res = await fetch(
        `${this.apiBase}/calendars/${this.config.calendarId}/events?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: event.summary,
            description: event.description,
            start: { dateTime: event.start, timeZone: this.config.timezone || 'America/Caracas' },
            end: { dateTime: event.end, timeZone: this.config.timezone || 'America/Caracas' },
            attendees: event.attendees?.map(email => ({ email })),
          }),
        }
      );
      const data = await res.json();
      return {
        id: data.id,
        summary: data.summary,
        description: data.description,
        start: data.start?.dateTime,
        end: data.end?.dateTime,
        attendees: data.attendees?.map((a: any) => a.email),
        status: data.status,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get upcoming events
   */
  async getUpcomingEvents(days = 7): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(now.getTime() + days * 86400000);

    const res = await fetch(
      `${this.apiBase}/calendars/${this.config.calendarId}/events?key=${this.config.apiKey}` +
      `&timeMin=${now.toISOString()}&timeMax=${future.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`,
    );
    const data = await res.json();

    return (data.items || []).map((e: any) => ({
      id: e.id,
      summary: e.summary,
      description: e.description,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      attendees: e.attendees?.map((a: any) => a.email),
      status: e.status,
    }));
  }

  /**
   * Cancel event
   */
  async cancelEvent(eventId: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.apiBase}/calendars/${this.config.calendarId}/events/${eventId}?key=${this.config.apiKey}`,
        { method: 'DELETE' }
      );
      return res.ok;
    } catch (e) {
      return false;
    }
  }
}

/**
 * Format event for chat
 */
export function formatEventForChat(event: CalendarEvent): string {
  const start = new Date(event.start);
  const date = start.toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = start.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  
  return `📅 *${event.summary}*\n📆 ${date}\n🕐 ${time}\n📝 ${event.description || 'Sin descripción'}`;
}
