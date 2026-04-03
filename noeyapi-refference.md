# NoeyAI API Reference

**Base URL:** `https://noeyai-api-production.up.railway.app/api/v1`  
**Auth:** `Authorization: Bearer {JWT}` required on all endpoints except `/health`  
**Server mode:** Add `X-AEP-Server-Key: {AEP_SERVER_KEY}` to receive full packages including `answer_sheet`

---

## GET /health

Public. No auth required.

**Response**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "service": "NoeyAI Exam Platform API",
  "timestamp": "2026-03-21T00:00:00.000Z"
}
```

---

## POST /generate-exam

Serves an exam package. Checks the pool first — falls back to Claude generation if pool is empty. Fires a background buffer refill after every response.

**Headers**
```
Authorization: Bearer {JWT}
X-AEP-Server-Key: {key}   ← optional, unlocks answer_sheet
```

**Request body**
```json
{
  "standard": "std_4",
  "term": "term_1",
  "subject": "math",
  "difficulty": "easy",
  "completed_package_ids": ["pkg-std_4-term_1-math-easy-1234"]
}
```

| Field | Required | Values |
|---|---|---|
| `standard` | ✅ | `std_4`, `std_5` |
| `term` | ✅ for std_4 | `term_1`, `term_2`, `term_3` |
| `subject` | ✅ | `math`, `english`, `science`, `social_studies` |
| `difficulty` | ✅ | `easy`, `medium`, `hard` |
| `user_id` | ❌ | Optional, not stored |
| `completed_package_ids` | ❌ | Array of package IDs to exclude from pool |

**Response (student — no answer_sheet)**
```json
{
  "package_id": "pkg-std_4-term_1-math-easy-4308",
  "version": "1.0",
  "generated_at": "2026-03-21T00:02:28Z",
  "source": "pool",
  "meta": { ... },
  "questions": [ ... ]
}
```

**Response (server — includes answer_sheet)**
```json
{
  "package_id": "pkg-std_4-term_1-math-easy-4308",
  "version": "1.0",
  "generated_at": "2026-03-21T00:02:28Z",
  "source": "pool",
  "meta": { ... },
  "questions": [ ... ],
  "answer_sheet": [ ... ]
}
```

`source` is either `"pool"` or `"generated"`.

---

## POST /submit-exam

Scores a completed exam, stores the session and per-question results, returns the answer sheet with explanations.

**Request body**
```json
{
  "package_id": "pkg-std_4-term_1-english-easy-7604",
  "user_id": "user_123",
  "state": "completed",
  "time_elapsed_seconds": 1200,
  "time_remaining_seconds": 1200,
  "answers": [
    {
      "question_id": "q_001",
      "topic": "Oral Communication",
      "subtopic": "Listening for main idea",
      "cognitive_level": "comprehension",
      "difficulty_weight": 1,
      "selected_answer": "B",
      "time_taken_seconds": 60
    }
  ]
}
```

**Response**
```json
{
  "session_id": "sess_b181a39562ec",
  "score": 19,
  "total": 20,
  "percentage": 95,
  "topic_breakdown": [
    {
      "topic": "Oral Communication",
      "correct": 4,
      "total": 5,
      "percentage": 80
    }
  ],
  "answer_sheet": [
    {
      "question_id": "q_001",
      "selected_answer": "B",
      "correct_answer": "B",
      "is_correct": true,
      "explanation": "The main idea is..."
    }
  ]
}
```

---

## POST /checkpoint

Saves current exam state. Call on every question navigation to protect against connection loss.

**Request body**
```json
{
  "session_id": "sess_abc123",
  "user_id": "user_123",
  "package_id": "pkg-std_4-term_1-english-easy-7604",
  "standard": "std_4",
  "term": "term_1",
  "subject": "english",
  "difficulty": "easy",
  "current_question_index": 12,
  "time_remaining_seconds": 2140,
  "answers_so_far": [
    { "question_id": "q_001", "selected_answer": "B" },
    { "question_id": "q_002", "selected_answer": "C" }
  ]
}
```

**Response**
```json
{
  "status": "saved",
  "checkpoint_at": "2026-03-21T00:26:07.402Z"
}
```

---

## GET /resume-exam/:user_id

Restores the most recent active session for a user. Returns the full question set, current index, time remaining, and answers so far.

**Response**
```json
{
  "session_id": "sess_abc123",
  "package_id": "pkg-std_4-term_1-english-easy-7604",
  "current_question_index": 12,
  "time_remaining_seconds": 2140,
  "package_meta": { ... },
  "questions": [ ... ],
  "answers_so_far": [
    { "question_id": "q_001", "selected_answer": "B" }
  ]
}
```

Returns `404` if no active session found.

---

## POST /cancel-exam

Terminates an active session. Sets state to `cancelled`. Irreversible.

**Request body**
```json
{
  "session_id": "sess_abc123",
  "user_id": "user_123"
}
```

**Response**
```json
{
  "status": "cancelled",
  "cancelled_at": "2026-03-21T00:27:23.958Z"
}
```

---

## POST /insight

Generates a Claude coaching note based on topic breakdown from a single exam. 3–4 sentences, warm and encouraging, age-appropriate for primary school.

**Request body**
```json
{
  "user_id": "user_123",
  "standard": "std_4",
  "subject": "english",
  "topic_breakdown": [
    { "topic": "Oral Communication", "correct": 4, "total": 5, "percentage": 80 },
    { "topic": "Reading — Word Attack and Vocabulary", "correct": 7, "total": 7, "percentage": 100 },
    { "topic": "Reading — Comprehension", "correct": 8, "total": 8, "percentage": 100 }
  ]
}
```

**Response**
```json
{
  "insight": "Wow, excellent work on this exam! You absolutely mastered your reading skills..."
}
```

---

## POST /overall-insight/:user_id

Generates a Claude weekly coaching report across multiple subjects and exams. 4–6 sentences. Suitable for student and parent reading.

**Request body**
```json
{
  "student": {
    "standard": "std_4",
    "term": "term_1"
  },
  "period": {
    "week": "2026-W12",
    "exams_completed": 4,
    "total_time_seconds": 1840
  },
  "overall": {
    "average_score_pct": 58,
    "trend": "improving"
  },
  "subjects": [
    {
      "subject": "Mathematics",
      "exams": 2,
      "average_pct": 45,
      "topics": [
        { "topic": "Fractions", "correct": 3, "total": 8, "pct": 38 },
        { "topic": "Algebra", "correct": 6, "total": 8, "pct": 75 },
        { "topic": "Place Value", "correct": 4, "total": 6, "pct": 67 }
      ]
    },
    {
      "subject": "English",
      "exams": 2,
      "average_pct": 71,
      "topics": [
        { "topic": "Comprehension", "correct": 9, "total": 10, "pct": 90 },
        { "topic": "Grammar", "correct": 5, "total": 8, "pct": 63 }
      ]
    }
  ]
}
```

**Response**
```json
{
  "user_id": "user_123",
  "period": "2026-W12",
  "insight": "What a wonderful effort this week!..."
}
```

---

## GET /progress/:user_id

Returns aggregated stats for a user across all completed exams.

**Response**
```json
{
  "total_exams_completed": 1,
  "average_score_percentage": 95,
  "exams_by_subject": {
    "english": { "count": 1, "average": 95 }
  },
  "recent_exams": [
    {
      "session_id": "sess_b181a39562ec",
      "package_id": "pkg-std_4-term_1-english-easy-7604",
      "subject": "english",
      "difficulty": "easy",
      "score": 95,
      "completed_at": "2026-03-21T00:15:20.458"
    }
  ]
}
```

---

## GET /catalogue

Public pool inventory. Returns all possible standard × term × subject × difficulty combinations with live pool counts. No auth required.

**Response**
```json
[
  {
    "standard": "std_4",
    "term": "term_1",
    "subject": "math",
    "difficulty": "easy",
    "available_count": 2,
    "latest_generated_at": "2026-03-21T00:02:28Z"
  },
  {
    "standard": "std_5",
    "term": null,
    "subject": "social_studies",
    "difficulty": "medium",
    "available_count": 0,
    "latest_generated_at": null
  }
]
```

Returns 48 combinations total — 4 subjects × 3 terms × 3 difficulties for std_4, plus 4 subjects × 3 difficulties for std_5.

---

## GET /pool

Paginated access to pool packages. Used by WordPress to seed its local pool.

**Query params**

| Param | Default | Notes |
|---|---|---|
| `status` | `approved` | Filter by pool status |
| `limit` | `50` | Page size |
| `offset` | `0` | Pagination offset |

**Headers**
```
Authorization: Bearer {JWT}
X-AEP-Server-Key: {key}   ← required to receive answer_sheet
```

**Response**
```json
{
  "packages": [ /* full package_data objects */ ],
  "total": 6,
  "returned": 6,
  "offset": 0
}
```

Each object in `packages` is the raw `package_data` as stored in Supabase — no `source` injection. `answer_sheet` is included only when `X-AEP-Server-Key` is valid.

---

## GET /editor-read/:package_id

Fetches a raw package from `exam_pool` by ID. Used by the admin editor to load a package for review or editing.

**Headers**
```
Authorization: Bearer {JWT}
X-AEP-Server-Key: {key}   ← required
```

**Response**
```json
{
  "status": "found",
  "package": { /* full package_data object including answer_sheet */ }
}
```

Returns `404` if the package does not exist.

---

## POST /editor-save

Saves a manually authored or edited exam package to `exam_pool` and `question_bank`. Rejects if the `package_id` already exists.

**Headers**
```
Authorization: Bearer {JWT}
X-AEP-Server-Key: {key}   ← required
```

**Request body** — full package object (same shape as `exam_pool.package_data`)

```json
{
  "package_id": "pkg-std_4-term_1-math-easy-9999",
  "version": "1.0",
  "generated_at": "2026-04-01T10:00:00Z",
  "meta": {
    "standard": "std_4",
    "term": "term_1",
    "subject": "math",
    "difficulty": "easy",
    "status": "pending_review",
    "uniqueness_score": 1,
    "topics_covered": ["Fractions"]
  },
  "questions": [ ... ],
  "answer_sheet": [ ... ]
}
```

**Response**
```json
{
  "status": "saved",
  "package_id": "pkg-std_4-term_1-math-easy-9999",
  "saved_at": "2026-04-01T10:00:00.000Z"
}
```

Returns `409` if `package_id` already exists. `source` is set to `"manual"` automatically.

---

## GET /leaderboard/:standard/:term/:subject

Returns the daily top-10 leaderboard for a board. No auth required. If a valid JWT is included, `my_position` and `is_current_user` are populated.

Use `"none"` as the `term` path segment for std_5 boards.

**Response**
```json
{
  "board_key": "std_4_term_1_math",
  "standard": "std_4",
  "term": "term_1",
  "subject": "math",
  "date": "2026-04-02",
  "total_participants": 42,
  "my_position": 3,
  "entries": [
    {
      "rank": 1,
      "nickname": "CoralBolt",
      "total_points": 32,
      "last_score_pct": 100,
      "is_current_user": false
    }
  ]
}
```

---

## GET /leaderboard/me/:user_id

Returns the current user's rank across all boards they appear on today.

**Headers**
```
Authorization: Bearer {JWT}
```

**Response**
```json
{
  "user_id": "user_123",
  "standard": "std_4",
  "term": "term_1",
  "date": "2026-04-02",
  "boards": [
    {
      "board_key": "std_4_term_1_math",
      "subject": "math",
      "total_points": 28,
      "last_score_pct": 90,
      "rank": 3
    }
  ]
}
```

---

## POST /leaderboard/upsert

Updates or creates the user's leaderboard entry for the current day. Only updates if the new attempt beats the current daily best. Called by WordPress after exam submission.

**Headers**
```
X-AEP-Server-Key: {key}   ← required
```

**Request body**
```json
{
  "user_id": "user_123",
  "nickname": "CoralBolt",
  "standard": "std_4",
  "term": "term_1",
  "subject": "math",
  "difficulty": "easy",
  "correct_count": 18,
  "score_pct": 90
}
```

Alternatively pass `"points"` directly to override the calculated value.

**Points formula:** `correct_count + (2 if hard, 1 if medium, 0 if easy)`

**Response**
```json
{
  "was_updated": true,
  "total_points_today": 18,
  "previous_rank": 5,
  "new_rank": 3,
  "board_key": "std_4_term_1_math"
}
```

---

## POST /leaderboard/generate-nickname

Generates and assigns a unique Caribbean-themed nickname to a user. No-ops if the user already has a nickname.

**Headers**
```
Authorization: Bearer {JWT}
X-AEP-Server-Key: {key}   ← required
```

**Request body**
```json
{
  "user_id": "user_123",
  "standard": "std_4",
  "term": "term_1"
}
```

**Response**
```json
{
  "user_id": "user_123",
  "nickname": "CoralBolt",
  "is_new": true
}
```

`is_new` is `false` if the user already had a nickname (existing nickname returned unchanged).

---

## POST /leaderboard/regenerate-nickname

Generates a new nickname for a user, replacing their old one. Updates all leaderboard entries to reflect the new nickname.

**Headers**
```
Authorization: Bearer {JWT}
X-AEP-Server-Key: {key}   ← required
```

**Request body**
```json
{
  "user_id": "user_123"
}
```

**Response**
```json
{
  "user_id": "user_123",
  "old_nickname": "CoralBolt",
  "new_nickname": "TurboMango",
  "updated_at": "2026-04-02T10:00:00.000Z"
}
```

---

## POST /leaderboard/reset

Archives all current leaderboard entries to `leaderboard_archive` then clears `leaderboard_entries`. Called at daily reset (midnight Trinidad time).

**Headers**
```
X-AEP-Server-Key: {key}   ← required
```

**Response**
```json
{
  "entries_cleared": 84,
  "boards_cleared": 12,
  "reset_at": "2026-04-02T04:00:00.000Z"
}
```

---

## POST /leaderboard/test/inject

Injects a test leaderboard entry. For testing only.

**Headers**
```
X-AEP-Server-Key: {key}   ← required
```

**Request body** — same as `/leaderboard/upsert` with optional `user_id`, `nickname`, `points` overrides.

---

## POST /leaderboard/test/reset-board

Clears all entries for a specific board on the current day without archiving. For testing only.

**Headers**
```
X-AEP-Server-Key: {key}   ← required
```

**Request body**
```json
{
  "standard": "std_4",
  "term": "term_1",
  "subject": "math"
}
```

---

## Error Responses

All errors follow this shape:

```json
{
  "error": "Human-readable message",
  "details": "Technical detail (only on 500 errors)"
}
```

| Status | Meaning |
|---|---|
| `400` | Missing or invalid request fields |
| `401` | Missing, invalid, or expired JWT |
| `404` | Resource not found (no active session, no package, etc.) |
| `500` | Internal server error — check Railway deploy logs |

---

## Curriculum Coverage

### Standard 4 (term-scoped)

| Subject | Terms |
|---|---|
| Mathematics | term_1, term_2, term_3 |
| English Language Arts | term_1, term_2, term_3 |
| Science | term_1, term_2, term_3 |
| Social Studies | term_1, term_2, term_3 |

### Standard 5 (SEA prep, no term)

| Subject |
|---|
| Mathematics |
| English Language Arts |
| Science |
| Social Studies |

### Difficulties

| Level | Questions | Time per question | Total time |
|---|---|---|---|
| Easy | 20 | 2 min | 40 min |
| Medium | 25 | 2.5 min | ~62 min |
| Hard | 30 | 3 min | 90 min |

*(Values defined in `src/config/taxonomy.js` EXAM_CONFIG — adjust there)*

---

## Generating a JWT Token

**Short-lived (testing):**
```bash
node -e "require('dotenv').config(); const jwt = require('jsonwebtoken'); console.log(jwt.sign({user_id:'test_user', role:'student'}, process.env.JWT_SECRET));"
```

**Long-lived server token (WordPress):**
```bash
node -e "require('dotenv').config(); const jwt = require('jsonwebtoken'); console.log(jwt.sign({user_id:'wordpress_server', role:'server'}, process.env.JWT_SECRET, {expiresIn:'10y'}));"
```

---

## Quick Test Cheatsheet

```bash
# Health check
curl https://noeyai-api-production.up.railway.app/api/v1/health

# Catalogue
curl https://noeyai-api-production.up.railway.app/api/v1/catalogue

# Generate exam (student)
curl -X POST https://noeyai-api-production.up.railway.app/api/v1/generate-exam \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {JWT}" \
  -d '{"standard":"std_4","term":"term_1","subject":"math","difficulty":"easy"}'

# Generate exam (server — includes answer_sheet)
curl -X POST https://noeyai-api-production.up.railway.app/api/v1/generate-exam \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {JWT}" \
  -H "X-AEP-Server-Key: noeyai_aep_server_key_2026_prod" \
  -d '{"standard":"std_4","term":"term_1","subject":"math","difficulty":"easy"}'

# Pool (server)
curl "https://noeyai-api-production.up.railway.app/api/v1/pool?status=approved&limit=50&offset=0" \
  -H "Authorization: Bearer {JWT}" \
  -H "X-AEP-Server-Key: noeyai_aep_server_key_2026_prod"

# Progress
curl https://noeyai-api-production.up.railway.app/api/v1/progress/user_123 \
  -H "Authorization: Bearer {JWT}"
```

---

## Approving Packages (Supabase SQL)

```sql
-- Approve a single package
UPDATE exam_pool
SET status = 'approved', approved_at = NOW()
WHERE package_id = 'pkg-std_4-term_1-math-easy-4308';

-- Approve all pending packages
UPDATE exam_pool
SET status = 'approved', approved_at = NOW()
WHERE status = 'pending_review';

-- Check pool inventory
SELECT standard, term, subject, difficulty, status, source, times_served, generated_at
FROM exam_pool
ORDER BY generated_at DESC;

-- Check generation failures
SELECT * FROM generation_failures ORDER BY attempted_at DESC;
```