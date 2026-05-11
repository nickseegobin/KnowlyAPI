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

*Last updated: 2026-05-11. Keep this document in sync with `src/routes/` when endpoints change.*
