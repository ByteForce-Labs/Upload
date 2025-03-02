// models/Task.js
const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  topic: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  imageUrl: {
    type: String
  },
  power: {
    type: Number,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date
  },
  completionDelay: {
    type: Number,
    required: true,
    default: 0 // Delay in seconds before the task can be marked as completed
  },
  link: {
    type: String,
    required: true
  }
});

const Task = mongoose.model('Task', TaskSchema);
module.exports = Task;
