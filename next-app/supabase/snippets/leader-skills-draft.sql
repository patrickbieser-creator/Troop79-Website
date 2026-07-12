-- ═══════════════════════════════════════════════════════════════════════════
-- DRAFT: leader skills + scout instructor authorizations — EDIT, THEN RUN
--
-- Run AFTER 20260711000000_meeting_plan_skills.sql. Safe to re-run
-- (on conflict do nothing). Generated 2026-07-11 by reasoning over:
--   * leaders.role (Scoutmaster/ASM roles imply core outdoor-skills coverage)
--   * merit_badge_counselors (a counselor assignment is direct evidence)
--   * the Star+ roster (scout instructor candidates)
--
-- Badge → skill inference used: Cooking→cooking · Camping→camping ·
-- Citizenship (any)→citizenship · Communication→teaching · First Aid→first-aid
-- Swimming/Lifesaving/paddling→aquatics · Personal Fitness→fitness ·
-- Env. Science/Nature/Weather/Fishing→nature · Pioneering→knots ·
-- Fire Safety MB→fire-safety · Emerg. Prep / SAR→safety · Woodwork→woods-tools
--
-- Skill ids: first-aid, knots, woods-tools, fire-safety, cooking, navigation,
--            fitness, camping, aquatics, nature, citizenship, teaching, safety
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ADULT LEADERS ─────────────────────────────────────────────────────────

-- PB · Patrick Bieser — Scoutmaster / Advancement Chair.
-- Counselor for: Camping, Cooking, Citizenship Community, Citizenship World.
-- SM role adds the core instruction set (knots, teaching/EDGE, navigation).
insert into public.leader_skills (leader_code, skill_id) values
  ('PB', 'camping'),
  ('PB', 'cooking'),
  ('PB', 'citizenship'),
  ('PB', 'knots'),
  ('PB', 'navigation'),
  ('PB', 'teaching')
on conflict do nothing;

-- MS · Mindy Stollenwerk — Assistant Scoutmaster. Counselor for: Cooking.
-- ASM role adds camping + teaching.
insert into public.leader_skills (leader_code, skill_id) values
  ('MS', 'cooking'),
  ('MS', 'camping'),
  ('MS', 'teaching')
on conflict do nothing;

-- PP · Paul Pasquesi — NO LONGER ACTIVE in the troop (per Patrick,
-- 2026-07-11). No skills assigned; code stays in `leaders` for historical
-- ledger sign-offs only.

-- MB · Mike Black — Assistant Scoutmaster. Same ASM default. EDIT to reality.
insert into public.leader_skills (leader_code, skill_id) values
  ('MB', 'camping'),
  ('MB', 'knots'),
  ('MB', 'teaching')
on conflict do nothing;

-- JP · Jason Porter — Committee Chair. Counselor for: Citizenship Nation,
-- Archery (no archery skill in the taxonomy — shooting sports are
-- certified-instructor-only and outing-bound anyway).
insert into public.leader_skills (leader_code, skill_id) values
  ('JP', 'citizenship')
on conflict do nothing;

-- BV · Becky Vest — Merit Badge Counselor for: Communication.
-- Communication ≈ presentation/EDGE coaching → teaching.
insert into public.leader_skills (leader_code, skill_id) values
  ('BV', 'teaching')
on conflict do nothing;

-- ── ADULTS-ONLY SKILLS COVERAGE (per Patrick, 2026-07-11) ─────────────────
-- Patrick Bieser, Dan Bieser, Jason Porter, Nate Vest, Mike Babby, and
-- Mindy Stollenwerk carry all four adult-instruction skills: first-aid,
-- woods-tools, fire-safety, aquatics.
insert into public.leader_skills (leader_code, skill_id)
select l.code, s.id
from (values ('PB'), ('DB'), ('JP'), ('NV'), ('MBa'), ('MS')) as l(code)
cross join (values ('first-aid'), ('woods-tools'), ('fire-safety'), ('aquatics')) as s(id)
on conflict do nothing;

-- ── NO EVIDENCE YET — uncomment and edit what applies ─────────────────────
-- JT  · Jamie Lynn Tatera — listed as MB Counselor but no badge assignments.
-- KM  · Kevin Malloy      — listed as MB Counselor but no badge assignments.
-- JK  · Jack Kosmoski     — no role on file.
-- KB  · Kevin Barry       — no role on file.
-- LMP · Lisa Pieper       — no role on file.
-- MC  · Mark Carrol       — no role on file.
-- NB  · Nina Bendre       — no role on file.
-- SK  · Summer Kimble     — no role on file.
-- SM  · Skip Manning      — no role on file.
-- (DB, NV, MBa carry the adults-only set above — add their youth-teachable
--  skills, e.g. knots/camping/cooking, here as you learn them.)
--
-- Template (copy per leader, keep only true skills):
-- insert into public.leader_skills (leader_code, skill_id) values
--   ('JT', 'first-aid'),   -- adult-only skills need a qualified adult: first-aid,
--   ('JT', 'woods-tools'), -- woods-tools, fire-safety, aquatics
--   ('JT', 'fire-safety'),
--   ('JT', 'aquatics'),
--   ('JT', 'cooking'),
--   ('JT', 'knots'),
--   ('JT', 'navigation'),
--   ('JT', 'fitness'),
--   ('JT', 'camping'),
--   ('JT', 'nature'),
--   ('JT', 'citizenship'),
--   ('JT', 'teaching'),
--   ('JT', 'safety')
-- on conflict do nothing;

-- ✓ Adults-only coverage is handled by the block above (PB, DB, JP, NV, MBa,
-- MS) — first-aid and Totin' Chip sessions will match a teacher.

-- ── INTENTIONALLY SKIPPED (not teaching adults) ───────────────────────────
-- Camp, Clinic, Event, Outing, Prior, Project, Lead, T61, T118, T105, Turner
--   → bookkeeping/pseudo signers, not people.
-- MST (Maya), JPII (Jack P.), OV (Oliver), VK (Veronica), KP (Kevin P.)
--   → these sign-off codes are your OLDER SCOUTS; their teaching goes through
--     scout_instructors below, not leader_skills.
-- HS (Hazel), FP (Finn), AS (Alex)
--   → look like former scouts/alumni; add as leader_skills only if they're
--     now registered adults who attend meetings. (NV · Nate Vest is confirmed
--     an active adult — covered in the adults-only block above.)

-- ── SCOUT INSTRUCTORS (Star+, youth-teachable skills only) ────────────────
-- Blanket per-skill authorization. Drafted conservatively: Life scouts get
-- the full core instruction set; Star scouts start with knots + camping.
-- Valid skills here: knots, cooking, navigation, fitness, camping, nature,
-- citizenship, teaching, safety. (first-aid / woods-tools / fire-safety /
-- aquatics are adults-only and will be rejected by the app.)

-- A01 · Maya Sankpal-Tatera — Life
insert into public.scout_instructors (scout_id, skill_id, authorized_by) values
  ('A01', 'knots', 'draft'),
  ('A01', 'camping', 'draft'),
  ('A01', 'cooking', 'draft'),
  ('A01', 'navigation', 'draft')
on conflict do nothing;

-- C05 · Kevin Pieper — Life
insert into public.scout_instructors (scout_id, skill_id, authorized_by) values
  ('C05', 'knots', 'draft'),
  ('C05', 'camping', 'draft'),
  ('C05', 'cooking', 'draft'),
  ('C05', 'navigation', 'draft')
on conflict do nothing;

-- A03 · Jack Porter — Star
insert into public.scout_instructors (scout_id, skill_id, authorized_by) values
  ('A03', 'knots', 'draft'),
  ('A03', 'camping', 'draft')
on conflict do nothing;

-- A05 · Oliver Vest — Star
insert into public.scout_instructors (scout_id, skill_id, authorized_by) values
  ('A05', 'knots', 'draft'),
  ('A05', 'camping', 'draft')
on conflict do nothing;

-- A12 · Veronica Kleinfeldt — Star
insert into public.scout_instructors (scout_id, skill_id, authorized_by) values
  ('A12', 'knots', 'draft'),
  ('A12', 'camping', 'draft')
on conflict do nothing;

-- ── sanity check after running ────────────────────────────────────────────
-- select l.name, s.name as skill from leader_skills ls
--   join leaders l on l.code = ls.leader_code
--   join skills s on s.id = ls.skill_id
--   order by l.name, s.sort_order;
-- select sc.display_name, s.name as skill from scout_instructors si
--   join scouts sc on sc.id = si.scout_id
--   join skills s on s.id = si.skill_id
--   order by sc.display_name, s.sort_order;
