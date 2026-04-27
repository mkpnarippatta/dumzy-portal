const express = require('express');

// Environment configuration
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.8');

// Agent pool configuration (vertical to pool mapping)
const AGENT_POOLS = {
  'Bike Rental': 'bike-rental-agents',
  'Hotel': 'hotel-agents',
  'Taxi': 'taxi-agents',
  'Ticketing': 'ticketing-agents',
  'Social Media': 'social-media-agents'
};

// Express app setup
const app = express();
app.use(express.json());

// Human handoff endpoint
app.post('/api/handoff', async (req, res) => {
  try {
    const handoffRequest = req.body;

    // Validate handoff request
    if (!handoffRequest.phone_number || !handoffRequest.enquiry_data) {
      return res.status(400).json({ error: { message: 'Phone number and enquiry data are required', code: 400, details: 'Missing required fields' } });
    }

    const { classified_vertical, confidence } = handoffRequest.enquiry_data;

    // Get agent pool for the classified vertical
    const agentPool = AGENT_POOLS[classified_vertical] || 'generalist-agents';

    // Handoff logic: route to appropriate agent pool
    const handoffData = {
      phone_number: handoffRequest.phone_number,
      vertical: classified_vertical,
      confidence: confidence,
      agent_pool: agentPool,
      timestamp: new Date().toISOString(),
      conversation_history: handoffRequest.enquiry_data.conversation_history || []
    };

    // Log handoff request
    console.log(`Handoff triggered for ${handoffRequest.phone_number} (${classified_vertical}) to ${agentPool}`);

    // Send notification to agents (this would integrate with your agent notification system)
    // For now, returning success response
    res.status(200).json({
      status: 'handed_off',
      agent_pool: agentPool,
      confidence: confidence,
      message: 'Enquiry has been transferred to human agent pool for resolution'
    });

  } catch (error) {
    console.error('Handoff error:', error);
    res.status(500).json({
      error: { message: 'Failed to process handoff request', code: 500, details: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
});

// Extended classification endpoint with confidence-based routing
// In production, this would be integrated into existing classification service
app.post('/api/intent/classify-with-handoff', async (req, res) => {
  try {
    const { message, conversation_context } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: { message: 'Message is required', code: 400, details: 'Missing required field: message' } });
    }

    // This would call actual AI classifier here
    // For this demo, simulating classification with confidence
    const confidence = Math.random(); // Simulated confidence 0-100%
    const verticals = ['Bike Rental', 'Hotel', 'Taxi', 'Ticketing', 'Social Media'];
    const selectedVertical = verticals[Math.floor(confidence * verticals.length)];
    const requiresHandoff = confidence < CONFIDENCE_THRESHOLD;

    // Response that would come from AI classifier
    const classifyResponse = {
      vertical: selectedVertical,
      confidence: confidence,
      requires_human_handoff: requiresHandoff,
      reasoning: confidence < 0.5 ? 'Very low confidence, ambiguous query' : 'Reasonable confidence for classification'
    };

    res.status(200).json(classifyResponse);
  } catch (error) {
    console.error('Classification with handoff error:', error);
    res.status(500).json({
      error: { message: 'Failed to classify with handoff routing', code: 500, details: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
});

// Start server (only if not imported by tests)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3018;

  app.listen(PORT, () => {
    console.log(`Classification Confidence Handling Service listening on port ${PORT}`);
    console.log(`Confidence threshold: ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%`);
    console.log(`Agent pools: ${JSON.stringify(AGENT_POOLS, null, 2)}`);
  });
}

module.exports = { app };


