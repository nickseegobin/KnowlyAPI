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
const catalogueRouter = require('./routes/catalogue');
const poolRouter = require('./routes/pool');
const overallInsightRouter = require('./routes/overallInsight');
const editorReadRouter = require('./routes/editorRead');
const editorSaveRouter = require('./routes/editorSave');
const leaderboardRouter = require('./routes/leaderboard');
const cronRouter = require('./routes/cron');
const questRouter       = require('./routes/quest');
const analyticsRouter   = require('./routes/analytics');
const trainingRouter    = require('./routes/training');
const trialEditorRouter        = require('./routes/trialEditor');
const curriculumTopicsRouter   = require('./routes/curriculumTopics');
const questionBankRouter       = require('./routes/questionBank');
const trialStartRouter         = require('./routes/trialStart');
const progressionRouter        = require('./routes/progression');



app.use('/api/v1/health', healthRouter);
app.use('/api/v1/generate-exam', generateExamRouter);
app.use('/api/v1/submit-exam', submitExamRouter);
app.use('/api/v1/checkpoint', checkpointRouter);
app.use('/api/v1/resume-exam', resumeExamRouter);
app.use('/api/v1/cancel-exam', cancelExamRouter);
app.use('/api/v1/insight', insightRouter);
app.use('/api/v1/progress', progressRouter);
app.use('/api/v1/catalogue', catalogueRouter);
app.use('/api/v1/pool', poolRouter);
app.use('/api/v1/overall-insight', overallInsightRouter);
app.use('/api/v1/editor-read', editorReadRouter);
app.use('/api/v1/editor-save', editorSaveRouter);
app.use('/api/v1/leaderboard', leaderboardRouter);
app.use('/api/v1/cron', cronRouter);
app.use('/api/v1/quest',        questRouter);
app.use('/api/v1/analytics',   analyticsRouter);
app.use('/api/v1/training',    trainingRouter);
app.use('/api/v1/trial-editor',      trialEditorRouter);
app.use('/api/v1/curriculum-topics', curriculumTopicsRouter);
app.use('/api/v1/question-bank',     questionBankRouter);
app.use('/api/v1/trial',             trialStartRouter);
app.use('/api/v1/progression',       progressionRouter);


// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Knowly API running on port ${PORT}`);
});