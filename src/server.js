require('dotenv').config();
const express = require('express');
const cors = require('cors');
const messageRoutes = require('./routes/messageRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/messages', messageRoutes);

app.post('/webhook/rbm', (req, res) => {
  console.log('Webhook received:');
  console.log(JSON.stringify(req.body, null, 2));

  // Add RBM webhook handling logic here as needed.
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
