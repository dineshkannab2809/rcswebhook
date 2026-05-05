const express = require('express');
const dotgoService = require('../services/dotgoService');
const RbmMessage = require('../services/rbmMessageModel');

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

// POST /api/messages/send
router.post('/send', async (req, res) => {
  try {
    const { recipient, message, templateCode, botId } = req.body;
    const overrideBot = botId || req.query.botId;

    if (!recipient || (!message && !templateCode)) {
      return res.status(400).json({
        error: 'Missing required fields: recipient and either message or templateCode'
      });
    }

    const result = await dotgoService.sendMessage(
      recipient,
      { message, templateCode },
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

// GET /api/messages/health
router.get('/health', (req, res) => {
  res.json({ status: 'Messages API is healthy' });
});

module.exports = router;
