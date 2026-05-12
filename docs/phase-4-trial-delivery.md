# Phase 4 — Smart Trial Delivery

**Date:** 2026-05-11
**Status:** Designed — ready to implement
**Depends on:** Phase 3B (question_bank table + generation pipeline)

---

## Problem Statement

The current trial delivery model has two gaps:

1. **No live dynamic delivery for children** — `POST /trial` only serves from manually-built static packs. No fallback exists when no pack is available.
2. **No per-child deduplication** — a child can receive the same questions across multiple trial sessions. `times_served` / `last_served_at` track global usage only, not per-child history.

---

## Solution: Sequential Pack Branches + Pre-Stocked Dynamic Delivery

### Core principle

Rather than generating trials on-demand per child request, the system maintains a **pre-built queue of numbered packs** per scope. A child always receives the next unplayed pack in their branch. Packs are shared across children — built once, reused by many. This eliminates on-demand generation latency and gives the system a predictable, manageable delivery pipeline.

### Four delivery branches per scope

Each scope `(curriculum, level, period, subject)` maintains four independent sequential queues:

| Branch | Pack type | Description |
|--------|-----------|-------------|
| `easy` | Topic or General | Single-difficulty pack, easy mix (12 Qs: 9e+2m+1h) |
| `medium` | Topic or General | Single-difficulty pack, medium mix (18 Qs: 4e+9m+5h) |
| `hard` | Topic or General | Single-difficulty pack, hard mix (24 Qs: 3e+9m+12h) |
| `dynamic` | Multi-topic | All modules in scope, difficulty randomly assigned per module at build time |

Packs within each branch are numbered sequentially:
```
tt_primary / std_4 / term_1 / math / easy   → 001, 002, 003 …
tt_primary / std_4 / term_1 / math / dynamic → 001, 002, 003 …
```

A child always receives the **lowest-numbered pack in their branch that they haven't completed**. No random assignment. No on-demand generation at request time.

---

## Dynamic Branch — Pre-Stock Formula

Dynamic packs cover **all active modules** for the scope. The key insight: questions not used in one child's combination are still available for another child who requests a different combination — nothing is wasted.

### Minimum stock per topic slot

The watermark threshold for each `(module × difficulty)` slot is derived from the dynamic pack formula:

| Pack difficulty | Total Qs | Min topics assumed | Min stock per topic slot |
|-----------------|----------|--------------------|--------------------------|
| Easy            | 12       | 2                  | **6 per slot**           |
| Medium          | 18       | 2                  | **9 per slot**           |
| Hard            | 24       | 2                  | **12 per slot**          |

These thresholds replace the previous arbitrary watermark values with numbers that have concrete delivery meaning: the slot has enough questions to contribute to any dynamic pack regardless of how many topics are selected.

### Dynamic pack assembly

At build time (not request time):

1. Fetch all active modules for the scope
2. Randomly assign a difficulty to each module — locked permanently into the pack
3. Apply the per-topic draw count: `total_pack_questions / topic_count` (rounded, remainder distributed evenly)
4. Apply difficulty mix **at the whole-pack level**, not per topic:
   - Easy pack: draw 9 easy + 2 medium + 1 hard total across all topics
   - Medium pack: draw 4 easy + 9 medium + 5 hard total
   - Hard pack: draw 3 easy + 9 medium + 12 hard total
5. Lock questions via `assigned_pack_id`
6. Store `module_assignments[]` on the pack row (which module got which difficulty)
7. Assign next sequence number for the dynamic branch

Dynamic packs **cannot be assembled** if any topic slot is below its minimum stock threshold. `AutoGenerateQuestions` must run first for that slot.

---

## New Database Objects

### `child_pack_history` (Supabase)

```sql
CREATE TABLE child_pack_history (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id     BIGINT NOT NULL,        -- WP user ID
  pack_id      UUID NOT NULL REFERENCES trial_packs(id),
  session_id   UUID,                   -- links to exam session
  score        NUMERIC(5,2),           -- percentage score at completion
  completed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (child_id, pack_id)           -- one completion record per child per pack
);

CREATE INDEX idx_child_pack_history_child   ON child_pack_history (child_id);
CREATE INDEX idx_child_pack_history_pack    ON child_pack_history (pack_id);
CREATE INDEX idx_child_pack_history_child_completed ON child_pack_history (child_id, completed_at);
```

Written to on `submit-exam` — not on serve. Abandoned sessions do not create a history record, meaning a child who starts and quits may see the same pack again on their next trial. This is intentional.

### `trial_packs` — new column

```sql
ALTER TABLE trial_packs ADD COLUMN pack_sequence_number INT;
-- Unique per scope key: (curriculum, level, period, subject, difficulty, pack_type)
```

### Removed: `times_served`, `last_served_at` on `question_bank`

These global counters are redundant once child-level pack tracking is in place. Questions are rotated fairly by pack assignment (each pack draws from the unassigned pool in question order), not by per-question serve count. These columns can be dropped once the new delivery model is live.

---

## Auto-Generation Pipeline

Four methods govern the system. All are fire-and-forget background jobs — none block trial delivery.

### `AutoGenerateQuestions(scope, slot, count)`

```
Fires when: unassigned questions for a (module × difficulty) slot < minimum stock threshold
Does:
  - Calls POST /question-bank/generate for that slot
  - count = minimum_stock − current_count (plus a buffer, e.g. × 2)
  - Logs the trigger event
```

### `AutoGeneratePack(scope, difficulty)`

```
Fires when: unplayed packs in the Easy/Medium/Hard branch for a scope < PACK_LOW_WATERMARK
Does:
  - Verifies each required slot meets minimum stock (triggers AutoGenerateQuestions if not)
  - Calls POST /trial-packs/build (non-preview)
  - Assigns next sequence number for this branch
  - Logs the new pack
```

### `AutoGenerateDynamicPack(scope)`

```
Fires when: unplayed dynamic packs for a scope < PACK_LOW_WATERMARK
Does:
  - Fetches all active modules for the scope
  - Verifies ALL (module × difficulty) slots meet minimum stock — if any are below, triggers
    AutoGenerateQuestions for those slots, then retries
  - Randomly assigns difficulty per module (locked into pack)
  - Calls POST /trial-packs/build equivalent with multi-module assembly
  - Assigns next sequence number for the dynamic branch
  - Stores module_assignments[] on the pack row
```

### `AdminReset(child_id, scope?)`

```
Fires when: admin triggers manually (new WP Admin action)
Does:
  - Deletes child_pack_history rows for the child
  - Optional scope filter (reset only one subject, or all)
  - Child will receive Pack 001 again on next trial request
  - Logs the reset with admin user ID and timestamp
```

### Trigger point

All auto-generation checks run **after `submit-exam` completes** as a background job. Lightweight watermark check → fire-and-forget if thresholds are crossed. Never blocks the trial response.

---

## Watermark Thresholds

| Threshold | Value | Meaning |
|-----------|-------|---------|
| `QUESTION_LOW_WATERMARK` | 6 / 9 / 12 (by difficulty) | Per topic slot — triggers `AutoGenerateQuestions` |
| `PACK_LOW_WATERMARK` | 3 | Unplayed packs per scope per branch — triggers `AutoGeneratePack` |
| `DYNAMIC_PACK_LOW_WATERMARK` | 2 | Unplayed dynamic packs per scope — triggers `AutoGenerateDynamicPack` |

---

## Trial Delivery Flow (updated `POST /trial`)

```
1. Child requests trial: { child_id, subject, level, period, branch }
   branch = 'easy' | 'medium' | 'hard' | 'dynamic'

2. Fetch child's completed pack IDs for this scope from child_pack_history

3. Find the lowest sequence_number pack for this scope + branch not in completed list
   WHERE status = 'active'

4. If no pack available:
   → Return 503 with code: 'no_pack_available'
   → Trigger AutoGeneratePack or AutoGenerateDynamicPack in background
   → Client shows "Preparing your next trial — try again in a moment"

5. Serve pack questions → create exam session (existing flow, unchanged)

6. On submit-exam:
   → Score session (existing)
   → Write row to child_pack_history (child_id, pack_id, session_id, score, completed_at)
   → Run watermark check in background → fire AutoGenerate* if needed
```

---

## Caching: Why Shared Packs Work

A pack built for one child is available for all children who haven't played it. This is the caching layer — no separate mechanism needed. Pack `easy/003` for `std_4/term_1/math` is served identically to Child A, Child B, and Child C. Each child's history record marks it as played independently.

This means:
- No per-request generation delay
- No duplicate generation costs
- Predictable question distribution (every child gets the same sequence, ensuring coverage)
- Easy to reason about pool depth: `available_packs = total_packs − max(child_completion_count)`

---

## What Stays the Same

- All existing pack admin tooling (Pack Library tab, Simulations tab, Pack Builder) is unchanged
- `POST /trial-packs/build` is unchanged — `AutoGeneratePack` and `AutoGenerateDynamicPack` call it internally
- `POST /question-bank/generate` is unchanged — `AutoGenerateQuestions` calls it internally
- The admin dynamic preview (`POST /trial-packs/dynamic-preview`) stays as-is for admin simulation
- `submit-exam`, `checkpoint`, `resume-exam`, `cancel-exam` are unchanged

---

## Implementation Order

| Step | What | Where |
|------|------|-------|
| 1 | Create `child_pack_history` table in Supabase | Supabase migration |
| 2 | Add `pack_sequence_number` column to `trial_packs` | Supabase migration |
| 3 | Update `POST /trial` to read from `child_pack_history` and serve next unplayed pack | Railway `src/routes/trial.js` |
| 4 | Update `submit-exam` to write to `child_pack_history` | Railway `src/routes/trial.js` |
| 5 | Build `AutoGenerateQuestions` service | Railway `src/services/autoGenerate.js` |
| 6 | Build `AutoGeneratePack` service | Railway `src/services/autoGenerate.js` |
| 7 | Build `AutoGenerateDynamicPack` service | Railway `src/services/autoGenerate.js` |
| 8 | Wire watermark check into `submit-exam` (background) | Railway `src/routes/trial.js` |
| 9 | Add `AdminReset` AJAX handler + WP Admin button on child profile | KnowlyWP |
| 10 | Drop `times_served`, `last_served_at` from question_bank | Supabase migration (after step 8 stable) |

---

## Open Questions (resolved)

| Question | Decision |
|----------|----------|
| Who selects topics for dynamic delivery? | System — always uses all active modules for the child's scope |
| Who selects difficulty for sequential delivery? | Child selects Easy/Medium/Hard branch explicitly |
| When is history written? | On `submit-exam` only — not on serve |
| Per-question or per-pack tracking? | Per-pack — simpler, no exclusion query needed |
| Fractional topic draw rounding? | `floor(pack_questions / topic_count)`, remainder distributed to first N topics |
| What replaces `times_served`? | Nothing — child_pack_history makes it redundant |
