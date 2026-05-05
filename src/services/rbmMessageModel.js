const mongoose = require('mongoose');


const rbmMessageSchema = new mongoose.Schema({
  raw: { type: Object, required: true },
  decoded: { type: Object },
  direction: { type: String, enum: ['incoming', 'outgoing'], required: true },
  conversationId: { type: String }, // e.g., sender/recipient phone or custom chat id
  sender: { type: String, default: null },
  recipient: { type: String, default: null },
  mode: { type: String, enum: ['text', 'template'], default: 'text' },
  text: { type: String, default: '' },
  templateCode: { type: String, default: null },
  delivery: { type: String, default: null },
  messageId: { type: String, default: null },
  messageName: { type: String, default: null },
  receivedAt: { type: Date, default: Date.now }
});

const RbmMessage = mongoose.model('RbmMessage', rbmMessageSchema);

module.exports = RbmMessage;
