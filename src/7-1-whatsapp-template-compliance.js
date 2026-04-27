require('dotenv').config();
const express = require('express');
const { EventEmitter } = require('events');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// TemplateRegistry — manages WhatsApp message template definitions
// ---------------------------------------------------------------------------
class TemplateRegistry {
  constructor(options = {}) {
    this.templates = new Map(); // name → TemplateDefinition
    this._templateIdCounter = 0;
  }

  registerTemplate(definition) {
    if (this.templates.has(definition.name)) {
      const existing = this.templates.get(definition.name);
      // Throw on exact duplicate (same body), allow version bump with changes
      if (existing.body === definition.body && existing.category === definition.category) {
        throw new Error(`Template already registered: ${definition.name}`);
      }
      definition.version = (existing.version || 1) + 1;
    } else {
      definition.version = definition.version || 1;
    }

    this._templateIdCounter++;
    const template = {
      name: definition.name,
      templateId: definition.templateId || `tpl-${Date.now()}-${this._templateIdCounter}`,
      category: definition.category,
      status: definition.status || 'pending',
      body: definition.body,
      parameters: (definition.parameters || []).map(p => ({ ...p })),
      rejectionReason: definition.rejectionReason || null,
      submittedAt: definition.submittedAt || new Date().toISOString(),
      approvedAt: definition.approvedAt || null,
      version: definition.version,
    };

    if (this.templates.has(definition.name)) {
      this.templates.set(definition.name, template);
    } else {
      this.templates.set(definition.name, template);
    }
    return { ...template };
  }

  getTemplate(name) {
    const tpl = this.templates.get(name);
    return tpl ? { ...tpl } : null;
  }

  getTemplateById(templateId) {
    for (const tpl of this.templates.values()) {
      if (tpl.templateId === templateId) return { ...tpl };
    }
    return null;
  }

  getTemplatesByCategory(category) {
    return this._filter(t => t.category === category);
  }

  getTemplatesByStatus(status) {
    return this._filter(t => t.status === status);
  }

  getAllTemplates() {
    return [...this.templates.values()].map(t => ({ ...t }));
  }

  updateTemplateStatus(name, status, rejectionReason) {
    const tpl = this.templates.get(name);
    if (!tpl) return false;
    tpl.status = status;
    if (status === 'approved') {
      tpl.approvedAt = new Date().toISOString();
    }
    if (rejectionReason) {
      tpl.rejectionReason = rejectionReason;
    }
    return true;
  }

  _filter(predicate) {
    const results = [];
    for (const tpl of this.templates.values()) {
      if (predicate(tpl)) results.push({ ...tpl });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// TemplateValidator — validates templates against Meta's compliance rules
// ---------------------------------------------------------------------------
class TemplateValidator {
  constructor(options = {}) {
    this.maxNameLength = options.maxNameLength
      || parseInt(process.env.TEMPLATE_MAX_NAME_LENGTH, 10) || 512;
    this.allowedCategories = options.allowedCategories
      || (process.env.TEMPLATE_ALLOWED_CATEGORIES
        ? process.env.TEMPLATE_ALLOWED_CATEGORIES.split(',')
        : ['utility', 'marketing', 'authentication']);
    this.allowedStatuses = options.allowedStatuses || ['pending', 'approved', 'rejected'];
  }

  validateName(name) {
    if (!name || name.trim().length === 0) {
      return { valid: false, error: 'Template name is required' };
    }
    if (name.length > this.maxNameLength) {
      return { valid: false, error: `Template name exceeds max length of ${this.maxNameLength}` };
    }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      return { valid: false, error: 'Template name must be alphanumeric with underscores only' };
    }
    return { valid: true, error: null };
  }

  validateCategory(category) {
    if (!category) {
      return { valid: false, error: 'Category is required' };
    }
    if (!this.allowedCategories.includes(category)) {
      return { valid: false, error: `Category must be one of: ${this.allowedCategories.join(', ')}` };
    }
    return { valid: true, error: null };
  }

  validateParameters(parameters) {
    if (!Array.isArray(parameters)) {
      return { valid: false, error: 'Parameters must be an array' };
    }

    const errors = [];
    const seenPositions = new Set();

    for (let i = 0; i < parameters.length; i++) {
      const param = parameters[i];
      if (!param.name) {
        errors.push(`Parameter at index ${i}: name is required`);
      }
      if (param.position === undefined || param.position === null) {
        errors.push(`Parameter '${param.name || i}': position is required`);
      } else if (seenPositions.has(param.position)) {
        errors.push(`Duplicate parameter position: ${param.position}`);
      }
      seenPositions.add(param.position);
    }

    if (errors.length > 0) {
      return { valid: false, error: errors.join('; ') };
    }
    return { valid: true, error: null };
  }

  validateBody(body, parameters) {
    if (!body || body.trim().length === 0) {
      return { valid: false, error: 'Template body is required' };
    }

    // Extract placeholders from body
    const placeholders = body.match(/\{\{(\d+)\}\}/g) || [];
    const placeholderPositions = new Set();
    placeholders.forEach(ph => {
      const num = parseInt(ph.replace(/\{|\}/g, ''), 10);
      placeholderPositions.add(num);
    });

    // Check each placeholder has a corresponding parameter
    const paramPositions = new Set((parameters || []).map(p => p.position));
    for (const pos of placeholderPositions) {
      if (!paramPositions.has(pos)) {
        return { valid: false, error: `Body references placeholder {{${pos}}} but no parameter defined at position ${pos}` };
      }
    }

    return { valid: true, error: null };
  }

  validate(definition) {
    const errors = [];

    const nameResult = this.validateName(definition.name);
    if (!nameResult.valid) errors.push(nameResult.error);

    const catResult = this.validateCategory(definition.category);
    if (!catResult.valid) errors.push(catResult.error);

    const paramResult = this.validateParameters(definition.parameters);
    if (!paramResult.valid) errors.push(paramResult.error);

    const bodyResult = this.validateBody(definition.body, definition.parameters);
    if (!bodyResult.valid) errors.push(bodyResult.error);

    return { valid: errors.length === 0, errors };
  }
}

// ---------------------------------------------------------------------------
// TemplateParameterEngine — populates template parameters
// ---------------------------------------------------------------------------
class TemplateParameterEngine {
  constructor(registry) {
    this.registry = registry;
  }

  getRequiredParameters(templateName) {
    const tpl = this.registry.getTemplate(templateName);
    if (!tpl) throw new Error(`Template not found: ${templateName}`);
    return (tpl.parameters || []).filter(p => p.required);
  }

  populateTemplate(templateName, params) {
    const tpl = this.registry.getTemplate(templateName);
    if (!tpl) throw new Error(`Template not found: ${templateName}`);

    // Validate required parameters are present
    const required = (tpl.parameters || []).filter(p => p.required);
    const missing = required.filter(p => {
      const val = params[p.name];
      return val === undefined || val === null;
    });
    if (missing.length > 0) {
      const names = missing.map(p => p.name).join(', ');
      throw new Error(`Missing required parameters: ${names}`);
    }

    // Build positional map
    const paramMap = {};
    for (const p of (tpl.parameters || [])) {
      paramMap[p.position] = params[p.name] !== undefined ? String(params[p.name]) : '';
    }

    // Replace {{N}} placeholders
    let body = tpl.body;
    body = body.replace(/\{\{(\d+)\}\}/g, (match, pos) => {
      const numPos = parseInt(pos, 10);
      return paramMap[numPos] !== undefined ? paramMap[numPos] : match;
    });

    return body;
  }

  validateParameters(templateName, params) {
    const required = this.getRequiredParameters(templateName);
    const missing = required.filter(p => {
      const val = params[p.name];
      return val === undefined || val === null;
    });
    return {
      valid: missing.length === 0,
      missing: missing.map(p => p.name),
    };
  }
}

// ---------------------------------------------------------------------------
// MessageComposer — sends template-based messages
// ---------------------------------------------------------------------------
class MessageComposer {
  constructor(registry, engine, options = {}) {
    this.registry = registry;
    this.engine = engine;
    this.sendHistory = [];
    this.onlyApprovedTemplates = options.onlyApprovedTemplates !== undefined
      ? options.onlyApprovedTemplates
      : process.env.TEMPLATE_ONLY_APPROVED !== 'false';
  }

  composeMessage(templateName, params) {
    const tpl = this.registry.getTemplate(templateName);
    if (!tpl) throw new Error(`Template not found: ${templateName}`);

    if (this.onlyApprovedTemplates && tpl.status !== 'approved') {
      throw new Error(`Template '${templateName}' is not approved (current status: ${tpl.status})`);
    }

    const body = this.engine.populateTemplate(templateName, params);
    return {
      body,
      templateName,
      templateId: tpl.templateId,
      category: tpl.category,
    };
  }

  sendTemplateMessage(recipient, templateName, params) {
    const composed = this.composeMessage(templateName, params);
    const record = {
      id: `sent-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      recipient,
      templateName,
      templateId: composed.templateId,
      body: composed.body,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };
    this.sendHistory.push(record);
    return { ...record };
  }

  getSendHistory(filters) {
    let result = [...this.sendHistory];
    if (filters) {
      if (filters.templateName) {
        result = result.filter(r => r.templateName === filters.templateName);
      }
      if (filters.recipient) {
        result = result.filter(r => r.recipient === filters.recipient);
      }
    }
    return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

// ---------------------------------------------------------------------------
// Module-level instances
// ---------------------------------------------------------------------------
const templateRegistry = new TemplateRegistry();
const templateValidator = new TemplateValidator();
const parameterEngine = new TemplateParameterEngine(templateRegistry);
const messageComposer = new MessageComposer(templateRegistry, parameterEngine);

// ---------------------------------------------------------------------------
// Express API Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'whatsapp-template-compliance',
      timestamp: new Date().toISOString(),
    },
    meta: { timestamp: Date.now() },
  });
});

// GET /api/compliance/templates — list all templates
app.get('/api/compliance/templates', (req, res) => {
  try {
    const { category, status } = req.query;
    let templates;
    if (category) {
      templates = templateRegistry.getTemplatesByCategory(category);
    } else if (status) {
      templates = templateRegistry.getTemplatesByStatus(status);
    } else {
      templates = templateRegistry.getAllTemplates();
    }
    res.json({
      data: { templates, total: templates.length },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to list templates', code: 500, details: error.message },
    });
  }
});

// GET /api/compliance/templates/:name — get specific template (MUST be before validate/populate)
app.get('/api/compliance/templates/:name', (req, res) => {
  try {
    const { name } = req.params;
    const tpl = templateRegistry.getTemplate(name);
    if (!tpl) {
      return res.status(404).json({
        error: { message: `Template not found: ${name}`, code: 404 },
      });
    }
    res.json({
      data: tpl,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get template', code: 500, details: error.message },
    });
  }
});

// POST /api/compliance/templates — register a new template
app.post('/api/compliance/templates', (req, res) => {
  try {
    const { name, category, body, parameters, status, templateId } = req.body;
    if (!name) {
      return res.status(400).json({
        error: { message: 'name is required', code: 400 },
      });
    }
    if (!category) {
      return res.status(400).json({
        error: { message: 'category is required', code: 400 },
      });
    }
    if (!body) {
      return res.status(400).json({
        error: { message: 'body is required', code: 400 },
      });
    }

    const result = templateRegistry.registerTemplate({ name, category, body, parameters, status, templateId });
    res.status(201).json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to register template', code: 500, details: error.message },
    });
  }
});

// PUT /api/compliance/templates/:name — update template
app.put('/api/compliance/templates/:name', (req, res) => {
  try {
    const { name } = req.params;
    const { status, rejectionReason, body, parameters, category } = req.body;

    if (status) {
      const result = templateRegistry.updateTemplateStatus(name, status, rejectionReason);
      if (!result) {
        return res.status(404).json({
          error: { message: `Template not found: ${name}`, code: 404 },
        });
      }
    }

    // Allow body/parameters/category update via PUT
    if (body || parameters || category) {
      const existing = templateRegistry.getTemplate(name);
      if (!existing) {
        return res.status(404).json({
          error: { message: `Template not found: ${name}`, code: 404 },
        });
      }
      templateRegistry.registerTemplate({
        name: existing.name,
        category: category || existing.category,
        body: body || existing.body,
        parameters: parameters || existing.parameters,
        status: status || existing.status,
        templateId: existing.templateId,
        rejectionReason: rejectionReason !== undefined ? rejectionReason : existing.rejectionReason,
        approvedAt: existing.approvedAt,
        submittedAt: existing.submittedAt,
      });
    }

    const updated = templateRegistry.getTemplate(name);
    res.json({
      data: updated,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to update template', code: 500, details: error.message },
    });
  }
});

// POST /api/compliance/templates/:name/validate — validate template
app.post('/api/compliance/templates/:name/validate', (req, res) => {
  try {
    const { name } = req.params;
    const tpl = templateRegistry.getTemplate(name);
    if (!tpl) {
      return res.status(404).json({
        error: { message: `Template not found: ${name}`, code: 404 },
      });
    }
    const result = templateValidator.validate(tpl);
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to validate template', code: 500, details: error.message },
    });
  }
});

// POST /api/compliance/templates/:name/populate — preview template with parameters
app.post('/api/compliance/templates/:name/populate', (req, res) => {
  try {
    const { name } = req.params;
    const tpl = templateRegistry.getTemplate(name);
    if (!tpl) {
      return res.status(404).json({
        error: { message: `Template not found: ${name}`, code: 404 },
      });
    }
    const body = parameterEngine.populateTemplate(name, req.body);
    res.json({
      data: { name, body, parameters: req.body },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(400).json({
      error: { message: error.message, code: 400 },
    });
  }
});

// POST /api/compliance/send — compose and send a template message
app.post('/api/compliance/send', (req, res) => {
  try {
    const { recipient, templateName, params } = req.body;
    if (!templateName) {
      return res.status(400).json({
        error: { message: 'templateName is required', code: 400 },
      });
    }
    if (!recipient) {
      return res.status(400).json({
        error: { message: 'recipient is required', code: 400 },
      });
    }

    const result = messageComposer.sendTemplateMessage(recipient, templateName, params || {});
    res.json({
      data: result,
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(400).json({
      error: { message: error.message, code: 400 },
    });
  }
});

// GET /api/compliance/send/history — view sent template message history
app.get('/api/compliance/send/history', (req, res) => {
  try {
    const { templateName, recipient } = req.query;
    const filters = {};
    if (templateName) filters.templateName = templateName;
    if (recipient) filters.recipient = recipient;

    const history = messageComposer.getSendHistory(Object.keys(filters).length > 0 ? filters : null);
    res.json({
      data: { history, total: history.length },
      meta: { timestamp: Date.now() },
    });
  } catch (error) {
    res.status(500).json({
      error: { message: 'Failed to get send history', code: 500, details: error.message },
    });
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { message: 'Internal server error', code: 500 },
  });
});

// Start server only if not in test mode
const PORT = process.env.PORT || process.env.COMPLIANCE_PORT || 3009;
if (process.env.MOCHA_TEST_MODE !== 'true') {
  app.listen(PORT, () => {
    console.log(`WhatsApp Template Compliance service running on port ${PORT}`);
  });
}

module.exports = {
  app,
  TemplateRegistry,
  TemplateValidator,
  TemplateParameterEngine,
  MessageComposer,
  templateRegistry,
  templateValidator,
  parameterEngine,
  messageComposer,
};
