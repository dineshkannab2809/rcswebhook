const mongoose = require('mongoose');


const rbmMessageSchema = new mongoose.Schema({
  raw: { type: Object, required: true },
  decoded: { type: Object },
  direction: { type: String, enum: ['incoming', 'outgoing'], required: true },
  conversationId: { type: String }, // e.g., sender/recipient phone or custom chat id
  receivedAt: { type: Date, default: Date.now }
});

const RbmMessage = mongoose.model('RbmMessage', rbmMessageSchema);

module.exports = RbmMessage;
