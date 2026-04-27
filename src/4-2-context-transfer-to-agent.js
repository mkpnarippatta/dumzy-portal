const express = require('express');

// ============================================================================
// CONVERSATION HISTORY SERVICE
// ============================================================================

class ConversationHistoryService {
  constructor() {
    this.conversationHistory = new Map();
    this.messageCounter = 0;
  }

  getHistoryByPhone(phoneNumber) {
    const messages = this.conversationHistory.get(phoneNumber) || [];

    const result = {
      phone_number: phoneNumber,
      messages: messages,
      message_count: messages.length,
      first_message_time: messages.length > 0 ? messages[0].timestamp : null,
      last_message_time: messages.length > 0 ? messages[messages.length - 1].timestamp : null
    };

    return result;
  }

  addMessage(phoneNumber, message, direction = 'incoming') {
    const messages = this.conversationHistory.get(phoneNumber) || [];
    const newMessage = {
      id: this.generateMessageId(),
      phone_number: phoneNumber,
      direction,
      message: message,
      timestamp: new Date().toISOString()
    };
    messages.push(newMessage);
    this.conversationHistory.set(phoneNumber, messages);
    return newMessage;
  }

  generateMessageId() {
    this.messageCounter++;
    return `msg-${Date.now()}-${this.messageCounter}`;
  }
}

// ============================================================================
// FLOW DATA SERVICE
// ============================================================================

class FlowDataService {
  constructor() {
    this.flowSubmissions = new Map();
    this.submissionCounter = 0;
  }

  getFlowDataByPhone(phoneNumber) {
    const submissions = this.flowSubmissions.get(phoneNumber) || [];

    return {
      phone_number: phoneNumber,
      flow_submissions: submissions.map(sub => ({
        submission_id: sub.id,
        flow_name: sub.flow_name,
        flow_type: sub.flow_type,
        vertical: sub.vertical,
        fields: sub.fields,
        submitted_at: sub.submitted_at
      })),
      total_submissions: submissions.length
    };
  }

  addFlowSubmission(phoneNumber, flowData) {
    const submissions = this.flowSubmissions.get(phoneNumber) || [];
    const newSubmission = {
      id: this.generateSubmissionId(),
      phone_number: phoneNumber,
      flow_name: flowData.flowName,
      flow_type: flowData.flowType,
      vertical: flowData.vertical,
      fields: flowData.fields,
      submitted_at: new Date().toISOString()
    };
    submissions.push(newSubmission);
    this.flowSubmissions.set(phoneNumber, submissions);
    return newSubmission;
  }

  generateSubmissionId() {
    this.submissionCounter++;
    return `sub-${Date.now()}-${this.submissionCounter}`;
  }
}

// ============================================================================
// CONTEXT AGGREGATION SERVICE
// ============================================================================

class ContextAggregationService {
  constructor(conversationHistoryService, flowDataService) {
    this.conversationHistoryService = conversationHistoryService;
    this.flowDataService = flowDataService;
  }

  getCustomerContext(phoneNumber) {
    const history = this.conversationHistoryService.getHistoryByPhone(phoneNumber);
    const flowData = this.flowDataService.getFlowDataByPhone(phoneNumber);

    return {
      phone_number: phoneNumber,
      conversation_history: history,
      flow_data: flowData,
      summary: this.generateContextSummary(history, flowData),
      current_intent: this.identifyCurrentIntent(history),
      last_activity: history.last_message_time || flowData.submitted_at
    };
  }

  generateContextSummary(history, flowData) {
    const summary = {
      total_messages: history.message_count,
      active_flows: flowData.total_submissions,
      primary_vertical: this.identifyPrimaryVertical(history, flowData),
      has_booking_data: flowData.total_submissions > 0,
      first_activity: history.first_message_time,
      last_activity: history.last_message_time
    };

    return summary;
  }

  identifyPrimaryVertical(history, flowData) {
    // First check Flow data for explicit verticals
    if (flowData.total_submissions > 0) {
      // Count submissions by vertical
      const verticalCounts = {};
      flowData.flow_submissions.forEach(sub => {
        verticalCounts[sub.vertical] = (verticalCounts[sub.vertical] || 0) + 1;
      });
      // Return most common vertical
      return Object.keys(verticalCounts).reduce((a, b) =>
        verticalCounts[a] > verticalCounts[b] ? a : b, 'General');
    }

    // Fall back to analyzing conversation history
    const recentMessages = history.messages.slice(-10);
    const verticalKeywords = {
      'Bike Rental': ['bike', 'bicycle', 'cycle', 'rent bike'],
      'Taxi': ['taxi', 'cab', 'drop', 'pickup location', 'airport'],
      'Hotel': ['hotel', 'room', 'booking', 'check-in', 'check-out'],
      'Ticketing': ['ticket', 'event', 'show', 'booking']
    };

    for (const [vertical, keywords] of Object.entries(verticalKeywords)) {
      for (const msg of recentMessages) {
        const lowerMsg = msg.message.toLowerCase();
        if (keywords.some(keyword => lowerMsg.includes(keyword))) {
          return vertical;
        }
      }
    }

    return 'General';
  }

  identifyCurrentIntent(history) {
    const recentMessages = history.messages.slice(-3);

    if (recentMessages.length === 0) {
      return {
        vertical: 'Unknown',
        confidence: 0.0,
        intent_description: 'No conversation history available'
      };
    }

    // Analyze recent messages to determine intent
    const lowerMessages = recentMessages.map(m => m.message.toLowerCase()).join(' ');

    let intent = {
      vertical: 'General',
      confidence: 0.5,
      intent_description: 'General inquiry'
    };

    const intentPatterns = [
      {
        vertical: 'Bike Rental',
        keywords: ['bike', 'rent', 'bicycle', 'cycle'],
        description: 'Customer requesting bike rental'
      },
      {
        vertical: 'Taxi',
        keywords: ['taxi', 'cab', 'drop', 'pickup', 'airport'],
        description: 'Customer requesting taxi service'
      },
      {
        vertical: 'Hotel',
        keywords: ['hotel', 'room', 'accommodation', 'stay', 'check-in'],
        description: 'Customer requesting hotel booking'
      },
      {
        vertical: 'Ticketing',
        keywords: ['ticket', 'event', 'show', 'movie'],
        description: 'Customer requesting event tickets'
      }
    ];

    for (const pattern of intentPatterns) {
      const matchCount = pattern.keywords.filter(kw => lowerMessages.includes(kw)).length;
      if (matchCount > 0) {
        intent = {
          vertical: pattern.vertical,
          confidence: Math.min(0.5 + (matchCount * 0.15), 0.95),
          intent_description: pattern.description
        };
        break;
      }
    }

    return intent;
  }
}

// ============================================================================
// HANDOFF CONTEXT SERVICE
// ============================================================================

class HandoffContextService {
  constructor(conversationHistoryService, flowDataService, contextAggregationService) {
    this.conversationHistoryService = conversationHistoryService;
    this.flowDataService = flowDataService;
    this.contextAggregationService = contextAggregationService;
    this.handoffContexts = new Map();
  }

  initiateHandoffWithContext(phoneNumber, classificationResult, conversationHistory) {
    // First, get full customer context
    const context = this.contextAggregationService.getCustomerContext(phoneNumber);

    // Determine if handoff should trigger (simplified - always trigger for this story)
    const shouldTrigger = classificationResult.confidence < 0.8 ||
                        conversationHistory.length >= 3;

    if (!shouldTrigger) {
      return {
        success: false,
        reason: 'No handoff trigger conditions met'
      };
    }

    // Create handoff record
    const requestId = this.generateRequestId();
    const handoffRecord = {
      id: requestId,
      phone_number: phoneNumber,
      trigger: { type: 'LOW_CONFIDENCE', confidence: classificationResult.confidence },
      context: context,
      created_at: new Date().getTime(),
      status: 'transferring'
    };

    // Store context for agent retrieval
    this.handoffContexts.set(requestId, context);

    return {
      success: true,
      request_id: requestId,
      status: 'transferring',
      message: "I'm transferring you to an agent who can help with this",
      context: context
    };
  }

  getContextForAgent(requestId) {
    return this.handoffContexts.get(requestId) || null;
  }

  addMessage(phoneNumber, message, direction = 'incoming') {
    return this.conversationHistoryService.addMessage(phoneNumber, message, direction);
  }

  addFlowSubmission(phoneNumber, flowData) {
    return this.flowDataService.addFlowSubmission(phoneNumber, flowData);
  }

  generateRequestId() {
    return `hdf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const conversationHistoryService = new ConversationHistoryService();
const flowDataService = new FlowDataService();
const contextAggregationService = new ContextAggregationService(conversationHistoryService, flowDataService);
const handoffContextService = new HandoffContextService(
  conversationHistoryService,
  flowDataService,
  contextAggregationService
);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    },
    meta: {
      timestamp: Date.now()
    }
  });
});

// Add message to conversation history
app.post('/api/context/messages', (req, res) => {
  const { phone_number, message, direction } = req.body;

  if (!phone_number) {
    return res.status(400).json({
      error: {
        message: 'phone_number is required',
        code: 'MISSING_REQUIRED_FIELD'
      }
    });
  }

  if (!message) {
    return res.status(400).json({
      error: {
        message: 'message is required',
        code: 'MISSING_REQUIRED_FIELD'
      }
    });
  }

  const newMessage = handoffContextService.addMessage(phone_number, message, direction);

  res.json({
    data: {
      message_id: newMessage.id,
      phone_number: newMessage.phone_number,
      message: newMessage.message,
      timestamp: newMessage.timestamp
    },
    meta: {
      timestamp: Date.now()
    }
  });
});

// Add Flow submission
app.post('/api/context/flow-submissions', (req, res) => {
  const { phone_number, flow_name, flow_type, vertical, fields } = req.body;

  if (!phone_number) {
    return res.status(400).json({
      error: {
        message: 'phone_number is required',
        code: 'MISSING_REQUIRED_FIELD'
      }
    });
  }

  if (!flow_name || !vertical) {
    return res.status(400).json({
      error: {
        message: 'flow_name and vertical are required',
        code: 'MISSING_REQUIRED_FIELD'
      }
    });
  }

  const newSubmission = handoffContextService.addFlowSubmission(phone_number, {
    flowName: flow_name,
    flowType: flow_type,
    vertical: vertical,
    fields: fields || {}
  });

  res.json({
    data: {
      submission_id: newSubmission.id,
      phone_number: newSubmission.phone_number,
      flow_name: newSubmission.flow_name,
      vertical: newSubmission.vertical,
      submitted_at: newSubmission.submitted_at
    },
    meta: {
      timestamp: Date.now()
    }
  });
});

// Get customer context
app.get('/api/context/:phone', (req, res) => {
  const { phone } = req.params;

  const context = contextAggregationService.getCustomerContext(phone);

  res.json({
    data: context,
    meta: {
      timestamp: Date.now()
    }
  });
});

// Handoff initiation with context
app.post('/api/handoff/initiate', (req, res) => {
  const { phone_number, classification_confidence, classification_vertical, conversation_history } = req.body;

  if (!phone_number) {
    return res.status(400).json({
      error: {
        message: 'phone_number is required',
        code: 'MISSING_REQUIRED_FIELD'
      }
    });
  }

  const classificationResult = {
    confidence: classification_confidence,
    vertical: classification_vertical
  };

  const result = handoffContextService.initiateHandoffWithContext(
    phone_number,
    classificationResult,
    conversation_history || []
  );

  if (!result.success) {
    return res.status(400).json({
      error: {
        message: result.reason,
        code: 'NO_HANDOFF_TRIGGER'
      }
    });
  }

  res.json({
    data: result,
    meta: {
      timestamp: Date.now()
    }
  });
});

// Get context for handoff request (for agent)
app.get('/api/handoff/context/:id', (req, res) => {
  const { id } = req.params;
  const context = handoffContextService.getContextForAgent(id);

  if (!context) {
    return res.status(404).json({
      error: {
        message: 'Handoff request context not found',
        code: 'NOT_FOUND'
      }
    });
  }

  res.json({
    data: context,
    meta: {
      timestamp: Date.now()
    }
  });
});

// Export for testing
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const port = process.env.PORT || 3005;
  app.listen(port, () => {
    console.log(`Context Transfer Service running on port ${port}`);
  });
}

module.exports = {  app,
  ConversationHistoryService,
  FlowDataService,
  ContextAggregationService,
  HandoffContextService
};



