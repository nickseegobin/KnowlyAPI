const express = require('express');
const router = express.Router();

/* router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    service: 'NoeyAI Exam Platform API',
    timestamp: new Date().toISOString()
  });
}); */



router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    service: 'NoeyAI Exam Platform API',
    timestamp: new Date().toISOString(),
    jwt_secret_length: process.env.JWT_SECRET?.length || 0,
    supabase_url_set: !!process.env.SUPABASE_URL,
    node_env: process.env.NODE_ENV || 'not set'
  });
});

module.exports = router;