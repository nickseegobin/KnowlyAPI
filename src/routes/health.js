const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    service: 'Knowly Exam Platform API',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;