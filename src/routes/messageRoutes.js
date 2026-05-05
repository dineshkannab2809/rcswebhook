const express = require('express');
const dotgoService = require('../services/dotgoService');
const templateService = require('../services/templateService');
const RbmMessage = require('../services/rbmMessageModel');
const Contact = require('../services/contactModel');
const MessageTemplate = require('../services/templateModel');

const router = express.Router();

const normalizeConversationId = (value) => {
  if (!value) {
    return null;
  }

  const trimmed = value.toString().trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  if (trimmed.startsWith('91') && trimmed.length === 12) {
    return `+${trimmed}`;
  }

  if (/^\d{10}$/.test(trimmed)) {
    return `+91${trimmed}`;
  }

  return trimmed;
};

const normalizeMessage = (messageDoc) => {
  const message = messageDoc.toObject ? messageDoc.toObject() : messageDoc;
  const timestamp = message.receivedAt || new Date().toISOString();
  const templateCode = message.templateCode || message.decoded?.templateCode || null;
  const mode = message.mode || (templateCode ? 'template' : 'text');
  const text =
    message.text ||
    message.decoded?.text ||
    (templateCode ? `Template: ${templateCode}` : '');

  return {
    id: message._id?.toString?.() || message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    mode,
    text,
    templateCode,
    delivery: message.delivery || null,
    timestamp,
    messageId: message.messageId || null,
    messageName: message.messageName || null,
    recipient: message.recipient || null,
    sender: message.sender || null
  };
};

const normalizeContact = (contactDoc) => {
  const contact = contactDoc.toObject ? contactDoc.toObject() : contactDoc;

  return {
    id: contact._id?.toString?.() || contact.id,
    phone: contact.phone,
    name: contact.name || contact.phone
  };
};

const normalizeTemplate = (templateDoc) => {
  const template = templateDoc.toObject ? templateDoc.toObject() : templateDoc;

  return {
    id: template._id?.toString?.() || template.id,
    code: template.code,
    title: template.title || template.code,
    content: template.content || '',
    ttl: template.ttl || '10s',
    type: template.type || 'text_message',
    templateUseCase: template.templateUseCase || 'Transactional',
    suggestions: template.suggestions || [],
    remoteTemplateId: template.remoteTemplateId || null,
    status: template.status || 'pending',
    statusMessage: template.statusMessage || '',
    webhookEvent: template.webhookEvent || '',
    statusUpdatedAt: template.statusUpdatedAt || null,
    webhookEvents: template.webhookEvents || []
  };
};

const emitConversationMessage = (req, conversationId, payload) => {
  const io = req.app.get('io');
  if (io && conversationId) {
    io.to(conversationId).emit('new_message', payload);
  }
};

const decodeWebhookPayload = (body) => {
  if (body?.message?.data) {
    try {
      const decodedStr = Buffer.from(body.message.data, 'base64').toString('utf-8');
      return JSON.parse(decodedStr);
    } catch (error) {
      console.error('Failed to decode webhook message data:', error.message);
    }
  }

  return body?.decoded || body;
};

const extractConversationId = (body, decodedPayload) =>
  normalizeConversationId(
    decodedPayload?.senderPhoneNumber ||
      decodedPayload?.from ||
      decodedPayload?.phoneNumber ||
      body?.from ||
      body?.conversationId ||
      body?.senderPhoneNumber ||
      null
  );

const extractMessageText = (body, decodedPayload) =>
  decodedPayload?.text ||
  decodedPayload?.message ||
  body?.text ||
  body?.message?.text ||
  '';

const extractEventType = (body, decodedPayload) =>
  decodedPayload?.eventType ||
  body?.eventType ||
  null;

const extractMessageId = (body, decodedPayload) =>
  decodedPayload?.messageId ||
  body?.messageId ||
  null;

const deliveryFromEventType = (eventType) => {
  switch (eventType) {
    case 'DELIVERED':
      return 'delivered';
    case 'READ':
      return 'read';
    case 'TTL_EXPIRATION_REVOKED':
      return 'expired';
    case 'TTL_EXPIRATION_REVOKE_FAILED':
      return 'revoke_failed';
    default:
      return null;
  }
};

const ensureContact = async (phone, name) => {
  const normalizedPhone = normalizeConversationId(phone);
  if (!normalizedPhone) {
    return null;
  }

  const safeName = (name || '').toString().trim();

  return Contact.findOneAndUpdate(
    { phone: normalizedPhone },
    {
      $setOnInsert: {
        phone: normalizedPhone
      },
      ...(safeName ? { $set: { name: safeName } } : {})
    },
    {
      new: true,
      upsert: true
    }
  );
};

const extractTemplateWebhookStatus = (body) =>
  body?.statusDetails?.status ||
  body?.status ||
  body?.templateStatus ||
  body?.approvalStatus ||
  'pending';

const extractTemplateWebhookMessage = (body) =>
  body?.statusDetails?.message ||
  body?.message ||
  body?.status_message ||
  '';

const extractTemplateWebhookCode = (body) =>
  body?.templateCode ||
  body?.name ||
  body?.templateName ||
  body?.statusDetails?.name ||
  null;

const extractTemplateWebhookRemoteId = (body) =>
  body?.templateId ||
  body?.id ||
  body?.remoteTemplateId ||
  null;

// POST /api/messages/send
router.post('/send', async (req, res) => {
  try {
    const { recipient, message, templateCode, botId } = req.body;
    const overrideBot = botId || req.query.botId;
    const normalizedRecipient = normalizeConversationId(recipient);

    if (!normalizedRecipient || (!message && !templateCode)) {
      return res.status(400).json({
        error: 'Missing required fields: recipient and either message or templateCode'
      });
    }

    let selectedTemplate = null;
    if (templateCode) {
      selectedTemplate = await MessageTemplate.findOne({ code: templateCode });

      if (!selectedTemplate) {
        return res.status(400).json({
          error: `Template ${templateCode} was not found`
        });
      }
    }

    const result = await dotgoService.sendMessage(
      normalizedRecipient,
      {
        message,
        templateCode,
        ttl: selectedTemplate?.ttl
      },
      overrideBot
    );

    if (!result.success) {
      return res.status(500).json(result);
    }

    const savedMessage = await RbmMessage.create({
      raw: {
        request: req.body,
        providerResponse: {
          messageId: result.messageId,
          messageName: result.messageName,
          sendTime: result.sendTime
        }
      },
      decoded: {
        text: message || '',
        templateCode: templateCode || null
      },
      direction: 'outgoing',
      conversationId: normalizeConversationId(result.recipient),
      recipient: normalizeConversationId(result.recipient),
      mode: result.mode,
      text: message || '',
      templateCode: templateCode || null,
      delivery: 'queued',
      messageId: result.messageId,
      messageName: result.messageName
    });

    const normalizedMessage = normalizeMessage(savedMessage);
    await ensureContact(normalizedMessage.conversationId);
    emitConversationMessage(req, normalizedMessage.conversationId, normalizedMessage);

    return res.status(200).json({
      ...result,
      savedMessage: normalizedMessage
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET /api/messages/conversations
router.get('/conversations', async (req, res) => {
  try {
    const [contacts, conversationSummaries] = await Promise.all([
      Contact.find().sort({ updatedAt: -1, createdAt: -1 }),
      RbmMessage.aggregate([
        {
          $sort: {
            receivedAt: -1
          }
        },
        {
          $group: {
            _id: '$conversationId',
            latestMessage: { $first: '$$ROOT' },
            unread: {
              $sum: {
                $cond: [{ $eq: ['$direction', 'incoming'] }, 1, 0]
              }
            }
          }
        }
      ])
    ]);

    const contactByPhone = new Map(
      contacts.map((contact) => [contact.phone, normalizeContact(contact)])
    );

    const conversationPhones = new Set();
    const conversations = conversationSummaries
      .filter((summary) => summary._id)
      .map((summary) => {
        const conversationId = summary._id;
        conversationPhones.add(conversationId);
        const contact = contactByPhone.get(conversationId);
        const latestMessage = normalizeMessage(summary.latestMessage);

        return {
          recipient: conversationId,
          name: contact?.name || conversationId,
          preview: latestMessage.text || 'No messages yet',
          unread: summary.unread || 0,
          status: latestMessage.direction === 'incoming' ? 'Waiting' : 'Ongoing',
          updatedAt: latestMessage.timestamp
        };
      });

    contacts.forEach((contact) => {
      if (!conversationPhones.has(contact.phone)) {
        conversations.push({
          recipient: contact.phone,
          name: contact.name || contact.phone,
          preview: 'No messages yet',
          unread: 0,
          status: 'Waiting',
          updatedAt: contact.updatedAt || contact.createdAt || new Date().toISOString()
        });
      }
    });

    conversations.sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );

    return res.json(conversations);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch conversations',
      message: error.message
    });
  }
});

// GET /api/messages/contacts
router.get('/contacts', async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ updatedAt: -1, createdAt: -1 });
    return res.json(contacts.map(normalizeContact));
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch contacts',
      message: error.message
    });
  }
});

// POST /api/messages/contacts
router.post('/contacts', async (req, res) => {
  try {
    const phone = normalizeConversationId(req.body.phone);
    const name = (req.body.name || '').toString().trim();

    if (!phone) {
      return res.status(400).json({
        error: 'Phone is required'
      });
    }

    const contact = await ensureContact(phone, name);
    return res.status(201).json(normalizeContact(contact));
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to create contact',
      message: error.message
    });
  }
});

// GET /api/messages/templates
router.get('/templates', async (req, res) => {
  try {
    const templates = await MessageTemplate.find().sort({ updatedAt: -1, createdAt: -1 });
    return res.json(templates.map(normalizeTemplate));
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch templates',
      message: error.message
    });
  }
});

// POST /api/messages/templates
router.post('/templates', async (req, res) => {
  try {
    const code = (req.body.code || '').toString().trim();
    const title = (req.body.title || '').toString().trim();
    const content = (req.body.content || '').toString().trim();
    const ttl = (req.body.ttl || '10s').toString().trim();
    const type = (req.body.type || 'text_message').toString().trim();
    const templateUseCase = (req.body.templateUseCase || 'Transactional').toString().trim();
    const suggestions = Array.isArray(req.body.suggestions) ? req.body.suggestions : [];

    if (!code) {
      return res.status(400).json({
        error: 'Template code is required'
      });
    }

    if (!content) {
      return res.status(400).json({
        error: 'Template content is required'
      });
    }

    const remoteTemplate = await templateService.createTemplate({
      code,
      content,
      type,
      templateUseCase,
      suggestions
    });

    const template = await MessageTemplate.findOneAndUpdate(
      { code },
      {
        $set: {
          title: title || code,
          content,
          ttl,
          type,
          templateUseCase,
          suggestions,
          remoteTemplateId: remoteTemplate.remoteTemplateId,
          status: 'submitted',
          statusMessage: 'Template created in Dotgo and awaiting webhook updates.',
          webhookEvent: 'template_created',
          statusUpdatedAt: new Date(),
          raw: remoteTemplate.raw
        }
      },
      {
        new: true,
        upsert: true
      }
    );

    return res.status(201).json(normalizeTemplate(template));
  } catch (error) {
    console.error('Template creation failed:', error.message);
    if (error.response) {
      console.error('Template API response status:', error.response.status);
      console.error('Template API response data:', error.response.data);
    }

    return res.status(500).json({
      error: 'Failed to save template',
      message: error.response?.data?.message || error.message
    });
  }
});

// POST /api/messages/templates/webhook/status
const handleTemplateStatusWebhook = async (req, res) => {
  try {
    const code = extractTemplateWebhookCode(req.body);
    const remoteTemplateId = extractTemplateWebhookRemoteId(req.body);
    const status = extractTemplateWebhookStatus(req.body);
    const statusMessage = extractTemplateWebhookMessage(req.body);
    const webhookEvent = req.body?.event || req.body?.eventType || 'template_status';

    if (!code && !remoteTemplateId) {
      return res.status(400).json({
        error: 'Unable to determine template identity from webhook payload'
      });
    }

    const filter = code
      ? { code }
      : { remoteTemplateId };

    const template = await MessageTemplate.findOneAndUpdate(
      filter,
      {
        $set: {
          status,
          statusMessage,
          webhookEvent,
          statusUpdatedAt: new Date(),
          raw: req.body
        },
        $push: {
          webhookEvents: {
            receivedAt: new Date(),
            event: webhookEvent,
            status,
            statusMessage,
            payload: req.body
          }
        }
      },
      {
        new: true
      }
    );

    if (!template) {
      return res.status(404).json({
        error: 'No template found for webhook payload'
      });
    }

    return res.status(200).json({
      success: true,
      template: normalizeTemplate(template)
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to process template webhook',
      message: error.message
    });
  }
};

// GET /api/messages/history?conversationId=...
router.get('/history', async (req, res) => {
  try {
    const { conversationId } = req.query;

    if (!conversationId) {
      return res.status(400).json({
        error: 'Missing required query parameter: conversationId'
      });
    }

    const messages = await RbmMessage.find({ conversationId }).sort({ receivedAt: 1 });
    return res.json(messages.map(normalizeMessage));
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch history',
      message: error.message
    });
  }
});

const handleIncomingWebhook = async (req, res) => {
  try {
    const decodedPayload = decodeWebhookPayload(req.body);
    const conversationId = extractConversationId(req.body, decodedPayload);
    const text = extractMessageText(req.body, decodedPayload);
    const eventType = extractEventType(req.body, decodedPayload);
    const delivery = deliveryFromEventType(eventType);
    const webhookMessageId = extractMessageId(req.body, decodedPayload);

    if (!conversationId) {
      return res.status(400).json({
        error: 'Unable to determine conversationId from webhook payload'
      });
    }

    if (delivery) {
      if (!webhookMessageId) {
        return res.status(400).json({
          error: `Webhook event ${eventType} is missing messageId`
        });
      }

      const updatedMessage = await RbmMessage.findOneAndUpdate(
        {
          conversationId,
          messageId: webhookMessageId,
          direction: 'outgoing'
        },
        {
          $set: {
            delivery,
            raw: req.body,
            decoded: decodedPayload
          }
        },
        {
          new: true,
          sort: { receivedAt: -1 }
        }
      );

      if (!updatedMessage) {
        return res.status(404).json({
          error: `No outgoing message found for messageId ${webhookMessageId}`
        });
      }

    const normalizedMessage = normalizeMessage(updatedMessage);
    emitConversationMessage(req, normalizedMessage.conversationId, normalizedMessage);

      return res.status(200).json({
        success: true,
        eventType,
        savedMessage: normalizedMessage
      });
    }

    const savedMessage = await RbmMessage.create({
      raw: req.body,
      decoded: decodedPayload,
      direction: 'incoming',
      conversationId,
      sender: normalizeConversationId(
        decodedPayload?.senderPhoneNumber ||
          decodedPayload?.from ||
          req.body?.from ||
          null
      ),
      recipient:
        decodedPayload?.agentId ||
        decodedPayload?.to ||
        req.body?.to ||
        null,
      mode: 'text',
      text
    });

    const normalizedMessage = normalizeMessage(savedMessage);
    await ensureContact(normalizedMessage.conversationId);
    emitConversationMessage(req, normalizedMessage.conversationId, normalizedMessage);

    return res.status(200).json({
      success: true,
      savedMessage: normalizedMessage
    });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return res.status(500).json({
      error: 'Failed to process webhook',
      message: error.message
    });
  }
};

// Supports both /api/messages/webhook/rbm and /webhook/rbm
router.post('/webhook/rbm', handleIncomingWebhook);
router.post('/rbm', handleIncomingWebhook);
router.post('/templates/webhook/status', handleTemplateStatusWebhook);
router.post('/webhook/templates/status', handleTemplateStatusWebhook);

// GET /api/messages/health
router.get('/health', (req, res) => {
  res.json({ status: 'Messages API is healthy' });
});

module.exports = router;
