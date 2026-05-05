const express = require('express');
const dotgoService = require('../services/dotgoService');

const router = express.Router();

// POST /api/messages/send
router.post('/send', async (req, res) => {
  try {
    const { recipient, message, templateCode, botId } = req.body;
    // allow overriding via query string as well
    const overrideBot = botId || req.query.botId;

    if (!recipient || (!message && !templateCode)) {
      return res.status(400).json({
        error: 'Missing required fields: recipient and either message or templateCode'
      })
    }

    const result = await dotgoService.sendMessage(
      recipient,
      { message, templateCode },
      overrideBot
    )

    if (result.success) {
      return res.status(200).json(result)
    } else {
      return res.status(500).json(result)
    }
  } catch (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    })
  }
})

// GET /api/messages/health
router.get('/health', (req, res) => {
  res.json({ status: 'Messages API is healthy' });
});

module.exports = router;
