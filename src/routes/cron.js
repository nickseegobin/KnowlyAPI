const express = require('express');
const router = express.Router();
const { nightlyScan, retryFailures } = require('../services/bufferManager');
const getSupabase = require('../config/supabase');

function requireServerKey(req, res) {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
    return false;
  }
  return true;
}

// POST /api/v1/cron/buffer-scan
// Nightly proactive scan — scans all combinations and pre-generates any below threshold.
// Schedule: 03:30 UTC daily via external cron (Railway cron or WordPress wp_schedule_event).
// Secured by X-AEP-Server-Key.

router.post('/buffer-scan', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { curriculum = 'tt_primary' } = req.body;
  const started_at = new Date().toISOString();

  try {
    console.log(`[cron] buffer-scan started at ${started_at} for curriculum: ${curriculum}`);
    const result = await nightlyScan(curriculum);

    if (result.errors > 0) {
      await getSupabase().from('cron_failures').insert({
        job_name: 'buffer_scan',
        error_message: `${result.errors} combination(s) failed during nightly scan`,
        attempted_at: started_at,
        resolved: false,
        details: { curriculum, ...result }
      });
    }

    return res.json({
      job: 'buffer_scan',
      curriculum,
      started_at,
      completed_at: new Date().toISOString(),
      ...result
    });

  } catch (err) {
    console.error('[cron] buffer-scan failed:', err);

    await getSupabase().from('cron_failures').insert({
      job_name: 'buffer_scan',
      error_message: err.message,
      attempted_at: started_at,
      resolved: false,
      details: { curriculum }
    }).catch(() => {});

    return res.status(500).json({
      job: 'buffer_scan',
      error: err.message,
      code: 'server_error'
    });
  }
});

// POST /api/v1/cron/retry-failures
// Sweeps generation_failures and retries unretried entries with exponential backoff.
// Schedule: 03:00 UTC daily.
// Secured by X-AEP-Server-Key.

router.post('/retry-failures', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const started_at = new Date().toISOString();

  try {
    console.log(`[cron] retry-failures started at ${started_at}`);
    const result = await retryFailures();

    if (result.failed > 0) {
      await getSupabase().from('cron_failures').insert({
        job_name: 'generation_retry',
        error_message: `${result.failed} retry attempt(s) failed`,
        attempted_at: started_at,
        resolved: false,
        details: result
      });
    }

    return res.json({
      job: 'retry_failures',
      started_at,
      completed_at: new Date().toISOString(),
      ...result
    });

  } catch (err) {
    console.error('[cron] retry-failures failed:', err);

    await getSupabase().from('cron_failures').insert({
      job_name: 'generation_retry',
      error_message: err.message,
      attempted_at: started_at,
      resolved: false
    }).catch(() => {});

    return res.status(500).json({
      job: 'retry_failures',
      error: err.message,
      code: 'server_error'
    });
  }
});

module.exports = router;
