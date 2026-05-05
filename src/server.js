require('dotenv').config();
const express = require('express');
const cors = require('cors');

const mongoose = require('mongoose');
const messageRoutes = require('./routes/messageRoutes');
const RbmMessage = require('./services/rbmMessageModel');
const axios = require('axios');
// Send RCS message endpoint
app.post('/api/rcs/send', async (req, res) => {
  const { to, text, conversationId } = req.body;
  if (!to || !text) {
    return res.status(400).json({ error: 'Missing to or text' });
  }

  // TODO: Replace with your actual RCS provider API details
  const rcsApiUrl = process.env.RCS_API_URL || 'https://your-rcs-provider/send';
  const rcsApiKey = process.env.RCS_API_KEY || 'your-api-key';

  try {
    // Example payload, adjust as per your provider
    const payload = {
      to,
      text
    };
    const headers = {
      'Authorization': `Bearer ${rcsApiKey}`,
      'Content-Type': 'application/json'
    };
    const response = await axios.post(rcsApiUrl, payload, { headers });

    // Store outgoing message
    await RbmMessage.create({
      raw: { to, text, providerResponse: response.data },
      decoded: { to, text },
      direction: 'outgoing',
      conversationId: conversationId || to
    });

    res.json({ success: true, providerResponse: response.data });
  } catch (err) {
    console.error('Error sending RCS message:', err);
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

// Get chat history endpoint
app.get('/api/rcs/history', async (req, res) => {
  const { conversationId } = req.query;
  if (!conversationId) {
    return res.status(400).json({ error: 'Missing conversationId' });
  }
  try {
    const messages = await RbmMessage.find({ conversationId }).sort({ receivedAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history', details: err.message });
  }
});



const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://dineshkannab_db_user:U5PoPr7DZqTtgFqt@cluster0.pxpbyha.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/messages', messageRoutes);

app.post('/webhook/rbm', (req, res) => {
  console.log('Webhook received:');
  console.log(JSON.stringify(req.body, null, 2));

  let decodedData = null;
  let conversationId = null;
  try {
    const message = req.body.message;
    if (message && message.data) {
      const decodedStr = Buffer.from(message.data, 'base64').toString('utf-8');
      decodedData = JSON.parse(decodedStr);
      // Use senderPhoneNumber or another field as conversationId
      conversationId = decodedData.senderPhoneNumber || decodedData.agentId || null;
      console.log('Decoded message data:', decodedData);
    } else {
      console.log('No data field found in message.');
    }
  } catch (err) {
    console.error('Error decoding/parsing message data:', err);
  }

  // Save to MongoDB
  const rbmMessage = new RbmMessage({
    raw: req.body,
    decoded: decodedData,
    direction: 'incoming',
    conversationId
  });
  rbmMessage.save()
    .then(() => console.log('✅ Webhook data saved to MongoDB'))
    .catch((err) => console.error('❌ Error saving to MongoDB:', err));

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Webhook server running');
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Backend server running on http://localhost:${PORT}`);
});
