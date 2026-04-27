// Field types: date, select, text, number, datetime
const VERTICAL_FIELDS = {
  'Bike Rental': [
    { key: 'pickup_date', type: 'date', label: 'pickup date', question: 'What date do you want to pick up the bike?', placeholder: 'e.g. 2026-05-15' },
    { key: 'return_date', type: 'date', label: 'return date', question: 'What date will you return it?', placeholder: 'e.g. 2026-05-18' },
    { key: 'bike_model', type: 'select', label: 'bike model', question: 'Which bike model?', options: ['Hero', 'Honda', 'Bajaj', 'TVS', 'Royal Enfield'] },
    { key: 'id_document_type', type: 'select', label: 'ID type', question: 'Which ID document?', options: ['Aadhaar', 'Driving License', 'Passport'] },
    { key: 'id_number', type: 'text', label: 'ID number', question: 'Enter your ID number:' },
  ],
  'Hotel': [
    { key: 'check_in_date', type: 'date', label: 'check-in date', question: 'What date do you want to check in?', placeholder: 'e.g. 2026-06-01' },
    { key: 'check_out_date', type: 'date', label: 'check-out date', question: 'What date will you check out?', placeholder: 'e.g. 2026-06-03' },
    { key: 'guest_count', type: 'number', label: 'number of guests', question: 'How many guests?', placeholder: 'e.g. 2' },
  ],
  'Taxi': [
    { key: 'pickup_location', type: 'text', label: 'pickup location', question: 'Where should we pick you up?', placeholder: 'e.g. Hitech City' },
    { key: 'dropoff_location', type: 'text', label: 'drop-off location', question: 'Where are you going?', placeholder: 'e.g. Gachibowli' },
    { key: 'pickup_time', type: 'datetime', label: 'pickup time', question: 'When do you need the pickup?', placeholder: 'e.g. 2026-06-01 10:00' },
  ],
  'Ticketing': [],
  'Social Media': [],
};

function isValidDate(str) {
  if (typeof str !== 'string') return false;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  return date.getFullYear() === parseInt(match[1])
    && date.getMonth() === parseInt(match[2]) - 1
    && date.getDate() === parseInt(match[3]);
}

function isFutureDate(str) {
  if (!isValidDate(str)) return false;
  const d = new Date(str + 'T00:00:00');
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
    return VERTICAL_FIELDS[this.vertical] || [];
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
        if (!isValidDate(trimmed)) {
          return { valid: false, error: `Please enter a valid date in YYYY-MM-DD format, ${field.placeholder}.` };
        }
        if (!isFutureDate(trimmed)) {
          return { valid: false, error: `${field.label} must be a future date. Please try again.` };
        }
        // Cross-field: pickup_date must be before return_date (and vice versa)
        if (field.key === 'return_date' && this.collectedData.pickup_date) {
          if (trimmed <= this.collectedData.pickup_date) {
            return { valid: false, error: 'Return date must be after pickup date. Please try again.' };
          }
        }
        if (field.key === 'check_out_date' && this.collectedData.check_in_date) {
          if (trimmed <= this.collectedData.check_in_date) {
            return { valid: false, error: 'Check-out date must be after check-in date. Please try again.' };
          }
        }
        if (field.key === 'pickup_date' && this.collectedData.return_date) {
          if (trimmed >= this.collectedData.return_date) {
            return { valid: false, error: 'Pickup date must be before return date. Please try again.' };
          }
        }
        if (field.key === 'check_in_date' && this.collectedData.check_out_date) {
          if (trimmed >= this.collectedData.check_out_date) {
            return { valid: false, error: 'Check-in date must be before check-out date. Please try again.' };
          }
        }
        return { valid: true };
      }
      case 'datetime': {
        // Accept YYYY-MM-DD HH:MM or ISO format
        const dtMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/);
        if (!dtMatch) {
          return { valid: false, error: `Please enter date and time in format: ${field.placeholder}` };
        }
        if (!isValidDate(dtMatch[1])) {
          return { valid: false, error: `Invalid date part. ${field.placeholder}` };
        }
        const dateStr = dtMatch[1];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (new Date(dateStr) <= today) {
          return { valid: false, error: `${field.label} must be in the future.` };
        }
        return { valid: true };
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
    switch (this.vertical) {
      case 'Bike Rental':
        return {
          phone_number: phoneNumber,
          pickup_date: d.pickup_date,
          return_date: d.return_date,
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

module.exports = { ConversationSessionManager, ConversationSession, VERTICAL_FIELDS };
