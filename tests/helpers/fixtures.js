module.exports = {
  validWebhookPayload: (overrides = {}) => ({
    From: '+91987654321',
    ProfileName: 'TestUser',
    WaId: 'wa-123456',
    Message: 'I want to rent a bike for this weekend',
    Timestamp: new Date('2026-04-21T10:00:00Z').toISOString(),
    ...overrides,
  }),

  outOfHoursPayload: () => ({
    From: '+91987654321',
    ProfileName: 'TestUser',
    WaId: 'wa-123456',
    Message: 'I need help',
    Timestamp: new Date('2026-04-21T20:00:00Z').toISOString(),
  }),

  ambiguousMessage: () => 'I have a complex enquiry involving multiple things and I am not sure what to do',

  bikeMessage: () => 'I need to rent a bike for this weekend in Hyderabad',

  hotelMessage: () => 'Do you have any deluxe rooms available next week?',

  customerProfile: (overrides = {}) => ({
    phone_number: '+91987654321',
    profile_data: {
      bookings: {
        bike_rental: [
          { booking_date: '2026-03-15', bike_model: 'Hero' },
          { booking_date: '2026-04-01', bike_model: 'Hero' },
        ],
        hotel: [],
        taxi: [],
        ticketing: [],
        social_media: [],
      },
    },
    ...overrides,
  }),

  newCustomerProfile: () => ({
    phone_number: '+91987654322',
    profile_data: { bookings: {}, preferences: {}, last_booking: null },
  }),

  bookingData: (overrides = {}) => ({
    phone_number: '+91987654321',
    pickup_date: '2026-05-01',
    return_date: '2026-05-03',
    bike_model: 'Hero',
    id_document_type: 'Driving License',
    id_number: 'DL12345678',
    ...overrides,
  }),

  leadData: (overrides = {}) => ({
    vertical: 'bike_rental',
    customer_name: 'Test User',
    phone_number: '+91987654321',
    intent: 'Bike rental booking for weekend',
    source: 'whatsapp',
    ...overrides,
  }),

  vendorData: (overrides = {}) => ({
    id: 'vendor-bike-1',
    name: 'Bike Rental Vendor',
    vertical: 'Bike Rental',
    channels: ['whatsapp'],
    phone: '+919999999999',
    ...overrides,
  }),

  conversationMessage: (overrides = {}) => ({
    phone_number: '+91987654321',
    content: 'I want to rent a bike',
    role: 'user',
    vertical: 'Bike Rental',
    session_id: null,
    metadata: {},
    ...overrides,
  }),
};
