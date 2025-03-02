// app.js
const express = require('express');
const cors = require('cors');
const connectDB = require('./db/connect');
const zentariRoutes = require('./routes/zentariRoutes');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/hello', (req, res) => {
  res.send('Task Manager');
});

app.use('/api/zentari', zentariRoutes);

const port = process.env.PORT || 3001;

const start = async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    app.listen(port, console.log(`Server is listening on port ${port}....`));
  } catch (error) {
    console.log(error);
  }
};

start();