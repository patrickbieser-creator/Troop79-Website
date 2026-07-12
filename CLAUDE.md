# Troop79-Website — Project CLAUDE.md

# This file goes in {project}/CLAUDE.md and is loaded alongside ~/.claude/CLAUDE.md.
# It defines project-specific context. Global agents (tech-lead, qa-lead, ux-lead,
# nws-brand-manager) are defined in ~/.claude/agents/ — do NOT duplicate them here.
# Disciplines are imported below — they define the rules and standards for this project.

---

@~/.claude/agents/disciplines/development.md

@PROJECT.user.md

---

<project_context>
  <name>Troop79-Website</name>
  <codename>troop79</codename>
  <framework>Next.js 16 + Supabase</framework>
  <type>Nonprofit / Community Website</type>
  <purpose>Family website for Scouts BSA Troop 79 (Milwaukee, WI) — advancement tracking, event calendar, fast entry ledger, and a homegrown news CMS for ~30 scouts, 25 families, and 10 leaders.</purpose>
</project_context>

---

## Build Commands

```bash
cd next-app && npm run build        # Build the production app
npm run lint                        # Closest quality gate — no test suite configured yet
cd next-app && npm run dev          # Run locally
```

---

## Project Structure

```
Troop79-Website/
├── CLAUDE.md                    # This file
├── .claude/agents/              # Project subagent definitions
│   └── troop79-specialist.md    # Only project subagent
├── Agents/                      # Agent memory and knowledge
│   ├── Architect/               # Memory only — Tech-Lead reads directly
│   ├── Tracker/                 # Memory only — Operator reads directly
│   ├── Specialist/              # Subagent — has IDENTITY.md
│   └── Brand/                   # Memory only — UX-Lead reads directly
├── next-app/                    # Production Next.js 16 + Supabase app
├── prototypes/                  # Static HTML prototypes (design reference)
├── admin/, assets/, data/       # Legacy static site (index.html, calendar.html, etc.)
└── docs/
```

---

## Project-Specific Constraints

<constraints>
  <!-- Inherit global constraints (security, TDD, quality gates) from ~/.claude/CLAUDE.md -->
  <!-- Add only project-specific rules below -->
  <constraint>Personal/family project, not a client engagement — client-id "personal" in the shared Project-Agents repo.</constraint>
  <constraint>No automated test suite is configured yet in next-app/. Rely on `npm run lint` + `npm run build` (typecheck) as the quality gate until tests exist.</constraint>
  <constraint>next-app/CLAUDE.md and next-app/AGENTS.md carry additional Next.js-16-specific API/convention warnings — read them before touching next-app/ code.</constraint>
</constraints>

---

## Agent Knowledge Architecture

Each agent has three layers of knowledge with distinct ownership:

| Layer | File | Applies To | Survives Upgrade |
|-------|------|------------|-----------------|
| **Core** | `IDENTITY.md` | Specialist only | Overwritten |
| **Team** | `KNOWLEDGE.md` | All agent dirs | Preserved |
| **Personal** | `PROJECT.user.md` | Project-wide | Not in source control |
| **Session** | `Memory/*.md` | All agent dirs | Preserved |

- **IDENTITY.md** — Specialist's core definition. Shipped by the plugin, overwritten on upgrade. Architect, Tracker, and Brand have no IDENTITY.md.
- **KNOWLEDGE.md** — What the TEAM has taught the agent. Checked into source control. Shared across all developers.
- **PROJECT.user.md** — YOUR personal preferences for this project. Not in source control. Each developer has their own.
- **Memory/*.md** — What the agent has LEARNED. Written at runtime.

### Training Mode

By default, teaching an agent writes to `KNOWLEDGE.md` (local). To modify core identity for redistribution:

- "Update [agent-name] core info" or "Train [agent-name] for redistribution"

In training mode, changes write to `IDENTITY.md` instead.

---

## Project Subagent

One project-level subagent, defined in `.claude/agents/`.

### troop79-specialist (sonnet)
Domain expert. Consulted before changes to business logic, data model, API, integrations, or dependency-sensitive operations.
- **Memory:** `Agents/Specialist/Memory/` (DOMAIN.md, API.md, INTEGRATIONS.md, STATUS.md, KNOWN_ISSUES.md)

## Memory-Only Directories

These directories are read directly by global agents — no subagent is spawned.

### Architect — Tech-Lead reads directly
Codebase structure, patterns, and architectural decisions.
- **Memory:** `Agents/Architect/Memory/` (ARCHITECTURE.md, PATTERNS.md, DECISIONS.md)

### Tracker — Operator reads directly
Sprint state, blockers, and backlog.
- **Memory:** `Agents/Tracker/Memory/` (STATE.md, BLOCKERS.md, BACKLOG.md)

### Brand — UX-Lead reads directly
Project/client brand guidelines: colors, typography, voice, component patterns.
- **Memory:** `Agents/Brand/Memory/` (BRAND.md, AUDIT.md)

---

## Coordination: Global ↔ Project

| Question | Who Answers |
|----------|-------------|
| "Should we build this? Does it fit this codebase?" | Global **tech-lead** (reads Architect memory directly) |
| "Is this secure/stable/tested?" | Global **qa-lead** |
| "Is this usable/accessible? Does it match brand?" | Global **ux-lead** (reads Brand/ memory directly) |
| "Does this match Northwoods brand?" | Global **nws-brand-manager** (only if a deliverable is explicitly NWS-branded) |
| "What's the current state?" | Operator reads `Agents/Tracker/Memory/` directly |
| "How does the domain work? Are deps healthy?" | **troop79-specialist** |

### Conflict Resolution

1. **Tech-Lead defers to Architect memory** on project-specific patterns (the memory explains why a pattern exists here)
2. **QA-Lead overrides everyone** on security (non-negotiable)
3. **QA-Lead overrides everyone** on test coverage (quality gates are universal)
4. **Escalate to Patrick Bieser** if two agents with veto power conflict

---

## Session Protocol

**At the start of every new context window — before responding to the first user message — automatically invoke `/northwoods:start-session` unless it has already been invoked in this context window.**

Skip auto-invoke only if:
- You are mid-task and the user explicitly asked you not to interrupt
- `.claude-project` does not exist in this directory or any ancestor (project not yet initialized)

**Before closing the session, run `/northwoods:end-session`** to write memory updates, sync agent files, and generate a session summary.

**Project switching detection:**
When a `FILE_OUTSIDE_PROJECT_ROOT` message arrives from the PreToolUse hook:
1. Walk up from the target file's directory looking for `.claude-project`
2. If found and it belongs to a different project, prompt:
   ```
   You appear to be working in a different project ({found-project}).
   Recommend running end-session before switching. Run end-session now? (yes/no)
   ```
   - Yes → run `/northwoods:end-session` (current project), then `/northwoods:start-session` in the new location
   - No → continue in current session context
3. If no `.claude-project` found → allow the file op silently

1. **Read `Agents/Tracker/Memory/STATE.md`** — understand current sprint position and test baseline
2. **Read `Agents/Tracker/Memory/BLOCKERS.md`** — know what's blocked before planning work
3. **Skim `Agents/Architect/Memory/DECISIONS.md`** — if the session involves structural changes
4. **After work:** Update `Agents/Tracker/Memory/STATE.md` (always) and relevant Specialist/Architect memory if decisions were made or domain knowledge was learned

---

## Version Control

The following files must NOT be committed to source control:
- `PROJECT.user.md` — individual developer preferences (created per-user, not shared)
- `.claude/settings.local.json` — Claude Code local settings override
- `.claude/agents/` — project subagent definitions (stored in shared `Project-Agents` repo)
- `.claude-project` — project agent marker (per-machine)
- `Agents/` — agent memory files (stored in shared `Project-Agents` repo, synced by `start-session`)

These are added to `.gitignore` by `start-session`. Agent files live in `Northwoods-Software-Development/Project-Agents` under `personal/troop79/` and are synced to this directory by `/northwoods:start-session`.
