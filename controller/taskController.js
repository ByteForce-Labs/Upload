const Task = require('../models/Task');
const { User } = require('../models/User');
const CompletedTask = require('../models/CompletedTask');
const mongoose = require('mongoose');

// Get all tasks
exports.getAllTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: tasks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create a new task
exports.createTask = async (req, res) => {
  try {
    const { topic, description, imageUrl, power, expiresAt, completionDelay, link } = req.body;

    // Validate required fields
    if (!topic || !description || !power) {
      return res.status(400).json({ 
        success: false, 
        message: 'Topic, description, and power are required' 
      });
    }

    const newTask = new Task({
      topic,
      description,
      imageUrl,
      power,
      expiresAt,
      completionDelay,
      link
    });

    await newTask.save();
    res.status(201).json({ success: true, data: newTask });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Create multiple tasks
exports.createMultipleTasks = async (req, res) => {
  try {
    const tasks = req.body;
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ success: false, message: 'Expected an array of tasks' });
    }

    // Validate each task
    for (const task of tasks) {
      if (!task.topic || !task.description || !task.power) {
        return res.status(400).json({
          success: false,
          message: 'Each task must have topic, description, and power'
        });
      }
    }

    const createdTasks = await Task.insertMany(tasks);
    res.status(201).json({ success: true, data: createdTasks });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get a specific task by ID
exports.getTaskById = async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID' });
    }

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update a task
exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID' });
    }

    const updates = req.body;
    const options = { new: true, runValidators: true };
    
    const updatedTask = await Task.findByIdAndUpdate(taskId, updates, options);
    if (!updatedTask) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, data: updatedTask });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete a task
exports.deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID' });
    }

    const deletedTask = await Task.findByIdAndDelete(taskId);
    if (!deletedTask) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Also delete any completed task records
    await CompletedTask.deleteMany({ taskId });

    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get tasks for user
exports.getTasksForUser = async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Find completed tasks using userId (telegram ID)
    const completedTasks = await CompletedTask.find({ userId: user.userId })
      .select('taskId');
    const completedTaskIds = completedTasks.map(ct => ct.taskId);

    // Get active tasks not completed by the user
    const tasks = await Task.find({
      isActive: true,
      _id: { $nin: completedTaskIds },
      $or: [
        { expiresAt: { $gt: new Date() } },
        { expiresAt: null }
      ]
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: tasks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get completed tasks
exports.getCompletedTasks = async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const completedTasks = await CompletedTask.find({ userId: user.userId })
      .populate('taskId')
      .sort({ completedAt: -1 });

    const formattedTasks = completedTasks
      .filter(ct => ct.taskId)
      .map(ct => ({
        ...ct.taskId.toObject(),
        completedAt: ct.completedAt
      }));

    res.json({ success: true, data: formattedTasks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Complete a task
exports.completeTask = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { telegramUserId, taskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid task ID' });
    }

    const user = await User.findOne({ userId: telegramUserId }).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const task = await Task.findById(taskId).session(session);
    if (!task) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (!task.isActive) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Task is no longer active' });
    }

    if (task.expiresAt && new Date() > new Date(task.expiresAt)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Task has expired' });
    }

    // Check for existing completion using telegramUserId
    const existingCompletion = await CompletedTask.findOne({
      userId: telegramUserId,
      taskId: taskId
    }).session(session);

    if (existingCompletion) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Task already completed by this user' });
    }

    // Create completion record using telegramUserId
    const completedTask = new CompletedTask({
      userId: telegramUserId,
      taskId: taskId,
      completedAt: new Date()
    });
    await completedTask.save({ session });

    // Update user's power
    user.power += task.power;
    await user.save({ session });

    await session.commitTransaction();

    res.json({ 
      success: true, 
      message: 'Task completed successfully',
      powerEarned: task.power,
      newPowerTotal: user.power
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Task completion error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

module.exports = exports;