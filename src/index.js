if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const app = express();

app.use(express.json());

// Routes
const healthRouter = require('./routes/health');
const generateExamRouter = require('./routes/generateExam');
const submitExamRouter = require('./routes/submitExam');
const checkpointRouter = require('./routes/checkpoint');
const resumeExamRouter = require('./routes/resumeExam');
const cancelExamRouter = require('./routes/cancelExam');
const insightRouter = require('./routes/insight');
const progressRouter = require('./routes/progress');



app.use('/api/v1/health', healthRouter);
app.use('/api/v1/generate-exam', generateExamRouter);
app.use('/api/v1/submit-exam', submitExamRouter);
app.use('/api/v1/checkpoint', checkpointRouter);
app.use('/api/v1/resume-exam', resumeExamRouter);
app.use('/api/v1/cancel-exam', cancelExamRouter);
app.use('/api/v1/insight', insightRouter);
app.use('/api/v1/progress', progressRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NoeyAI API running on port ${PORT}`);
});