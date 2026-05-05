const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../.env')
});
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

function redactMongoUri(uri) {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:<redacted>@');
}

function logMongoConnectionError(error) {
  const hostname = (() => {
    try {
      return new URL(MONGODB_URI).hostname;
    } catch {
      return 'unknown-host';
    }
  })();

  console.error('Failed to connect to MongoDB.');
  console.error(`MongoDB host: ${hostname}`);
  console.error(`MongoDB URI detected: ${redactMongoUri(MONGODB_URI)}`);

  if (error?.name) {
    console.error(`MongoDB error name: ${error.name}`);
  }

  if (error?.message) {
    console.error(`MongoDB error message: ${error.message}`);
  }

  console.error(
    'Checklist: verify Render environment variables, Atlas network access, Atlas database user credentials, and that the connection string uses the correct cluster.'
  );

  if (error?.name === 'MongooseServerSelectionError') {
    console.error(
      'Atlas access hint: if Render is not on Atlas allowlist, either allow all IPs temporarily (0.0.0.0/0) for testing or add the required Render egress addresses.'
    );
  }
}

async function startServer() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required in the backend environment');
  }

  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 15000
  });
  console.log('Connected to MongoDB');

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  if (MONGODB_URI) {
    logMongoConnectionError(error);
  }
  console.error('Failed to start server:', error);
  process.exit(1);
});
