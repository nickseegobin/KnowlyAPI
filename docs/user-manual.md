# Knowly Platform — User Manual

> **Version:** 2.2.0 · **Last updated:** 2026-05-12
>
> This manual covers the complete admin and student workflows for Curriculum setup, Trials,
> Quests, and Lessons, plus a React integration reference for each feature area.

---

## Table of Contents

1. [Platform Architecture](#1-platform-architecture)
2. [Curriculum Workflow](#2-curriculum-workflow)
3. [Trials Workflow](#3-trials-workflow)
4. [Quests Workflow](#4-quests-workflow)
5. [Lessons Workflow](#5-lessons-workflow)
6. [React Integration Guide](#6-react-integration-guide)

---

## 1. Platform Architecture

Knowly is a three-tier system:

```
React / Next.js  ──→  WordPress REST API  ──→  Railway (Node.js/Express)
                            ↓                          ↓
                        WP Database               Supabase (PostgreSQL)
                   (children, sessions,          (question_bank, trial_packs,
                    quests, lessons,              quest_questions, lesson_questions,
                    gem ledger, badges)           curriculum_topics, child_pack_history)
```

**Key rule:** React talks exclusively to WordPress (`/wp-json/knowly/v1/…`). WordPress proxies to Railway only when needed. Railway is never called directly from React.

### Data ownership

| Data | Stored in |
|------|-----------|
| Quest & Lesson training content | WordPress (`wp_knowly_quests`) |
| Quest sessions & gem ledger | WordPress (`wp_knowly_quest_sessions`, `wp_knowly_gem_ledger`) |
| Lesson sessions & answer results | WordPress (`wp_knowly_lesson_sessions`, `wp_knowly_lesson_question_results`) |
| Quest question results | WordPress (`wp_knowly_quest_question_results`) |
| Trial question bank | Supabase (`question_bank`) |
| Trial packs & pack history | Supabase (`trial_packs`, `child_pack_history`) |
| Quest questions | Supabase (`quest_questions`) |
| Lesson questions | Supabase (`lesson_questions`) |
| Curriculum topic vectors | Supabase + Pinecone |

---

## 2. Curriculum Workflow

Curriculum is the foundation. Every Quest, Lesson, and Trial draws from the curriculum to generate content.

### 2.1 Admin setup (WordPress)

**WP Admin → Knowly → Curriculum**

The Curriculum panel has three sections:

#### A. Overview board

Shows the current curriculum topology — all level × period × subject combinations with their topic counts.

- Use the **Level** and **Period** dropdowns to filter the view
- Each row shows `(module_number, module_title, topic_count, vector_count)` for a scope
- A **Refresh** button re-fetches from Railway without changing data

#### B. Add / manage topics

1. Select **Level** (e.g. `std_4`), **Period** (e.g. `term_1`), and **Subject** (e.g. `math`)
2. Fill in `Module number`, `Module title`, and `Topics` (comma-separated)
3. Click **Save Curriculum** — the WP admin POSTs to Railway `POST /curriculum-topics` which stores rows in `curriculum_topics` and upserts Pinecone vectors
4. Topics become immediately available for question generation

#### C. Remove topics by scope

Use **Archive by Scope** to retire all topics for a level × subject (and optionally a specific period). This archives the rows in Supabase and removes the Pinecone vectors, preventing those topics from influencing future generation.

**Caution:** Archiving topics does not delete existing generated questions — it only prevents new generation from using those topics.

### 2.2 When to update curriculum

| Trigger | Action |
|---------|--------|
| New term begins | Add topics for the new period |
| Topic list revised | Archive old scope, add corrected topics |
| New subject added | Add topics for all periods in the new subject |
| Curriculum error found | Archive → correct → re-add |

### 2.3 Curriculum → content flow

```
Add Topics (Curriculum panel)
        ↓
  Topics stored in Supabase + Pinecone
        ↓
  Question Bank generation uses topics for context
        ↓
  Quest / Lesson question generation uses topics for context
        ↓
  Trial question bank fills per (module × difficulty) slot
```

---

## 3. Trials Workflow

Trials are scored, token-gated exams that test curriculum knowledge. Each trial deducts 1 token from the parent wallet.

### 3.1 Admin setup

**WP Admin → Knowly → Question Bank**

#### Step 1 — Fill the question bank

Before students can take trials, each `(level × period × subject × module × difficulty)` slot must have enough questions.

1. Open **Question Bank** panel
2. Use the **Slot Coverage Board** to see which slots are `critical` (< 6), `low` (6–35), or `healthy` (≥ 36)
3. For any critical/low slot, click **Generate** to trigger AI generation
   - Async (default): returns immediately; 30–60 questions generate in background
   - Sync: waits for completion — use for urgent fills only
4. Review generated questions in the **Browse Questions** tab
5. Retire any incorrect questions using the **Edit** panel (set status = `retired`)

**Minimum safe stock per slot:**

| Difficulty | Recommended minimum |
|---|---|
| easy | 36+ (3× pack size of 12) |
| medium | 54+ (3× pack size of 18) |
| hard | 72+ (3× pack size of 24) |

#### Step 2 — Build Trial Packs

**WP Admin → Knowly → Trial Packs**

1. Select scope (level, period, subject, module, difficulty)
2. Click **Build Pack** — draws from the question bank and locks the questions to the pack
3. A pack is assigned a sequential `pack_sequence_number` — children receive packs in number order
4. Build at least 3 packs per branch before students can start sequential delivery

**Pack types:**

| Branch | Total Qs | Difficulty mix |
|---|---|---|
| easy | 12 | 9 easy, 2 medium, 1 hard |
| medium | 18 | 4 easy, 9 medium, 5 hard |
| hard | 24 | 3 easy, 9 medium, 12 hard |
| dynamic | variable | Per-module difficulty assigned at build time |

#### Step 3 — Monitor the watermark

**WP Admin → Knowly → Question Bank → Watermark**

The watermark shows unassigned question counts per slot. The auto-generation pipeline (triggered after each pack submission) tops up slots and builds new packs automatically when counts drop below thresholds. The admin panel provides a manual override for urgent situations.

### 3.2 Student flow

```
Parent selects child → browses exam catalogue → starts exam (–1 token)
        ↓
  WP resolves next pack in branch → questions delivered (no correct_answer)
        ↓
  Student answers questions → checkpoint saves (optional)
        ↓
  Student submits → WP scores against pack answer sheet
        ↓
  Result returned: score, topic breakdown, leaderboard update
        ↓
  AI insight generated on demand (POST /insights/exam/{session_id})
```

### 3.3 Token economy

- Parents purchase tokens via WooCommerce
- Each trial start costs 1 token
- Tokens are not refunded on cancellation
- Free-tier accounts receive 3 tokens on the 1st of each month

### 3.4 Resetting a child's trial history

If a child has exhausted all packs in a branch (503 `no_pack_available`), an admin can reset their history from **WP Admin → Knowly → Members → child profile → Reset Pack History**. This deletes all `child_pack_history` rows for that child, returning them to Pack #1 on every sequential branch.

---

## 4. Quests Workflow

Quests are the primary learning mode. Each quest covers a curriculum module with training content followed by 3 scored MCQs. Completing a quest for the first time awards a badge.

### 4.1 Admin setup

**WP Admin → Knowly → Quest Editor**

#### Step 1 — Generate quest content (training material)

1. Open **Quest Editor** panel
2. Select Level, Period, Subject
3. Click **Generate Quest** for a module — the editor calls Railway, which uses AI + Pinecone RAG to produce:
   - Module metadata (title, topic, objectives)
   - Training sections (body text)
   - Worked examples
   - Knowledge checks (inline MCQs with correct answers)
4. The generated content is stored as a `draft` quest in `wp_knowly_quests`
5. Review and edit the content in the editor
6. Click **Approve** to mark the quest as `approved` — it becomes visible to students

> Quests are stored with `variant='student'`. Admin previews use `variant='admin'`. Only `status='approved'` + `variant='student'` quests appear in the student catalogue.

#### Step 2 — Generate quest questions

**WP Admin → Knowly → Quests Panel**

After a quest is approved, generate its 3 comprehension MCQs:

1. Open **Quests Panel**
2. Use Level/Period/Subject filters to find the quest
3. Click **Generate Qs** — calls Railway `POST /quest/generate-questions`
4. A spinner shows while Railway generates 3 MCQs (comprehension, application, analysis)
5. On success, the quest badge updates to **3 Qs ✓** (green)
6. Use **↻ Regen Qs** to regenerate if questions are unsatisfactory

**Q count indicators:**

| Badge | Meaning |
|---|---|
| `3 Qs ✓` (green) | Ready — all 3 questions available |
| `N/3 Qs` (amber) | Incomplete — generation failed or partial |
| `0 Qs` (red) | No questions — generate before publishing |

#### Step 3 — Set sort order

Quests are delivered in `sort_order` sequence within a level+period+subject scope. Set sort orders in the Quest Editor to control the sequential lock order for students.

A student sees only their current quest and previously completed quests — they cannot skip ahead.

### 4.2 Gem cost configuration

**WP Admin → Knowly → Settings**

| Setting | Default | Key |
|---|---|---|
| First attempt cost | 3 gems | `knowly_gem_cost_quest_first_tt_primary` |
| Retake cost | 1 gem | `knowly_gem_cost_quest_retake_tt_primary` |

Assignment quests always cost 0 gems regardless of these settings.

### 4.3 Student flow

```
Child opens Quests → sees catalogue (sequential, locked past current position)
        ↓
  Child selects next available quest → taps Start (–3 gems first time, –1 retake)
        ↓
  Child reads sections → works through worked examples
        ↓
  Child attempts knowledge checks (inline — correct answer shown immediately)
        ↓
  Child completes all sections → questions appear (3 MCQs, no correct_answer)
        ↓
  Child submits answers → score returned (e.g. 2/3)
        ↓
  Child marks quest Complete → badge awarded if first completion
        ↓
  Next quest in sequence unlocked
```

### 4.4 Class assignments

Teachers can assign specific quests to their class via **WP Admin → Knowly → Classes**. Assigned quests arrive in the student's notification list with `source='assignment'` — starting them costs 0 gems.

---

## 5. Lessons Workflow

Lessons use the same training content as Quests but remove all progression gates: no gem cost, no sequential lock, no badge. They are designed for self-directed revision.

### 5.1 Admin setup

**WP Admin → Knowly → Lessons Panel**

#### Step 1 — Quest content (shared with Quests)

Lessons automatically inherit all approved quests — no separate content creation step. Every approved `variant='student'` quest is available as a lesson.

#### Step 2 — Generate lesson questions

Lesson questions are separate from quest questions and stored in `lesson_questions` (Supabase).

1. Open **Lessons Panel**
2. Use Level/Period/Subject filters
3. Click **Generate Qs** next to a quest — calls Railway `POST /lesson/generate-questions`
4. Railway generates 3 MCQs (comprehension, application, analysis)
5. Badge updates to **3 Qs ✓** on success

> Lesson questions and quest questions are independent — you must generate both separately. They can have different framing even if the underlying topic is the same.

### 5.2 Student flow

```
Child opens Lessons → sees full catalogue for their level/period (no sequential lock)
        ↓
  Child picks any topic freely (can revisit completed quests or jump ahead)
        ↓
  Child starts lesson (no gem cost, no gate)
        ↓
  Child reads content (same training material as the quest)
        ↓
  Child answers 3 MCQs at the end
        ↓
  Answers submitted silently — { recorded: true } — NO score displayed
        ↓
  Child marks lesson Complete
```

> **Design intent:** The silent submission prevents score anxiety. Admins can view lesson question performance in the Lessons Panel to identify topics where students are struggling, without exposing that data to students.

### 5.3 Key differences from Quests

| Feature | Quests | Lessons |
|---|---|---|
| Gem cost | Yes (3 first / 1 retake) | No |
| Sequential lock | Yes | No |
| Badge on completion | Yes (first time) | No |
| Score shown to student | Yes | No (silent) |
| Question bank | `quest_questions` (Supabase) | `lesson_questions` (Supabase) |
| Session table | `wp_knowly_quest_sessions` | `wp_knowly_lesson_sessions` |
| Results table | `wp_knowly_quest_question_results` | `wp_knowly_lesson_question_results` |

---

## 6. React Integration Guide

### 6.1 Setup

```ts
// lib/api.ts
import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE, // https://your-wp-site.com/wp-json/knowly/v1
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = getToken()  // read from HttpOnly cookie or localStorage
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearToken()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)
```

```env
# .env.local
NEXT_PUBLIC_API_BASE=https://your-wordpress-site.com/wp-json/knowly/v1
```

### 6.2 Auth flow

```ts
// Login
const { data } = await api.post('/auth/login', { username, password })
setToken(data.data.token)

// Load profile (includes children + token balance)
const { data: profile } = await api.get('/auth/me')

// Switch to child (required before any child-context endpoints)
await api.post(`/children/${childId}/switch`)

// Clear child context
await api.post('/children/deselect')
```

### 6.3 Trial (Exam) flow

```ts
// Browse available exams
const { data: catalogue } = await api.get('/exams', {
  params: { level: 'std_4', period: 'term_1' }
})

// Check for an interrupted exam first
const { data: active } = await api.get('/exams/active')
if (active.data.session) {
  // offer to resume or cancel
  await api.delete(`/exams/${active.data.session.session_id}`)
}

// Start exam (–1 token)
const { data: session } = await api.post('/exams/start', {
  level: 'std_4', period: 'term_1', subject: 'Mathematics', difficulty: 'medium'
})

// Checkpoint mid-exam
await api.post(`/exams/${session.data.session_id}/checkpoint`, {
  state: { current_question: 3, answers: { 'q-001': 'A' } }
})

// Submit
const { data: result } = await api.post(`/exams/${session.data.session_id}/submit`, {
  answers: [ /* per-question answer objects */ ]
})
// result.data → { score, total, percentage, topic_breakdown, leaderboard_update }

// Generate insight
const { data: insight } = await api.post(`/insights/exam/${session.data.session_id}`)
```

### 6.4 Quest flow

```ts
// Quest catalogue — sequential; only current + past quests are accessible
const { data: catalogue } = await api.get('/quests', { params: { subject: 'math' } })
const quest = catalogue.data.quests.find(q => !q.is_completed)

// Fetch training content
const { data: content } = await api.get(`/quests/${quest.quest_id}`)
// content.data.sections / .worked_examples / .knowledge_checks

// Start quest (check gem balance first via GET /gems/balance)
const { data: session } = await api.post('/quests/start', {
  quest_id: quest.quest_id,
  source: 'direct',
})
if (session.data.gem_cost > 0 && lowBalance) {
  showInsufficientGemsPrompt()
  return
}

// Mark sections complete as child progresses
for (const section of content.data.sections) {
  // ... render section ...
  await api.post(`/quests/${session.data.session_id}/section-complete`, {
    section_id: section.section_id,
  })
}

// Fetch and display the 3 MCQs
const { data: qs } = await api.get(`/quests/${quest.quest_id}/questions`)

// Submit answers (returns score)
const { data: score } = await api.post('/quests/submit-questions', {
  session_id: session.data.session_id,
  quest_id: quest.quest_id,
  answers: {
    [qs.data.questions[0].id]: selectedAnswers[0],
    [qs.data.questions[1].id]: selectedAnswers[1],
    [qs.data.questions[2].id]: selectedAnswers[2],
  },
})
showScoreScreen(score.data)  // score, total, percentage, per-question results

// Complete quest (badge if first time)
const { data: completion } = await api.post('/quests/complete', {
  session_id: session.data.session_id,
})
if (completion.data.badge_awarded) {
  showBadgeCelebration(completion.data.badge)
}
```

### 6.5 Lesson flow

```ts
// Lesson catalogue — no sequential lock, all approved quests available
const { data: catalogue } = await api.get('/lessons', { params: { subject: 'math' } })

// Child picks any lesson freely
const lesson = catalogue.data.lessons[userChoice]

// Fetch lesson content (same structure as quest content)
const { data: content } = await api.get(`/lessons/${lesson.quest_id}`)

// Start lesson (no gem cost, no check needed)
const { data: session } = await api.post('/lessons/start', {
  quest_id: lesson.quest_id,
  source: 'direct',
})

// Display content — no section-complete calls required for lessons

// Fetch the 3 lesson MCQs
const { data: qs } = await api.get(`/lessons/${lesson.quest_id}/questions`)

// Submit answers — silently recorded; DO NOT show a score screen
await api.post('/lessons/submit-questions', {
  session_id: session.data.session_id,
  quest_id: lesson.quest_id,
  answers: {
    [qs.data.questions[0].id]: selectedAnswers[0],
    [qs.data.questions[1].id]: selectedAnswers[1],
    [qs.data.questions[2].id]: selectedAnswers[2],
  },
})
// response → { recorded: true }  — move to completion screen, no score

// Complete lesson
await api.post('/lessons/complete', { session_id: session.data.session_id })
// response → { completed: true }
```

### 6.6 Error codes reference

| Code | HTTP | Context |
|---|---|---|
| `knowly_token_invalid` | 401 | JWT missing, expired, or malformed |
| `knowly_insufficient_gems` | 402 | Not enough gems to start a quest |
| `knowly_no_questions` | 404 | Quest/lesson has no generated questions yet |
| `knowly_missing_profile` | 422 | Child profile has no level set |
| `knowly_missing_fields` | 422 | Required field missing from request body |
| `knowly_invalid_answers` | 422 | `answers` is empty or not an object |
| `noey_insufficient_tokens` | 402 | No tokens for trial |
| `noey_no_active_child` | 422 | Parent must switch to a child first |
| `noey_no_exam_available` | 404 | Trial pool empty for this scope |
| `no_pack_available` | 503 | Trial pack queue exhausted — retry after `retry_after_seconds` |

### 6.7 Gem balance integration

```ts
// Check gem balance before starting a quest
const { data: gemData } = await api.get('/gems/balance')
// gemData.data → { balance: 15, lifetime_earned: 42 }

if (gemData.data.balance < quest.gem_cost) {
  // show "Not enough gems" prompt
} else {
  // proceed to start quest
}

// After quest start, refresh balance
// The start response includes `balance_after` — use that directly
const newBalance = session.data.balance_after
```

### 6.8 Leaderboard integration

```ts
// Subject board (daily reset at 04:00 UTC / Trinidad midnight)
const { data: board } = await api.get('/leaderboard/std_4/term_1/math')
// board.data.entries → top 10 + current child's position if outside top 10

// All boards the child appears on today
const { data: myBoards } = await api.get('/leaderboard/me')

// Points are automatically added on exam submit — no separate leaderboard call
// result.data.leaderboard_update → { points_earned, new_rank, previous_rank, ... }
```

### 6.9 Feature detection pattern

Use these checks to determine what the child can access:

```ts
const profile = await api.get('/auth/me')
const child = profile.data.data.children.find(c => c.child_id === activeChildId)

const canTakeTrials  = tokenBalance > 0
const canStartQuest  = gemBalance >= nextQuestCost
const canDoLesson    = true  // always free

// Quest sequential position — fetch catalogue and find first incomplete
const quests = await api.get('/quests')
const nextQuest = quests.data.data.quests.find(q => !q.is_completed)
const lockedQuests = quests.data.data.quests.filter(q => q.sort_order > nextQuest?.sort_order)
```

---

*Knowly Platform User Manual v2.2.0 — 2026-05-12*
