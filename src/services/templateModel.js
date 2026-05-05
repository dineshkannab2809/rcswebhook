const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    remoteName: { type: String, default: '' },
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    ttl: { type: String, default: '10s' },
    type: { type: String, default: 'text_message' },
    templateUseCase: { type: String, default: 'Transactional' },
    suggestions: { type: Array, default: [] },
    remoteTemplateId: { type: String, default: null },
    status: { type: String, default: 'pending' },
    statusMessage: { type: String, default: '' },
    webhookEvent: { type: String, default: '' },
    statusUpdatedAt: { type: Date, default: null },
    webhookEvents: { type: Array, default: [] },
    raw: { type: Object, default: null }
  },
  {
    timestamps: true
  }
);

const MessageTemplate = mongoose.model('MessageTemplate', templateSchema);

module.exports = MessageTemplate;
