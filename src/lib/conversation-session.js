// Field types: date, select, text, number, datetime
const VERTICAL_FIELDS = {
  'Bike Rental': [
    { key: 'pickup_date', type: 'datetime', label: 'pickup date & time', question: 'When do you want to pick up the bike?', placeholder: 'tomorrow 10:00, 15 May 14:30' },
    { key: 'return_date', type: 'datetime', label: 'return date & time', question: 'When will you return it?', placeholder: '18 May 16:00, Saturday 12:00' },
    { key: 'bike_model', type: 'select', label: 'bike model', question: 'Which bike model?', options: ['Hero', 'Honda', 'Bajaj', 'TVS', 'Royal Enfield'] },
    { key: 'id_document_type', type: 'select', label: 'ID type', question: 'Which ID document?', options: ['Aadhaar', 'Driving License', 'Passport'] },
    { key: 'id_number', type: 'text', label: 'ID number', question: 'Enter your ID number:' },
  ],
  'Hotel': [
    { key: 'check_in_date', type: 'date', label: 'check-in date', question: 'What date do you want to check in?', placeholder: 'tomorrow, 1 June, next week' },
    { key: 'check_out_date', type: 'date', label: 'check-out date', question: 'What date will you check out?', placeholder: '3 June, Friday, 2026-06-05' },
    { key: 'guest_count', type: 'number', label: 'number of guests', question: 'How many guests?', placeholder: 'e.g. 2' },
  ],
  'Taxi': [
    { key: 'pickup_location', type: 'text', label: 'pickup location', question: 'Where should we pick you up?', placeholder: 'e.g. Hitech City' },
    { key: 'dropoff_location', type: 'text', label: 'drop-off location', question: 'Where are you going?', placeholder: 'e.g. Gachibowli' },
    { key: 'pickup_time', type: 'datetime', label: 'pickup time', question: 'When do you need the pickup?', placeholder: 'tomorrow 10:00, today 14:30' },
  ],
  'Ticketing': [
    { key: 'ticket_type', type: 'select', label: 'ticket type', question: 'Which type of ticket do you need?', options: ['Bus', 'Train', 'Flight', 'Film City'] },
    { key: 'source_location', type: 'text', label: 'from location', question: 'Where are you departing from?', placeholder: 'e.g. Hyderabad' },
    { key: 'destination_location', type: 'text', label: 'to location', question: 'Where are you going?', placeholder: 'e.g. Goa, Mumbai, Ramoji Film City' },
    { key: 'travel_date', type: 'date', label: 'travel date', question: 'What date do you want to travel?', placeholder: 'tomorrow, 15 June, next week' },
    { key: 'number_of_tickets', type: 'number', label: 'number of tickets', question: 'How many tickets?', placeholder: 'e.g. 2' },
  ],
  'Social Media': [],
  'Tour Packages': [
    { key: 'package_type', type: 'select', label: 'package type', question: 'Which type of tour package are you looking for?', options: ['Hyderabad City Tour', 'Heritage & Monuments', 'Pilgrimage', 'Weekend Getaway', 'Adventure'] },
    { key: 'number_of_days', type: 'number', label: 'number of days', question: 'How many days is the tour?', placeholder: 'e.g. 3' },
    { key: 'number_of_people', type: 'number', label: 'number of people', question: 'How many people?', placeholder: 'e.g. 2' },
    { key: 'preferred_start_date', type: 'date', label: 'preferred start date', question: 'What date would you like to start?', placeholder: 'tomorrow, 15 June, next week' },
  ],
};

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTHS_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function toDate(year, month, day) {
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null;
}

// Parse natural language date strings into YYYY-MM-DD, or null on failure
function parseDate(str) {
  if (typeof str !== 'string') return null;
  let s = str.trim().toLowerCase();

  // Already ISO format YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = toDate(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    return d ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  // Relative dates
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  function fmt(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

  if (s === 'today' || s === 'now') return fmt(today);
  if (s === 'tomorrow' || s === 'tom') return fmt(tomorrow);
  if (s === 'day after tomorrow') {
    const d = new Date(today); d.setDate(d.getDate() + 2);
    return fmt(d);
  }

  // "next Monday", "this Friday", "coming Sunday"
  const dayMatch = s.match(/^(next|this|coming)\s+(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (dayMatch) {
    const targetDay = DAY_NAMES.findIndex(d => d.startsWith(dayMatch[2].slice(0,3)));
    if (targetDay >= 0) {
      const d = new Date(today);
      // If "this" weekday: find the next occurrence (or today if same day)
      if (dayMatch[1] === 'next') d.setDate(d.getDate() + 7);
      const currentDay = d.getDay();
      let diff = targetDay - currentDay;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return fmt(d);
    }
  }

  // "15 May 2026", "15th May 2026", "15 may 2026"
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s*(\d{4})?$/);
  if (m) {
    const day = parseInt(m[1]);
    const monthIdx = MONTHS.indexOf(m[2]) >= 0 ? MONTHS.indexOf(m[2]) : MONTHS_SHORT.indexOf(m[2]);
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      const year = m[3] ? parseInt(m[3]) : today.getFullYear();
      const d = toDate(year, monthIdx, day);
      if (d) return fmt(d);
    }
  }

  // "15-05-2026", "15/05/2026", "15.05.2026" (DD-MM-YYYY or DD/MM/YYYY)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const day = parseInt(m[1]), month = parseInt(m[2]), year = parseInt(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = toDate(year, month - 1, day);
      if (d) return fmt(d);
      // Try month-day-year (US format)
      const d2 = toDate(year, day - 1, month);
      if (d2) return fmt(d2);
    }
  }

  // "15 May" (no year — assume this year or next if already passed)
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/);
  if (m) {
    const day = parseInt(m[1]);
    const monthIdx = MONTHS.indexOf(m[2]) >= 0 ? MONTHS.indexOf(m[2]) : MONTHS_SHORT.indexOf(m[2]);
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      let year = today.getFullYear();
      let d = toDate(year, monthIdx, day);
      if (d && d <= today) { year++; d = toDate(year, monthIdx, day); }
      if (d) return fmt(d);
    }
  }

  return null;
}

function isValidDate(str) {
  return !!parseDate(str);
}

function isFutureDate(str) {
  const parsed = parseDate(str);
  if (!parsed) return false;
  const d = new Date(parsed + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d > today;
}

class ConversationSession {
  constructor(phoneNumber, vertical) {
    this.phoneNumber = phoneNumber;
    this.vertical = vertical;
    this.collectedData = {};
    this.fieldIndex = 0;
    this.status = 'collecting';
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  get fields() {
    const base = VERTICAL_FIELDS[this.vertical] || [];
    if (this.vertical === 'Ticketing' && this.collectedData.ticket_type === 'Film City') {
      return base.filter(f => f.key !== 'source_location' && f.key !== 'destination_location');
    }
    return base;
  }

  get isComplete() {
    return this.fields.length === 0 || this.fieldIndex >= this.fields.length;
  }

  get currentField() {
    return this.fields[this.fieldIndex] || null;
  }

  get missingFields() {
    return this.fields.slice(this.fieldIndex);
  }

  // Validate a response for the current field. Returns { valid, error }
  validateResponse(value) {
    const field = this.currentField;
    if (!field) return { valid: true };

    const trimmed = (value || '').trim();
    if (!trimmed) return { valid: false, error: `${field.label} is required. Please enter a value.` };

    switch (field.type) {
      case 'date': {
        const normalizedDate = parseDate(trimmed);
        if (!normalizedDate) {
          return { valid: false, error: `I didn't recognise that date. Try formats like "tomorrow", "15 May", or "2026-06-01".` };
        }
        if (!isFutureDate(normalizedDate)) {
          return { valid: false, error: `${field.label} must be a future date. Please try again.` };
        }
        // Cross-field: pickup_date must be before return_date (and vice versa)
        if (field.key === 'return_date' && this.collectedData.pickup_date) {
          if (normalizedDate <= this.collectedData.pickup_date) {
            return { valid: false, error: 'Return date must be after pickup date. Please try again.' };
          }
        }
        if (field.key === 'check_out_date' && this.collectedData.check_in_date) {
          if (normalizedDate <= this.collectedData.check_in_date) {
            return { valid: false, error: 'Check-out date must be after check-in date. Please try again.' };
          }
        }
        if (field.key === 'pickup_date' && this.collectedData.return_date) {
          if (normalizedDate >= this.collectedData.return_date) {
            return { valid: false, error: 'Pickup date must be before return date. Please try again.' };
          }
        }
        if (field.key === 'check_in_date' && this.collectedData.check_out_date) {
          if (normalizedDate >= this.collectedData.check_out_date) {
            return { valid: false, error: 'Check-in date must be before check-out date. Please try again.' };
          }
        }
        return { valid: true, normalized: normalizedDate };
      }
      case 'datetime': {
        // Accept "tomorrow 10:00", "15 May 10:30", "2026-06-01 10:00" etc.
        const dtMatch = trimmed.match(/^(.+?)\s+(\d{1,2}:\d{2})(?:\s*(?:am|pm))?$/i);
        if (!dtMatch) {
          return { valid: false, error: `Please enter date and time — e.g. "tomorrow 10:00" or "15 May 14:30".` };
        }
        const parsedDate = parseDate(dtMatch[1].trim());
        if (!parsedDate) {
          return { valid: false, error: `I didn't recognise the date. Try "tomorrow 10:00" or "${field.placeholder}".` };
        }
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (new Date(parsedDate) <= today) {
          return { valid: false, error: `${field.label} must be in the future.` };
        }
        return { valid: true, normalized: `${parsedDate} ${dtMatch[2]}` };
      }
      case 'number': {
        const num = parseInt(trimmed, 10);
        if (isNaN(num) || num < 1) {
          return { valid: false, error: `Please enter a valid number for ${field.label}.` };
        }
        return { valid: true };
      }
      case 'select': {
        if (!field.options) return { valid: true };
        const match = field.options.find(o => o.toLowerCase() === trimmed.toLowerCase());
        if (!match) {
          return { valid: false, error: `Please choose from: ${field.options.join(', ')}` };
        }
        // Normalize to correct casing
        return { valid: true, normalized: match };
      }
      default:
        return { valid: true };
    }
  }

  // Add a validated response. Returns { ok, error? }
  addResponse(value) {
    const field = this.currentField;
    if (!field) return { ok: false, error: 'No active field' };

    const validation = this.validateResponse(value);
    if (!validation.valid) {
      return { ok: false, error: validation.error };
    }

    this.collectedData[field.key] = validation.normalized || value.trim();
    this.fieldIndex++;
    this.updatedAt = Date.now();
    return { ok: true };
  }

  getSubmissionPayload(phoneNumber) {
    const d = this.collectedData;
    // Extract just the date part (YYYY-MM-DD) from datetime strings for API compatibility
    const dateOnly = (dt) => dt ? dt.split(' ')[0] : dt;
    switch (this.vertical) {
      case 'Bike Rental':
        return {
          phone_number: phoneNumber,
          pickup_date: dateOnly(d.pickup_date),
          return_date: dateOnly(d.return_date),
          bike_model: d.bike_model,
          id_document_type: d.id_document_type,
          id_number: d.id_number,
        };
      case 'Hotel':
        return {
          phone_number: phoneNumber,
          check_in_date: d.check_in_date,
          check_out_date: d.check_out_date,
          guest_count: parseInt(d.guest_count, 10) || 1,
        };
      case 'Taxi':
        return {
          phone_number: phoneNumber,
          pickup_location: d.pickup_location,
          dropoff_location: d.dropoff_location,
          pickup_time: d.pickup_time,
          contact_number: phoneNumber,
        };
      case 'Tour Packages':
        return {
          phone_number: phoneNumber,
          package_type: d.package_type,
          number_of_days: parseInt(d.number_of_days, 10) || 1,
          number_of_people: parseInt(d.number_of_people, 10) || 1,
          preferred_start_date: d.preferred_start_date,
        };
      case 'Ticketing':
        return {
          phone_number: phoneNumber,
          ticket_type: d.ticket_type,
          source_location: d.source_location,
          destination_location: d.destination_location,
          travel_date: d.travel_date,
          number_of_tickets: parseInt(d.number_of_tickets, 10) || 1,
        };
      default:
        return {};
    }
  }
}

class ConversationSessionManager {
  constructor(timeoutMs = 30 * 60 * 1000) {
    this.sessions = new Map();
    this.timeout = timeoutMs;
  }

  getOrCreateSession(phoneNumber, vertical) {
    this._cleanup();
    const existing = this.sessions.get(phoneNumber);
    if (existing) return existing;
    const session = new ConversationSession(phoneNumber, vertical);
    this.sessions.set(phoneNumber, session);
    return session;
  }

  getSession(phoneNumber) {
    this._cleanup();
    const session = this.sessions.get(phoneNumber);
    if (session) session.updatedAt = Date.now();
    return session || null;
  }

  removeSession(phoneNumber) {
    this.sessions.delete(phoneNumber);
  }

  _cleanup() {
    const cutoff = Date.now() - this.timeout;
    for (const [phone, session] of this.sessions) {
      if (session.updatedAt < cutoff) this.sessions.delete(phone);
    }
  }
}

module.exports = { ConversationSessionManager, ConversationSession, VERTICAL_FIELDS, parseDate };
