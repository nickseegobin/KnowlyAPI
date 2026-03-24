# NoeyAI Exam Platform API

**Version:** 1.0.0  
**Live URL:** `https://noeyai-api-production.up.railway.app`  
**GitHub:** `https://github.com/nickseegobin/noeyai-api`  
**Stack:** Node.js + Express on Railway, Supabase, Pinecone, Anthropic Claude Sonnet

---

## Overview

NoeyAI is a T&T primary school exam generation and delivery API. It generates curriculum-aligned multiple-choice exams for Standard 4 and Standard 5 (SEA prep) students across Mathematics, English Language Arts, Science, and Social Studies.

The system uses a **pool-first architecture** — exams are served instantly from a pre-approved pool in Supabase. When the pool runs low, Claude generates new packages in the background automatically. Students never wait for AI generation.

---

## Architecture

```
WordPress (frontend)
    ↓ JWT Bearer token
Railway API (Node.js/Express)
    ↓ pool query          ↓ AI generation (background)
Supabase (PostgreSQL)   Anthropic Claude Sonnet
    ↓ RAG context
Pinecone (vector DB)
```

### Key Design Principles

- **Pool-first:** Every exam request checks Supabase before calling Claude
- **Buffer auto-refill:** After serving a package, the system checks if fresh unserved packages are available. If below threshold (currently 1), a new package is generated in the background with `status: approved`
- **Answer sheet separation:** `answer_sheet` is never returned to students — only on server-to-server calls via `X-AEP-Server-Key`
- **Lazy initialization:** All external clients (Supabase, Pinecone, Anthropic, OpenAI) initialise on first use, never at module load — prevents Railway startup crashes
- **Caribbean context:** All AI-generated content uses T&T names, places, food, and cultural references

---

## Project Structure

```
noeyai-api/
├── src/
│   ├── index.js                    ← Express app entry point
│   ├── config/
│   │   ├── supabase.js             ← Lazy Supabase client
│   │   └── taxonomy.js             ← T&T curriculum topics + EXAM_CONFIG
│   ├── middleware/
│   │   └── auth.js                 ← JWT authenticateToken middleware
│   ├── routes/
│   │   ├── health.js               ← GET /api/v1/health
│   │   ├── generateExam.js         ← POST /api/v1/generate-exam
│   │   ├── submitExam.js           ← POST /api/v1/submit-exam
│   │   ├── checkpoint.js           ← POST /api/v1/checkpoint
│   │   ├── resumeExam.js           ← GET /api/v1/resume-exam/:user_id
│   │   ├── cancelExam.js           ← POST /api/v1/cancel-exam
│   │   ├── insight.js              ← POST /api/v1/insight
│   │   ├── overallInsight.js       ← POST /api/v1/overall-insight/:user_id
│   │   ├── progress.js             ← GET /api/v1/progress/:user_id
│   │   ├── catalogue.js            ← GET /api/v1/catalogue
│   │   └── pool.js                 ← GET /api/v1/pool
│   └── services/
│       ├── ai.js                   ← Anthropic Claude abstraction
│       ├── embeddings.js           ← OpenAI text-embedding-3-small
│       ├── examGenerator.js        ← Core generation logic + shuffle
│       ├── pinecone.js             ← Vector DB query
│       └── bufferManager.js        ← Background pool refill system
├── .env                            ← Local environment variables
├── .gitignore
└── package.json
```

---

## Environment Variables

### Local `.env`

```dotenv
PORT=3000
SUPABASE_URL=https://idbgjmqatsxmkmexuham.supabase.co
SUPABASE_SERVICE_KEY=eyJ...                  # Legacy service_role JWT
JWT_SECRET=noeyai_jwt_secret_change_this_in_production
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX=noeyai-curriculum
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIzaSy...                     # Retained but unused
OPENAI_API_KEY=sk-proj-...                   # Used for Pinecone embeddings
AEP_SERVER_KEY=noeyai_aep_server_key_2026_prod
```

### Railway Variables

Same keys as `.env` — **do not include `PORT`** (Railway manages this automatically at 8080).

> **Important:** dotenv is only loaded in development. In production (`NODE_ENV=production`), Railway injects variables directly into `process.env`.

---

## Database Schema (Supabase)

### `exam_pool`
Stores generated exam packages. The primary pool from which exams are served.

| Column | Type | Notes |
|---|---|---|
| `package_id` | TEXT PK | e.g. `pkg-std_4-term_1-math-easy-4308` |
| `standard` | TEXT | `std_4` or `std_5` |
| `term` | TEXT | `term_1/2/3` or null for std_5 |
| `subject` | TEXT | `math`, `english`, `science`, `social_studies` |
| `difficulty` | TEXT | `easy`, `medium`, `hard` |
| `status` | TEXT | `pending_review`, `approved`, `rejected` |
| `source` | TEXT | `generated`, `auto_generated` |
| `package_data` | JSONB | Full exam package including answer_sheet |
| `uniqueness_score` | FLOAT | 0–1, SHA-256 fingerprint pass rate |
| `times_served` | INT | Incremented on each pool hit |
| `generated_at` | TIMESTAMPTZ | |
| `approved_at` | TIMESTAMPTZ | |

### `question_bank`
Per-question fingerprint store for uniqueness checking across packages.

| Column | Type | Notes |
|---|---|---|
| `question_id` | TEXT | e.g. `q_001` |
| `package_id` | TEXT FK → exam_pool |
| `fingerprint` | TEXT | SHA-256 hash |
| `standard`, `term`, `subject`, `difficulty` | TEXT | |
| `question_text` | TEXT | |
| `correct_answer` | TEXT | |

### `exam_sessions`
Tracks each student exam attempt from start to completion.

| Column | Type | Notes |
|---|---|---|
| `session_id` | TEXT PK | e.g. `sess_b181a39562ec` |
| `user_id` | TEXT | |
| `package_id` | TEXT FK → exam_pool |
| `state` | TEXT | `active`, `completed`, `cancelled` |
| `score` | INT | Raw correct count |
| `percentage` | INT | 0–100 |
| `time_elapsed` | INT | Seconds |
| `time_remaining` | INT | Seconds |
| `checkpoint_data` | JSONB | `{ current_question_index, time_remaining_seconds, answers_so_far }` |
| `completed_at` | TIMESTAMPTZ | |

### `exam_results`
Per-question result rows for analytics.

| Column | Type | Notes |
|---|---|---|
| `result_id` | BIGINT PK | Auto-increment |
| `session_id` | TEXT FK → exam_sessions |
| `user_id` | TEXT | |
| `question_id` | TEXT | |
| `topic` | TEXT | |
| `subtopic` | TEXT | |
| `cognitive_level` | TEXT | `knowledge`, `comprehension`, `application`, `analysis`, `synthesis` |
| `difficulty_weight` | INT | |
| `selected_answer` | TEXT | A/B/C/D |
| `correct_answer` | TEXT | A/B/C/D |
| `is_correct` | BOOLEAN | |
| `time_taken` | INT | Seconds per question |

### `generation_failures`
Logs failed background generation attempts for retry.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK | Auto-increment |
| `standard`, `term`, `subject`, `difficulty` | TEXT | |
| `error_message` | TEXT | |
| `attempted_at` | TIMESTAMPTZ | |
| `retried` | BOOLEAN | Default false |

---

## Exam Package Format (JSONB)

Every exam package stored in `exam_pool.package_data` follows this structure:

```json
{
  "package_id": "pkg-std_4-term_1-english-easy-7604",
  "version": "1.0",
  "generated_at": "2026-03-21T00:02:28Z",
  "meta": {
    "standard": "std_4",
    "term": "term_1",
    "subject": "english",
    "difficulty": "easy",
    "level": "Primary",
    "question_count": 20,
    "time_per_question_seconds": 120,
    "total_time_seconds": 2400,
    "syllabus_ref": "T&T Primary Curriculum — std_4 term_1",
    "topics_covered": ["Oral Communication", "Reading — Comprehension"],
    "status": "pending_review",
    "source": "generated",
    "uniqueness_score": 1
  },
  "questions": [
    {
      "question_id": "q_001",
      "meta": {
        "topic": "Oral Communication",
        "subtopic": "Listening for main idea",
        "cognitive_level": "comprehension",
        "difficulty_weight": 1,
        "time_limit_seconds": 120
      },
      "question": "Teacher reads: '...' What is the main idea?",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct_answer": "B",
      "explanation": "The main idea is...",
      "tip": "Ask yourself: What is this passage mostly about?"
    }
  ],
  "answer_sheet": [
    {
      "question_id": "q_001",
      "correct_answer": "B",
      "explanation": "The main idea is..."
    }
  ]
}
```

### Special Content Codes

These codes can appear inside `question` text and are parsed by the frontend:

| Code | Usage | Frontend behaviour |
|---|---|---|
| `[hide]word[/hide]` | Spelling/vocabulary questions | Renders as underline or blank |
| `[blank]` | Fill-in-the-blank | Renders as input field or blank line |
| `[emphasize]text[/emphasize]` | Key term highlight | Renders as bold or highlighted text |

---

## Authentication

All endpoints except `/health` require:
```
Authorization: Bearer {JWT}
```

JWTs are signed with `JWT_SECRET`. Generate a token:
```bash
node -e "require('dotenv').config(); const jwt = require('jsonwebtoken'); console.log(jwt.sign({user_id:'user_123', role:'student'}, process.env.JWT_SECRET, {expiresIn:'10y'}));"
```

### Server-to-Server Mode

When WordPress calls the API, include the additional header:
```
X-AEP-Server-Key: {AEP_SERVER_KEY}
```

This unlocks `answer_sheet` in the response. Without this header, `answer_sheet` is always stripped.

---

## Buffer System

The auto-refill buffer ensures the pool is always stocked.

**Threshold:** `BUFFER_THRESHOLD = 1` (increase to 2–3 for production)

**Logic:**
1. Student requests an exam
2. Pool is queried — package served instantly
3. `setImmediate()` fires `checkAndRefill()` in background (non-blocking)
4. `checkAndRefill` counts packages where `times_served = 0` for that combination
5. If count < threshold → `generateAndStore()` is called
6. New package saved with `status: approved`, `source: auto_generated`
7. On failure → error logged to `generation_failures` table

To increase the buffer for production, update `BUFFER_THRESHOLD` in `src/services/bufferManager.js`.

---

## Modifying the System

### Swap the AI model
Edit `src/services/ai.js` only. The `generateContent(prompt)` function is the sole abstraction used by the rest of the system.

### Add a new subject
Add entries to `TAXONOMY` in `src/config/taxonomy.js`. No API or database changes needed.

### Add a new standard
Add the standard to `TAXONOMY` and `EXAM_CONFIG` in `taxonomy.js`, then upload curriculum documents to Pinecone.

### Change question count or timing
Edit `EXAM_CONFIG` in `taxonomy.js`.

### Change buffer threshold
Edit `BUFFER_THRESHOLD` in `src/services/bufferManager.js`.

### Approve packages manually
```sql
UPDATE exam_pool
SET status = 'approved', approved_at = NOW()
WHERE package_id = 'your-package-id';
```

---

## Deployment

The API auto-deploys to Railway on every push to the `main` branch.

```bash
git add .
git commit -m "your message"
git push
```

Railway picks up environment variable changes and redeploys automatically. For variable-only changes, trigger a manual redeploy from the Railway dashboard if the change doesn't deploy within 2 minutes.

---

## Sprint Status

| Sprint | Description | Status |
|---|---|---|
| S1 | Infrastructure — Supabase, Railway, Pinecone, auth | ✅ Complete |
| S2 | Core generation — pool-first, Claude, taxonomy | ✅ Complete |
| S3 | Exam lifecycle — submit, checkpoint, resume, cancel, insight, progress | ✅ Complete |
| S3+ | Pool endpoint, catalogue, WP integration changes | ✅ Complete |
| S3++ | Buffer system, shuffle, content codes, overall-insight | ✅ Complete |
| S4 | WordPress integration — aep-core plugin, MemberPress, WooCommerce | 🔄 Next |
| S5 | Quiz App JS renderer, timer, results screen | Pending |
| S6 | Admin review queue, pool stats dashboard, UAT | Pending |