const express = require('express');

// DeepSeek configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

// Vertical classification targets
const VERTICALS = ['Bike Rental', 'Hotel', 'Taxi', 'Ticketing', 'Social Media'];
const CONFIDENCE_THRESHOLD = 0.8;

// Express app setup
const app = express();
app.use(express.json());

const SYSTEM_PROMPT = `You are an intent classifier for a travel and services marketplace. Classify the user's message into one of these verticals:

- **Bike Rental**: renting bikes, scooters, bicycles, enquiring about bike availability, pricing, rentals
- **Hotel**: booking rooms, accommodation, stay, lodging, hotel enquiries, resorts
- **Taxi**: cab booking, ride booking, transport, airport transfer, car rental with driver
- **Ticketing**: event tickets, concert tickets, movie tickets, show booking, amusement park, bus tickets, train tickets, travel tickets, booking a seat on a bus/train/plane
- **Social Media**: social media management, posting, advertising, digital marketing, content creation
- **Unknown**: doesn't clearly match any of the above

Respond in JSON format only:
{"vertical": "<one of the verticals or Unknown>", "confidence": <0.0 to 1.0>, "reasoning": "<brief reason>"}

Confidence should be >= 0.9 for clear matches, 0.7-0.89 for reasonable matches, < 0.7 for ambiguous. Multi-intent messages should go to Unknown with low confidence unless one intent clearly dominates.`;

// Intent classification endpoint
app.post('/api/intent/classify', async (req, res) => {
  try {
    const { message, conversation_context } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: { message: 'Message is required', code: 400, details: 'Missing required field: message' } });
    }

    let classifyResponse;

    // Try DeepSeek API, fallback to simulation
    try {
      if (!DEEPSEEK_API_KEY) throw new Error('DeepSeek API key not configured');

      const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
      if (conversation_context) {
        messages.push({ role: 'user', content: `Previous context: ${conversation_context}` });
      }
      messages.push({ role: 'user', content: message });

      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          response_format: { type: 'json_object' },
          max_tokens: 200,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DeepSeek API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from DeepSeek');

      classifyResponse = JSON.parse(content);

      // Validate response shape
      if (!classifyResponse.vertical || typeof classifyResponse.confidence !== 'number') {
        throw new Error('Invalid response format from DeepSeek');
      }
    } catch (apiError) {
      console.warn('DeepSeek API unavailable, using simulation fallback:', apiError.message);
      classifyResponse = simulateClassification(message);
    }

    const requiresHandoff = classifyResponse.confidence < CONFIDENCE_THRESHOLD;

    res.status(200).json({
      vertical: classifyResponse.vertical,
      confidence: classifyResponse.confidence,
      requires_human_handoff: requiresHandoff,
      reasoning: classifyResponse.reasoning || 'N/A',
    });
  } catch (error) {
    console.error('Intent classification error:', error);
    res.status(500).json({
      error: { message: 'Failed to classify intent', code: 500, details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

// Simulation fallback for testing when DeepSeek is unavailable
function simulateClassification(message) {
  const msg = message.toLowerCase();

  if (msg.includes('bike') || msg.includes('scooter') || msg.includes('rent') || msg.includes('cycle')) {
    return { vertical: 'Bike Rental', confidence: 0.9, reasoning: 'Keywords: bike/scooter/rent' };
  } else if (msg.includes('hotel') || msg.includes('room') || msg.includes('stay') || msg.includes('lodging') || msg.includes('accommodation')) {
    return { vertical: 'Hotel', confidence: 0.85, reasoning: 'Keywords: hotel/room/stay' };
  } else if (msg.includes('taxi') || msg.includes('cab') || msg.includes('ride') || msg.includes('pickup') || msg.includes('drop')) {
    return { vertical: 'Taxi', confidence: 0.85, reasoning: 'Keywords: taxi/cab/ride' };
  } else if (msg.includes('ticket') || msg.includes('concert') || msg.includes('event') || msg.includes('show') || msg.includes('movie') || msg.includes('bus ticket')) {
    return { vertical: 'Ticketing', confidence: 0.82, reasoning: 'Keywords: ticket/concert/event' };
  } else if (msg.includes('social') || msg.includes('instagram') || msg.includes('facebook') || msg.includes('marketing') || msg.includes('advert')) {
    return { vertical: 'Social Media', confidence: 0.85, reasoning: 'Keywords: social/marketing/advert' };
  } else if (msg.includes('complex') || msg.includes('multiple')) {
    return { vertical: 'Unknown', confidence: 0.6, reasoning: 'Ambiguous: complex/multiple intents' };
  }

  return { vertical: 'Unknown', confidence: 0.5, reasoning: 'No matching keywords' };
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: Date.now(),
    deepseek_configured: !!DEEPSEEK_API_KEY,
  });
});

// Start server (only if not imported by tests)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3017;

  app.listen(PORT, () => {
    console.log(`AI Intent Classification Service listening on port ${PORT}`);
    console.log(`DeepSeek model: ${DEEPSEEK_MODEL}`);
    console.log(`Confidence threshold: ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%`);
    console.log(`Verticals: ${VERTICALS.join(', ')}`);
  });
}

module.exports = { app };
