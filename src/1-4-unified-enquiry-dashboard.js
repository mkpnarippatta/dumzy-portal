const express = require('express');

// Enquiry data model
class Enquiry {
  constructor(id, phone, profileName, vertical, message, status, owner, timestamp) {
    this.id = id;
    this.phone = phone;
    this.profileName = profileName;
    this.vertical = vertical;
    this.message = message;
    this.status = status;
    this.owner = owner;
    this.timestamp = timestamp;
    this.messages = [];
  }

  addMessage(role, content, time) {
    this.messages.push({ role, content, time });
  }
}

// Dashboard configuration
const VERTICALS = ['Bike Rental', 'Hotel', 'Taxi', 'Ticketing', 'Social Media'];
const STATUSES = ['New', 'In Progress', 'Qualified', 'Booked', 'Lost'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

// In-memory enquiry storage (would be replaced with database in production)
const enquiries = new Map();

// Express app setup
const app = express();
app.use(express.json());

// GET /api/enquiries - List all enquiries with optional filters
app.get('/api/enquiries', (req, res) => {
  const {
    vertical,
    status,
    startDate,
    endDate,
    owner,
    sortBy = 'date',
    sortOrder = 'desc'
  } = req.query;

  let filteredEnquiries = Array.from(enquiries.values());

  // Filter by vertical
  if (vertical && VERTICALS.includes(vertical)) {
    filteredEnquiries = filteredEnquiries.filter(e => e.vertical === vertical);
  }

  // Filter by status
  if (status && STATUSES.includes(status)) {
    filteredEnquiries = filteredEnquiries.filter(e => e.status === status);
  }

  // Filter by date range
  if (startDate) {
    filteredEnquiries = filteredEnquiries.filter(e => new Date(e.timestamp) >= new Date(startDate));
  }
  if (endDate) {
    filteredEnquiries = filteredEnquiries.filter(e => new Date(e.timestamp) <= new Date(endDate));
  }

  // Filter by owner
  if (owner) {
    filteredEnquiries = filteredEnquiries.filter(e => e.owner === owner);
  }

  // Sort results
  filteredEnquiries.sort((a, b) => {
    const multiplier = sortOrder === 'desc' ? -1 : 1;

    if (sortBy === 'date') {
      return (new Date(a.timestamp) - new Date(b.timestamp)) * multiplier;
    }
    if (sortBy === 'status') {
      return (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)) * multiplier;
    }
    return 0;
  });

  res.status(200).json({
    count: filteredEnquiries.length,
    enquiries: filteredEnquiries
  });
});

// GET /api/enquiries/:id - Get single enquiry with chat history
app.get('/api/enquiries/:id', (req, res) => {
  const { id } = req.params;
  const enquiry = enquiries.get(id);

  if (!enquiry) {
    return res.status(404).json({ error: { message: 'Enquiry not found', code: 404, details: `No enquiry found with id: ${id}` } });
  }

  res.status(200).json(enquiry);
});

// POST /api/enquiries/:id/messages - Add message to enquiry chat history
app.post('/api/enquiries/:id/messages', (req, res) => {
  const { id } = req.params;
  const { role, content } = req.body;

  if (!role || !content) {
    return res.status(400).json({ error: { message: 'Role and content are required', code: 400, details: 'Missing required fields: role, content' } });
  }

  const enquiry = enquiries.get(id);
  if (!enquiry) {
    return res.status(404).json({ error: { message: 'Enquiry not found', code: 404, details: `No enquiry found with id: ${id}` } });
  }

  enquiry.addMessage(role, content, new Date().toISOString());

  res.status(200).json({
    success: true,
    message: 'Message added to chat history'
  });
});

// PUT /api/enquiries/:id/assign - Reassign enquiry to another owner
app.put('/api/enquiries/:id/assign', (req, res) => {
  const { id } = req.params;
  const { owner } = req.body;

  if (!owner) {
    return res.status(400).json({ error: { message: 'Owner is required', code: 400, details: 'Missing required field: owner' } });
  }

  const enquiry = enquiries.get(id);
  if (!enquiry) {
    return res.status(404).json({ error: { message: 'Enquiry not found', code: 404, details: `No enquiry found with id: ${id}` } });
  }

  enquiry.owner = owner;
  enquiry.status = 'In Progress'; // Auto-set to In Progress when reassigned

  res.status(200).json({
    success: true,
    message: 'Enquiry reassigned successfully',
    enquiry
  });
});

// PUT /api/enquiries/:id/status - Update enquiry status
app.put('/api/enquiries/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !STATUSES.includes(status)) {
    return res.status(400).json({ error: { message: 'Invalid status', code: 400, details: `Must be one of: ${STATUSES.join(', ')}` } });
  }

  const enquiry = enquiries.get(id);
  if (!enquiry) {
    return res.status(404).json({ error: { message: 'Enquiry not found', code: 404, details: `No enquiry found with id: ${id}` } });
  }

  enquiry.status = status;

  res.status(200).json({
    success: true,
    message: 'Status updated successfully',
    enquiry
  });
});

// GET /api/dashboard/filters - Get available filter options
app.get('/api/dashboard/filters', (req, res) => {
  res.status(200).json({
    verticals: VERTICALS,
    statuses: STATUSES,
    priorities: PRIORITIES
  });
});

// GET /api/dashboard/stats - Get dashboard statistics
app.get('/api/dashboard/stats', (req, res) => {
  const allEnquiries = Array.from(enquiries.values());

  const stats = {
    totalEnquiries: allEnquiries.length,
    byVertical: VERTICALS.reduce((acc, v) => {
      acc[v] = allEnquiries.filter(e => e.vertical === v).length;
      return acc;
    }, {}),
    byStatus: STATUSES.reduce((acc, s) => {
      acc[s] = allEnquiries.filter(e => e.status === s).length;
      return acc;
    }, {}),
    unassigned: allEnquiries.filter(e => !e.owner).length,
    todayCount: allEnquiries.filter(e => {
      const today = new Date().toISOString().split('T')[0];
      return e.timestamp.startsWith(today);
    }).length
  };

  res.status(200).json(stats);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: Date.now(),
    totalEnquiries: enquiries.size,
    endpoints: [
      'GET /api/enquiries',
      'GET /api/enquiries/:id',
      'POST /api/enquiries/:id/messages',
      'PUT /api/enquiries/:id/assign',
      'PUT /api/enquiries/:id/status',
      'GET /api/dashboard/filters',
      'GET /api/dashboard/stats',
      'GET /api/health'
    ]
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3019;

  app.listen(PORT, () => {
    console.log(`Unified Enquiry Dashboard API listening on port ${PORT}`);
    console.log(`Available verticals: ${VERTICALS.join(', ')}`);
    console.log(`Available statuses: ${STATUSES.join(', ')}`);
  });
}

module.exports = { app };


