// models/PendingCompletion.js
const mongoose = require('mongoose');

const PendingCompletionSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  userId: {
    type: String, // telegramUserId
    required: true,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  completionTime: {
    type: Date,
    required: true,
  },
  isProcessed: {
    type: Boolean,
    default: false
  }
});

const PendingCompletion = mongoose.model('PendingCompletion', PendingCompletionSchema);
module.exports = PendingCompletion;