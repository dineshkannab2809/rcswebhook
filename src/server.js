require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const messageRoutes = require('./routes/messageRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  socket.on('join', (conversationId) => {
    if (conversationId) {
      socket.join(conversationId);
    }
  });

  socket.on('leave', (conversationId) => {
    if (conversationId) {
      socket.leave(conversationId);
    }
  });
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/messages', messageRoutes);
app.use('/webhook', messageRoutes);

app.get('/', (req, res) => {
  res.send('RCS webhook server running');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

const PORT = Number(process.env.PORT) || 5003;
const MONGODB_URI = process.env.MONGODB_URI;

async function startServer() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required in the backend environment');
  }

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
