# Knowly API — React Client Reference

Base URL: `https://<railway-host>/api/v1`

All endpoints require a bearer JWT (child or parent token) **or** the server key header,
depending on whether they are child-facing or admin-only. This is noted per endpoint.

---

## Authentication

| Header | Used by |
|--------|---------|
| `Authorization: Bearer <jwt>` | Child/parent-facing endpoints |
| `X-AEP-Server-Key: <key>` | Admin/server-only endpoints |

JWTs are issued by the WordPress plugin on login and expire after 7 days.

---

## Trials — Exam Flow

### Start a trial

```
POST /trial
```

**Auth:** Bearer JWT (child)

**Body:**
```json
{
  "child_id": "uuid",
  "subject":  "math",
  "level":    "std_4",
  "period":   "term_1"
}
```

**Response:**
```json
{
  "session_id": "uuid",
  "questions":  [ /* question objects */ ],
  "pack_id":    "uuid | null",
  "dynamic":    false
}
```

---

### Submit exam

```
POST /submit-exam
```

**Auth:** Bearer JWT (child)

**Body:**
```json
{
  "session_id": "uuid",
  "answers": { "q_uuid": "A", "q_uuid2": "C" }
}
```

**Response:** score, correct count, incorrect count, per-question breakdown.

---

### Checkpoint (auto-save)

```
POST /checkpoint
```

**Auth:** Bearer JWT (child)

**Body:**
```json
{
  "session_id": "uuid",
  "answers":    { "q_uuid": "B" },
  "elapsed_ms": 12000
}
```

---

### Resume exam

```
GET /resume-exam?session_id=<uuid>
```

**Auth:** Bearer JWT (child)

Returns remaining questions and current answer state.

---

### Cancel exam

```
POST /cancel-exam
```

**Auth:** Bearer JWT (child)

**Body:** `{ "session_id": "uuid" }`

---

## Trial Assembly (Admin — server key)

### Assemble a trial from the question bank

```
POST /trial/assemble
```

**Auth:** Server key (`X-AEP-Server-Key`)

Draws questions directly from `question_bank` (module-number based, not pack-based).
Used for on-demand assembly when the pack queue is not yet seeded.
Serves the least-recently-used questions first; marks `last_served_at` and increments `times_served`.
If the pool is short, attempts synchronous generation to fill the shortfall before responding.

**Body:**
```json
{
  "curriculum":           "tt_primary",
  "level":                "std_4",
  "period":               "term_1",
  "subject":              "math",
  "difficulty":           "easy",
  "module_numbers":       [4, 5],
  "question_count":       10,
  "exclude_question_ids": []
}
```

`module_numbers` — one or more module numbers to draw from. Questions are distributed
proportionally via round-robin across modules when multiple are requested.

`exclude_question_ids` — optional array of UUIDs to skip (cross-session deduplication).

**Response:**
```json
{
  "meta": {
    "curriculum":              "tt_primary",
    "level":                   "std_4",
    "period":                  "term_1",
    "subject":                 "math",
    "difficulty":              "easy",
    "module_numbers":          [4, 5],
    "question_count":          10,
    "time_per_question_seconds": 90,
    "total_time_seconds":      900,
    "topics_covered":          ["Number Patterns", "Fractions"],
    "source":                  "pool",
    "from_pool":               10,
    "from_generated":          0
  },
  "questions":    [ /* shuffled, no correct_answer */ ],
  "answer_sheet": [
    { "question_id": "uuid", "correct_answer": "B", "explanation": "..." }
  ]
}
```

`source` is `"pool"` when all questions came from existing stock, `"mixed"` when some were generated on-the-fly.

**503 (pool_empty)** — no questions available and generation failed.

---

## Trial Packs (Admin — server key)

### Build a static pack

```
POST /trial-packs/build
```

**Body:**
```json
{
  "curriculum":    "tt_primary",
  "level":         "std_4",
  "period":        "term_1",
  "subject":       "math",
  "module_number": 4,
  "pack_type":     "topic",
  "difficulty":    "easy",
  "preview":       false
}
```

`module_number` — omit for General packs (all modules).
`preview: true` — returns questions without saving or locking `assigned_pack_id`.

**Difficulty mix (3-pool draw):**

| Pack type | Total Qs | Easy | Medium | Hard |
|-----------|----------|------|--------|------|
| easy      | 12       | 9    | 2      | 1    |
| medium    | 18       | 4    | 9      | 5    |
| hard      | 24       | 3    | 9      | 12   |

Each pool (easy/medium/hard) is fetched independently. Shortfalls are reported in
`shortfalls[]` but do not abort the build — the pack is built with available questions.

**Response (saved):**
```json
{
  "pack_id":        "uuid",
  "difficulty":     "easy",
  "pack_type":      "topic",
  "module_numbers": [4],
  "question_count": 12,
  "shortfalls":     [],
  "questions":      [ /* ... */ ]
}
```

---

### Dynamic preview (multi-topic)

```
POST /trial-packs/dynamic-preview
```

Simulates live React exam behaviour: difficulty is randomly assigned per module.
Nothing is saved — for admin preview only.

**Body:**
```json
{
  "curriculum":           "tt_primary",
  "level":                "std_4",
  "period":               "term_1",
  "subject":              "math",
  "modules":              [4, 5, 6, 7],
  "questions_per_module": 4
}
```

**Response:**
```json
{
  "preview":              true,
  "dynamic":              true,
  "question_count":       16,
  "questions_per_module": 4,
  "module_assignments": [
    { "module_number": 4, "difficulty_drawn": "hard",   "questions_drawn": 4 },
    { "module_number": 5, "difficulty_drawn": "easy",   "questions_drawn": 4 },
    { "module_number": 6, "difficulty_drawn": "medium", "questions_drawn": 4 },
    { "module_number": 7, "difficulty_drawn": "easy",   "questions_drawn": 4 }
  ],
  "questions": [ /* shuffled */ ]
}
```

---

### Watermark (slot health)

```
GET /trial-packs/watermark?level=std_4&subject=math&period=term_1
```

Returns unassigned question counts per `(module × difficulty)` slot.

| Status   | Threshold |
|----------|-----------|
| critical | < 6       |
| low      | 6–35      |
| healthy  | ≥ 36      |

---

### List packs

```
GET /trial-packs/list?level=std_4&subject=math&period=term_1&difficulty=easy&status=active&page=1&per_page=20
```

`status` accepts: `active`, `archived`, `all`.

Each pack object includes `branch` (`easy` | `medium` | `hard` | `dynamic`) and
`pack_sequence_number` (integer, sequential per scope+branch) added in Phase 4.

---

### Get pack + questions

```
GET /trial-packs/:id
```

---

### Archive a pack

```
PATCH /trial-packs/:id
```

**Body:**
```json
{
  "status":            "archived",
  "release_questions": true
}
```

`release_questions: true` — NULLs `assigned_pack_id` on all pack questions,
returning them to the available pool. Questions are not deleted.

`release_questions: false` (default) — pack is archived but questions remain locked.

---

### Disband a pack

```
DELETE /trial-packs/:id
```

Permanently deletes the pack row and releases all locked questions back to the pool
(NULLs `assigned_pack_id`). Works on both active and archived packs. Irreversible.

**Response:**
```json
{
  "disbanded": true,
  "released":  12
}
```

---

## Sequential Trial Delivery (Phase 4)

### Get next pack for a child

```
GET /trial/next-pack
```

**Auth:** Server key (`X-AEP-Server-Key`)

**Query params:**

| Param       | Required | Description                                    |
|-------------|----------|------------------------------------------------|
| child_id    | yes      | Integer WP user ID of the child                |
| level       | yes      | e.g. `std_4`                                   |
| subject     | yes      | e.g. `math`                                    |
| branch      | yes      | `easy` \| `medium` \| `hard` \| `dynamic`      |
| period      | no       | e.g. `term_1` — omit for SEA (capstone)        |
| curriculum  | no       | default `tt_primary`                           |

Finds the lowest-sequence active pack in the requested branch that the child has not yet completed (not in `child_pack_history`). Returns questions shuffled for delivery plus the full answer sheet for WP session storage.

**Response:**
```json
{
  "pack_id":         "uuid",
  "branch":          "easy",
  "sequence_number": 1,
  "question_count":  12,
  "meta": {
    "curriculum":       "tt_primary",
    "level":            "std_4",
    "period":           "term_1",
    "subject":          "math",
    "branch":           "easy",
    "pack_type":        "topic",
    "module_numbers":   [4],
    "module_assignments": null
  },
  "questions":    [ /* shuffled, no correct_answer */ ],
  "answer_sheet": [
    { "question_id": "uuid", "correct_answer": "B", "explanation": "..." }
  ]
}
```

**503 (no_pack_available)** — returned when the child has exhausted all built packs for this branch. Background generation is queued automatically.

```json
{
  "error":               "No pack available for this branch — generation queued.",
  "code":                "no_pack_available",
  "retry_after_seconds": 30
}
```

---

### Submit a pack exam

```
POST /submit-pack-exam
```

**Auth:** Bearer JWT (child)

**Body:**
```json
{
  "pack_id":               "uuid",
  "session_id":            "uuid",
  "answers":               { "question_uuid": "B", "question_uuid2": "A" },
  "time_elapsed_seconds":  420,
  "time_remaining_seconds": 660
}
```

Scores the answers against the pack's answer sheet in `question_bank`, writes `exam_sessions` (source=`pack`), upserts `child_pack_history`, and fires `checkAndAutoGenerate` in the background.

**Response:**
```json
{
  "session_id":    "uuid",
  "pack_id":       "uuid",
  "score":         9,
  "total":         12,
  "percentage":    75,
  "topic_breakdown": [
    { "topic": "Fractions", "correct": 4, "total": 5, "percentage": 80 }
  ],
  "answer_sheet": [
    { "question_id": "uuid", "selected_answer": "B", "correct_answer": "B", "is_correct": true, "explanation": "..." }
  ]
}
```

---

### Reset a child's pack history (Admin)

```
DELETE /trial/child-history?child_id=<integer>
```

**Auth:** Server key (`X-AEP-Server-Key`)

Deletes all `child_pack_history` rows for the given child, resetting them to Pack #1 on every sequential branch. Called by the WP Admin "Reset Pack History" button on the child profile page.

**Response:**
```json
{ "deleted": 5, "child_id": 42 }
```

`deleted: 0` is a valid success response if the child had no pack history.

---

## Question Bank (Admin — server key)

### Slot coverage board

```
GET /question-bank/list?level=std_4&subject=math&period=term_1
```

Returns one row per `(module_number × difficulty)` combination with question counts.
Used by the WP Admin QB board to show slot fill health.

**Response:**
```json
{
  "curriculum": "tt_primary",
  "level":      "std_4",
  "period":     "term_1",
  "subject":    "math",
  "slots": [
    {
      "module_number":  4,
      "module_title":   "Number Patterns",
      "difficulty":     "easy",
      "question_count": 42,
      "active_count":   38
    }
  ]
}
```

---

### List modules

```
GET /question-bank/modules?level=std_4&subject=math&period=term_1
```

Returns distinct `[{ module_number, module_title }]` for the given scope,
ordered by `module_number`. Use this to populate module selection dropdowns.

---

### Browse questions

```
GET /question-bank/questions?level=std_4&subject=math&period=term_1&module_number=4&difficulty=easy&status=active&page=1&per_page=25
```

`status` accepts: `active`, `retired`, `pending_review`, `all`.

**Response:**
```json
{
  "questions": [ /* ... */ ],
  "total":    32,
  "page":     1,
  "per_page": 25,
  "pages":    2
}
```

**Question object:**
```json
{
  "id":             "uuid",
  "module_number":  4,
  "module_title":   "Number Patterns",
  "topic":          "Sequences",
  "question":       "What comes next in the pattern 2, 4, 8, 16, …?",
  "options":        { "A": "18", "B": "32", "C": "24", "D": "20" },
  "correct_answer": "B",
  "difficulty":     "easy",
  "explanation":    "Each term doubles.",
  "tip":            "Look at the ratio between terms.",
  "cognitive_level":"recall",
  "times_served":   0,
  "last_served_at": "2026-05-01T10:00:00Z",
  "status":         "active"
}
```

---

### Edit a question

```
PATCH /question-bank/questions/:id
```

Any combination of the fields below; at least one required.

**Body:**
```json
{
  "question":      "Updated question text",
  "options":       { "A": "...", "B": "...", "C": "...", "D": "..." },
  "correct_answer":"C",
  "difficulty":    "medium",
  "explanation":   "Updated explanation",
  "tip":           "Updated tip",
  "topic":         "Updated topic",
  "status":        "active"
}
```

`status` accepts: `active`, `retired`, `pending_review`.

**Response:** `{ "updated": true, "question": { /* full updated question object */ } }`

---

### Generate questions (AI)

```
POST /question-bank/generate
```

`sync: false` (default) — returns immediately; generation runs in background.
`sync: true` — waits for generation to complete (~30–60 s).

**Body:**
```json
{
  "curriculum":    "tt_primary",
  "level":         "std_4",
  "period":        "term_1",
  "subject":       "math",
  "module_number": 4,
  "difficulty":    "easy",
  "count":         30,
  "sync":          false
}
```

**Response (async):**
```json
{ "sync": false, "queued": true, "slot": "std_4/term_1/math/module_4/easy" }
```

---

### Retire all questions (purge)

```
DELETE /question-bank/purge
```

Retires all `active` and `pending_review` questions in the bank. Irreversible. Admin use only.

**Response:** `{ "retired": 1420 }`

---

## Progress & Insights (child-facing)

### Child progress

```
GET /progress?child_id=<uuid>
```

---

### Session insight

```
GET /insight?session_id=<uuid>
```

---

### Overall insight

```
GET /overall-insight?child_id=<uuid>&subject=math
```

---

## Leaderboard

```
GET /leaderboard?level=std_4&subject=math&period=term_1&limit=10
```

---

## Progression

```
GET  /progression?child_id=<uuid>
POST /progression  { child_id, subject, module_number, ... }
```

---

## Health

```
GET /health
```

Returns `{ status: "ok", timestamp }`. No auth required.

---

*Last updated: 2026-05-11 (Phase 4 Sequential Delivery). Keep this document in sync with `src/routes/` when endpoints change.*
