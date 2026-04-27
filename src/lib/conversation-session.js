// Fields required per vertical for multi-turn data collection
const VERTICAL_FIELDS = {
  'Bike Rental': [
    { key: 'pickup_date', label: 'pickup date', question: 'What date do you want to pick up the bike? (YYYY-MM-DD)' },
    { key: 'return_date', label: 'return date', question: 'What date will you return it? (YYYY-MM-DD)' },
    { key: 'bike_model', label: 'bike model', question: 'Which bike model? (Hero, Honda, Bajaj, TVS, Royal Enfield)' },
    { key: 'id_document_type', label: 'ID type', question: 'Which ID document? (Aadhaar, Driving License, Passport)' },
    { key: 'id_number', label: 'ID number', question: 'Enter your ID number:' },
  ],
  'Hotel': [
    { key: 'check_in_date', label: 'check-in date', question: 'What date do you want to check in? (YYYY-MM-DD)' },
    { key: 'check_out_date', label: 'check-out date', question: 'What date will you check out? (YYYY-MM-DD)' },
    { key: 'guest_count', label: 'number of guests', question: 'How many guests?' },
  ],
  'Taxi': [
    { key: 'pickup_location', label: 'pickup location', question: 'Where should we pick you up?' },
    { key: 'dropoff_location', label: 'drop-off location', question: 'Where are you going?' },
    { key: 'pickup_time', label: 'pickup time', question: 'When do you need the pickup? (YYYY-MM-DD HH:MM)' },
  ],
  'Ticketing': [],
  'Social Media': [],
};

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

  addResponse(value) {
    const field = this.currentField;
    if (field) {
      this.collectedData[field.key] = value.trim();
      this.fieldIndex++;
      this.updatedAt = Date.now();
    }
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
    // Clean stale sessions on each access
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
      if (session.updatedAt < cutoff) {
        this.sessions.delete(phone);
      }
    }
  }
}

module.exports = { ConversationSessionManager, ConversationSession, VERTICAL_FIELDS };
