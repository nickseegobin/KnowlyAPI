require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

// Routes
const healthRouter = require('./routes/health');
app.use('/api/v1/health', healthRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NoeyAI API running on port ${PORT}`);
});