const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    ttl: { type: String, default: '10s' }
  },
  {
    timestamps: true
  }
);

const MessageTemplate = mongoose.model('MessageTemplate', templateSchema);

module.exports = MessageTemplate;
