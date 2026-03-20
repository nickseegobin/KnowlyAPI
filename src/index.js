if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const app = express();

app.use(express.json());

// Routes
const healthRouter = require('./routes/health');
app.use('/api/v1/health', healthRouter);

const generateExamRouter = require('./routes/generateExam');
app.use('/api/v1/generate-exam', generateExamRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NoeyAI API running on port ${PORT}`);
});