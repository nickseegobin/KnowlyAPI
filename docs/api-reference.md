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
`preview: true` — returns questions without saving or assigning.

**Difficulty mix:**

| Pack | Total | Easy | Medium | Hard |
|------|-------|------|--------|------|
| easy | 12 | 9 | 2 | 1 |
| medium | 18 | 4 | 9 | 5 |
| hard | 24 | 3 | 9 | 12 |

**Response (saved):**
```json
{
  "pack_id":        "uuid",
  "difficulty":     "easy",
  "pack_type":      "topic",
  "module_numbers": [4],
  "question_count": 12,
  "questions":      [ /* ... */ ]
}
```

---

### Dynamic preview (multi-topic)

```
POST /trial-packs/dynamic-preview
```

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

Each module is randomly assigned a difficulty; questions are drawn from that module's
unassigned pool at the assigned difficulty. Nothing is saved.

**Response:**
```json
{
  "preview":             true,
  "dynamic":             true,
  "question_count":      16,
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

| Status | Threshold |
|--------|-----------|
| critical | < 6 |
| low | 6–35 |
| healthy | ≥ 36 |

---

### List packs

```
GET /trial-packs/list?level=std_4&subject=math&period=term_1&difficulty=easy&status=active&page=1&per_page=20
```

---

### Get pack + questions

```
GET /trial-packs/:id
```

---

### Archive pack

```
PATCH /trial-packs/:id
```

**Body:** `{ "status": "archived" }`

---

## Question Bank (Admin — server key)

### List modules

```
GET /question-bank/modules?level=std_4&subject=math&period=term_1
```

Returns distinct `[{ module_number, module_title }]` for the given scope.
Use this to populate module selection dropdowns.

---

### Browse questions

```
GET /question-bank/questions?level=std_4&subject=math&period=term_1&module_number=4&difficulty=easy&status=active&page=1&per_page=25
```

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
  "id":            "uuid",
  "module_number": 4,
  "module_title":  "Number Patterns",
  "topic":         "Sequences",
  "question":      "What comes next in the pattern 2, 4, 8, 16, …?",
  "options":       { "A": "18", "B": "32", "C": "24", "D": "20" },
  "correct_answer":"B",
  "difficulty":    "easy",
  "explanation":   "Each term doubles.",
  "tip":           "Look at the ratio between terms.",
  "cognitive_level":"recall",
  "times_served":  0,
  "status":        "active"
}
```

---

### Edit a question

```
PATCH /question-bank/questions/:id
```

**Body (any combination, at least one field):**
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

---

### Generate questions (AI)

```
POST /question-bank/generate
```

**Body:**
```json
{
  "curriculum":    "tt_primary",
  "level":         "std_4",
  "period":        "term_1",
  "subject":       "math",
  "module_number": 4,
  "module_title":  "Number Patterns",
  "topic":         "Sequences",
  "difficulty":    "easy",
  "count":         10
}
```

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
