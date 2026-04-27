const express = require('express');

// ============================================================================
// FLOW TEMPLATE SERVICE
// ============================================================================

class FlowTemplateService {
  constructor() {
    this.templates = new Map();
  }

  generateId() {
    return `flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  registerTemplate(template) {
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
      throw new Error('Template must be a non-null object');
    }
    if (!template.id || !template.name || !template.vertical) {
      throw new Error('Template must have id, name, and vertical');
    }

    const registeredTemplate = {
      id: template.id,
      name: template.name,
      version: template.version || '1.0',
      vertical: template.vertical,
      status: template.status || 'draft',
      fields: Array.isArray(template.fields) ? template.fields : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    this.templates.set(registeredTemplate.id, registeredTemplate);
    return JSON.parse(JSON.stringify(registeredTemplate));
  }

  getTemplateByVertical(vertical) {
    const template = Array.from(this.templates.values())
      .filter(t => t.vertical === vertical && t.status === 'active')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0] || null;
    return template ? JSON.parse(JSON.stringify(template)) : null;
  }

  getTemplate(templateId) {
    const template = this.templates.get(templateId);
    return template ? JSON.parse(JSON.stringify(template)) : null;
  }
}

// ============================================================================
// FLOW VALIDATOR
// ============================================================================

class FlowValidator {
  isValidEmail(value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  }

  normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/\D/g, '');
  }

  isValidPhone(value) {
    if (typeof value !== 'string') return false;
    const normalized = this.normalizePhoneNumber(value);
    if (!normalized) return false;
    const phoneRegex = /^[1-9]\d{6,14}$/;
    return phoneRegex.test(normalized);
  }

  isValidDate(value) {
    if (!value || typeof value !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  validateField(field, value) {
    const errors = [];

    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      return [{ field: 'unknown', message: 'Invalid field definition', code: 'INVALID_FIELD' }];
    }

    // Required check
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: field.name,
        message: `${field.label} is required`,
        code: 'REQUIRED'
      });
      return errors;
    }

    // Skip validation if not required and empty
    if (!field.required && (value === undefined || value === null || value === '')) {
      return errors;
    }

    // Type-based validation
    if (field.type === 'email' && !this.isValidEmail(value)) {
      errors.push({
        field: field.name,
        message: 'Invalid email format',
        code: 'INVALID_EMAIL'
      });
    }

    if (field.type === 'phone' && !this.isValidPhone(value)) {
      errors.push({
        field: field.name,
        message: 'Invalid phone number format',
        code: 'INVALID_PHONE'
      });
    }

    if (field.type === 'date' && !this.isValidDate(value)) {
      errors.push({
        field: field.name,
        message: 'Invalid date format',
        code: 'INVALID_DATE'
      });
    }

    // Pattern validation
    if (field.validation?.pattern) {
      try {
        if (!new RegExp(field.validation.pattern).test(String(value))) {
          errors.push({
            field: field.name,
            message: 'Invalid format',
            code: 'INVALID_PATTERN'
          });
        }
      } catch (e) {
        errors.push({
          field: field.name,
          message: 'Invalid format',
          code: 'INVALID_PATTERN'
        });
      }
    }

    // Length validation
    if (field.validation?.minLength !== undefined && field.validation?.minLength !== null &&
        String(value).length < field.validation.minLength) {
      errors.push({
        field: field.name,
        message: `Minimum ${field.validation.minLength} characters required`,
        code: 'MIN_LENGTH'
      });
    }

    if (field.validation?.maxLength !== undefined && field.validation?.maxLength !== null &&
        String(value).length > field.validation.maxLength) {
      errors.push({
        field: field.name,
        message: `Maximum ${field.validation.maxLength} characters allowed`,
        code: 'MAX_LENGTH'
      });
    }

    return errors;
  }

  validateSubmission(template, data) {
    const errors = [];

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return [{ field: '_data', message: 'Submission data must be a non-null object', code: 'INVALID_DATA' }];
    }

    for (const field of template.fields) {
      const fieldErrors = this.validateField(field, data[field.name]);
      errors.push(...fieldErrors);
    }

    return errors;
  }
}

// ============================================================================
// FLOW SUBMISSION SERVICE
// ============================================================================

class FlowSubmissionService {
  constructor(flowTemplateService, flowValidator) {
    if (!flowTemplateService || !flowValidator) {
      throw new Error('FlowTemplateService and FlowValidator are required');
    }
    this.flowTemplateService = flowTemplateService;
    this.flowValidator = flowValidator;
    this.submissions = new Map();
  }

  generateSubmissionId() {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  submitFlow(flowId, phoneNumber, data) {
    const template = this.flowTemplateService.getTemplate(flowId);

    if (!template) {
      throw new Error('Flow template not found');
    }

    // Validate submission
    const validationErrors = this.flowValidator.validateSubmission(template, data);

    const submission = {
      id: this.generateSubmissionId(),
      flow_id: flowId,
      flow_version: template.version,
      phone_number: phoneNumber,
      data: JSON.parse(JSON.stringify(data)),
      validation_errors: validationErrors,
      status: validationErrors.length === 0 ? 'validated' : 'pending',
      submitted_at: new Date().toISOString()
    };

    this.submissions.set(submission.id, submission);
    return JSON.parse(JSON.stringify(submission));
  }

  getSubmission(submissionId) {
    const submission = this.submissions.get(submissionId);
    return submission ? JSON.parse(JSON.stringify(submission)) : null;
  }
}

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================

const flowTemplateService = new FlowTemplateService();
const flowValidator = new FlowValidator();
const flowSubmissionService = new FlowSubmissionService(flowTemplateService, flowValidator);
const APP_START_TIME = Date.now();

const app = express();
app.use(express.json({ limit: '1mb' }));

// POST /api/flow/templates - Register template
app.post('/api/flow/templates', (req, res) => {
  try {
    const { id, name, vertical, version, status, fields } = req.body;

    if (!id || !name || !vertical) {
      return res.status(400).json({
        error: {
          message: 'Template must have id, name, and vertical',
          code: 400,
          details: 'Missing required field(s): id, name, vertical'
        }
      });
    }

    const VALID_STATUSES = ['draft', 'active', 'archived'];
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: {
          message: 'Invalid template status',
          code: 400,
          details: 'Status must be one of: draft, active, archived'
        }
      });
    }

    const template = flowTemplateService.registerTemplate({
      id,
      name,
      vertical,
      version,
      status: status || 'draft',
      fields
    });

    res.status(201).json({
      data: template,
      meta: {
        timestamp: new Date().toISOString(),
        message: 'Flow template registered successfully'
      }
    });
  } catch (error) {
    console.error('Template registration error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to register template',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/flow/templates/:vertical - Get active template
app.get('/api/flow/templates/:vertical', (req, res) => {
  try {
    const { vertical } = req.params;

    if (!vertical) {
      return res.status(400).json({
        error: {
          message: 'vertical is required',
          code: 400,
          details: 'Missing path parameter: vertical'
        }
      });
    }

    const template = flowTemplateService.getTemplateByVertical(vertical);

    if (!template) {
      return res.status(404).json({
        error: {
          message: 'No active template found for this vertical',
          code: 404,
          details: `No active flow template exists for vertical: ${vertical}`
        }
      });
    }

    res.status(200).json({
      data: template,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Template retrieval error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to retrieve template',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// POST /api/flow/submit - Submit flow
app.post('/api/flow/submit', (req, res) => {
  try {
    const { flow_id, phone_number, data } = req.body;

    if (!flow_id) {
      return res.status(400).json({
        error: {
          message: 'flow_id is required',
          code: 400,
          details: 'Missing required field: flow_id'
        }
      });
    }

    if (!phone_number) {
      return res.status(400).json({
        error: {
          message: 'phone_number is required',
          code: 400,
          details: 'Missing required field: phone_number'
        }
      });
    }

    if (!flowValidator.isValidPhone(phone_number)) {
      return res.status(400).json({
        error: {
          message: 'Invalid phone number format',
          code: 400,
          details: 'The provided phone number is not in a valid format'
        }
      });
    }

    if (!data) {
      return res.status(400).json({
        error: {
          message: 'data is required',
          code: 400,
          details: 'Missing required field: data'
        }
      });
    }

    const submission = flowSubmissionService.submitFlow(flow_id, phone_number, data);

    res.status(201).json({
      data: submission,
      meta: {
        timestamp: new Date().toISOString(),
        message: submission.status === 'validated' ? 'Flow submitted successfully' : 'Flow submitted with validation errors'
      }
    });
  } catch (error) {
    const msg = error && error.message;
    if (msg === 'Flow template not found') {
      return res.status(404).json({
        error: {
          message: 'Flow template not found',
          code: 404,
          details: `Flow template not found: ${req.body.flow_id}`
        }
      });
    }

    console.error('Flow submission error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to submit flow',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/flow/submission/:id - Get submission status
app.get('/api/flow/submission/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: {
          message: 'submission id is required',
          code: 400,
          details: 'Missing path parameter: id'
        }
      });
    }

    const submission = flowSubmissionService.getSubmission(id);

    if (!submission) {
      return res.status(404).json({
        error: {
          message: 'Submission not found',
          code: 404,
          details: `No submission found with id: ${id}`
        }
      });
    }

    res.status(200).json({
      data: submission,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Submission retrieval error:', error);
    res.status(500).json({
      error: {
        message: 'Failed to retrieve submission',
        code: 500,
        details: 'An internal error occurred'
      }
    });
  }
});

// GET /api/health - Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime_ms: Date.now() - APP_START_TIME,
    service: 'whatsapp-flow-framework',
    endpoints: [
      'POST /api/flow/templates',
      'GET /api/flow/templates/:vertical',
      'POST /api/flow/submit',
      'GET /api/flow/submission/:id',
      'GET /api/health'
    ]
  });
});

// Start server (only if not in test mode)
if (process.env.MOCHA_TEST_MODE !== 'true') {
  const PORT = process.env.PORT || 3024;

  app.listen(PORT, () => {
    console.log(`WhatsApp Flow Framework Service listening on port ${PORT}`);
    console.log(`Storage: In-memory (MVP) - Supabase in Phase 2`);
  });
}

module.exports = { app, FlowTemplateService, FlowValidator, FlowSubmissionService };


