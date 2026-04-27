require('dotenv').config();
process.env.MOCHA_TEST_MODE = 'true';

const express = require('express');
const { app: app1_1 } = require('./1-1-whatsapp-webhook-integration');
const { app: app1_2 } = require('./1-2-ai-intent-classification-service');
const { app: app1_3 } = require('./1-3-classification-confidence-handling');
const { app: app1_4 } = require('./1-4-unified-enquiry-dashboard');
const { app: app1_5 } = require('./1-5-marketplace-enquiry-routing');
const { app: app2_1 } = require('./2-1-user-recognition-profile-retrieval');
const { app: app2_2 } = require('./2-2-conversation-history-persistence');
const { app: app2_3 } = require('./2-3-context-aware-booking-recommendations');
const { app: app3_1 } = require('./3-1-whatsapp-flow-framework-setup');
const { app: app3_2 } = require('./3-2-bike-rental-booking-flow');
const { app: app3_3 } = require('./3-3-taxi-booking-flow');
const { app: app3_4 } = require('./3-4-hotel-availability-booking-confirmation');
const { app: app4_1 } = require('./4-1-seamless-handoff-trigger');
const { app: app4_2 } = require('./4-2-context-transfer-to-agent');
const { app: app4_3 } = require('./4-3-agent-pool-routing');
const { app: app5_1 } = require('./5-1-supabase-conversation-storage');
const { app: app5_2 } = require('./5-2-cross-system-data-consistency');
const { app: app5_3 } = require('./5-3-backup-recovery-system');
const { app: app6_1 } = require('./6-1-api-downtime-detection-fallback');
const { app: app6_2 } = require('./6-2-rate-limit-monitoring');
const { app: app6_3 } = require('./6-3-uptime-error-monitoring-dashboard');
const { app: app7_1 } = require('./7-1-whatsapp-template-compliance');
const { app: app7_2 } = require('./7-2-data-protection-encryption');
const { app: app7_3 } = require('./7-3-audit-logging-system');
const { app: app8_1 } = require('./8-1-backend-system-routing');
const { app: app8_2 } = require('./8-2-erpnext-lead-management');
const { app: app8_3 } = require('./8-3-vendor-notification-system');
const { app: app8_4 } = require('./8-4-pms-inventory-synchronization');

const gateway = express();
gateway.use(express.json());

// ---------------------------------------------------------------------------
// Aggregated health endpoint (intercepted before service apps)
// ---------------------------------------------------------------------------
const GATEWAY_START_TIME = Date.now();

const serviceHealthEndpoints = [
  ['1-1 WhatsApp Webhook', '/health'],
  ['1-2 AI Intent Classification', '/api/health'],
  ['1-3 Confidence Handling', '/api/health'],
  ['1-4 Enquiry Dashboard', '/api/health'],
  ['1-5 Marketplace Routing', '/api/health'],
  ['2-1 User Recognition', '/api/health'],
  ['2-2 Conversation History', '/api/health'],
  ['2-3 Booking Recommendations', '/api/health'],
  ['3-1 Flow Framework', '/api/health'],
  ['3-2 Bike Rental Booking', '/api/health'],
  ['3-3 Taxi Booking', '/api/health'],
  ['3-4 Hotel Booking', '/api/health'],
  ['4-1 Handoff Trigger', '/api/health'],
  ['4-2 Context Transfer', '/api/health'],
  ['4-3 Agent Pool Routing', '/api/health'],
  ['5-1 Conversation Storage', '/api/health'],
  ['5-2 Data Consistency', '/api/health'],
  ['5-3 Backup Recovery', '/api/health'],
  ['6-1 Downtime Detection', '/api/health'],
  ['6-2 Rate Limit Monitoring', '/api/health'],
  ['6-3 Monitoring Dashboard', '/api/health'],
  ['7-1 Template Compliance', '/api/health'],
  ['7-2 Data Protection', '/api/health'],
  ['7-3 Audit Logging', '/api/health'],
  ['8-1 Backend Routing', '/api/health'],
  ['8-2 ERPNext Lead Management', '/api/health'],
  ['8-3 Vendor Notification', '/api/health'],
  ['8-4 PMS Inventory Sync', '/api/health'],
];

function aggregateHealth() {
  const services = serviceHealthEndpoints.map(([name]) => name);
  return {
    status: 'healthy',
    gateway_uptime_ms: Date.now() - GATEWAY_START_TIME,
    timestamp: new Date().toISOString(),
    total_services: services.length,
    services,
  };
}

gateway.get('/health', (_req, res) => {
  res.json(aggregateHealth());
});

gateway.get('/api/health', (_req, res) => {
  res.json(aggregateHealth());
});

// ---------------------------------------------------------------------------
// Mount service apps (order matters — mount without param routes first)
// ---------------------------------------------------------------------------
// Group 1: Services with only static/specific routes (no :param segments)
const staticRouteServices = [
  app1_1, app1_2, app1_3, app1_5,
  app2_2, app7_1, app7_2, app7_3,
  app8_1, app8_2, app8_3, app8_4,
  app6_2, app6_3,
];

// Group 2: Services with parameterized routes — mount after static ones
const paramRouteServices = [
  app1_4, app2_1, app2_3,
  app3_1, app3_2, app3_3, app3_4,
  app4_1, app4_2, app4_3,
  app5_1, app5_2, app5_3,
  app6_1,
];

for (const serviceApp of staticRouteServices) {
  gateway.use(serviceApp);
}
for (const serviceApp of paramRouteServices) {
  gateway.use(serviceApp);
}

// ---------------------------------------------------------------------------
// Fallback: 404 for unhandled routes
// ---------------------------------------------------------------------------
gateway.use((_req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found in any service',
      code: 404,
      details: 'The requested path does not match any registered service endpoint',
    },
  });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
gateway.use((err, _req, res, _next) => {
  console.error('Gateway error:', err);
  res.status(500).json({
    error: {
      message: 'Gateway internal error',
      code: 500,
    },
  });
});

// ---------------------------------------------------------------------------
// Start gateway
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3099;
gateway.listen(PORT, () => {
  console.log(`Gateway running on port ${PORT}`);
  console.log(`${serviceHealthEndpoints.length} services mounted`);
  console.log(`Health endpoint: http://localhost:${PORT}/api/health`);
});
