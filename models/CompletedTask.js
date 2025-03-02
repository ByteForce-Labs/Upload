// models/CompletedTask.js
const mongoose = require('mongoose');

const CompletedTaskSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true
  },
  userId: {
    type: String,  // Changed from ObjectId to String to match telegramUserId
    required: true
  },
  completedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Add compound index to prevent duplicate completions
CompletedTaskSchema.index({ taskId: 1, userId: 1 }, { unique: true });

const CompletedTask = mongoose.model('CompletedTask', CompletedTaskSchema);
module.exports = CompletedTask;

