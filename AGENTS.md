# AGENTS.md — HackAlem AI 2026

## Mission
Build the smallest convincing working product that solves the chosen task and can be demonstrated reliably under severe time pressure.

Optimize, in this order: working MVP, hourly demonstrable progress, meaningful AI/agentic value, reliability, clear GitHub history, then polish.

Do not optimize for feature count, elegant architecture, scalability, or abstraction when those threaten the demo.

## Hackathon constraints

This repository is being developed for HackAlem AI.

Codex MUST be actively used during development. All implementation work must stay in the team's GitHub repository. The participant is working solo unless the repository clearly says otherwise.

The current state must remain demonstrable near every required hourly checkpoint. Never fabricate progress, test results, compliance, or working features.

## Before coding

Inspect the relevant repository structure, package configuration, entry points, environment variables, and run/test commands. Read only documentation relevant to the current task; do not waste context scanning the entire repository.

Use the existing stack and conventions. Introduce a new framework, database, or major dependency only when it directly unlocks the MVP.

Identify the primary demo path before implementing secondary features. The default mental model is: input -> AI/agent processing -> useful result -> visible output.

## MVP rules

A feature is complete only when it works through the actual user-facing demo path. Backend code without an end-to-end path is not a completed feature.

Prefer the simplest implementation that works. Avoid speculative abstractions, premature optimization, unnecessary wrappers, and large refactors.

Do not rewrite working code just for style. Do not start optional features while the core path is broken.

Prioritize P0 required runtime, P1 core value, P2 reliability/judging clarity, P3 polish, P4 optional extras. Never sacrifice P0-P2 for P3-P4.

## AI / agentic implementation

AI must perform a meaningful part of the product's value, not exist as decoration.

Prefer explicit workflows with bounded tool use, structured inputs/outputs, validation, and clear failure handling. Do not add autonomous loops when a deterministic workflow is sufficient.

Prefer structured model outputs when downstream code depends on them. Validate model responses before using them in application logic.

Keep prompts and model configuration readable and centralized when practical. Do not send unnecessary context or secrets to a model.

Never claim accuracy, autonomy, real-time behavior, or production readiness beyond what has actually been implemented and tested.

## Time-boxing

Every task must have a time budget. If a task produces no useful progress for roughly 15–20 minutes, reduce scope, simplify the implementation, or switch to a fallback.

Never allow one bug, integration, or cosmetic detail to consume the next milestone's time.

When two approaches are viable, choose the one with the shorter path to a reliable demo.

## Hourly checkpoint protocol — HARD

Every hour there must be a visible, demonstrable increment. Documentation, refactoring, dependency installation, or a code-only change does not count unless it creates a directly demonstrable result.

Before each checkpoint, stop new feature work, make the current state runnable, verify the primary path, commit the working state, and prepare a one-sentence explanation of what changed and how to demonstrate it.

The target is to have the checkpoint result ready 5–10 minutes before the hour, not at the exact deadline.

Recommended five-hour progression:

Hour 1: project boots, task is understood, architecture skeleton exists, and the main path is identified.

Hour 2: end-to-end happy path works with the real or approved AI integration.

Hour 3: core value proposition is usable with representative input and a clear result UI.

Hour 4: reliability, validation, error handling, edge cases, and demo polish are addressed.

Hour 5: freeze features, fix critical bugs, rehearse from start to finish, verify submission, and leave a clean final repository.

If the official timing differs, preserve the same rule: finish something visibly demonstrable before every required hourly check.

## Git discipline

Work directly in the assigned team repository and keep meaningful progress visible in Git.

Make small milestone commits. Suitable examples are `feat: establish mvp flow`, `feat: connect ai workflow`, `feat: add result view`, `fix: handle model timeout`, and `chore: prepare demo`.

Do not keep the entire project as one final commit. Before each checkpoint, inspect Git status and commit the current working state.

Before final submission, verify the correct repository/branch, committed files, and absence of accidental secrets or irrelevant large files.

## Demo-first engineering

Treat the demo path as a first-class system. Provide representative sample inputs that produce useful output quickly.

Make loading, success, and failure states explicit. Avoid fragile flows with many clicks, hidden setup, manual code changes, or unnecessary external services.

When a live dependency is unreliable, use a legitimate cached/mock/fallback path when possible and label it honestly.

The final demo must be reproducible from a clean start, not just from the developer's current machine state.

## Debugging

When something fails, reproduce it, form a concrete hypothesis, isolate the smallest root cause, apply the smallest safe fix, and rerun the exact failing path.

After a fix, run the shortest relevant regression check. Do not hide failures by weakening tests, disabling validation, or deleting error handling.

If an integration is consuming too much time, implement the smallest viable fallback and continue toward the next checkpoint.

## Security

Never hard-code API keys, tokens, passwords, or private credentials. Never commit a secret-bearing `.env` file.

Use `.env.example` for required configuration. Do not print secrets in logs, screenshots, README files, or demo output.

## Documentation

Keep the README concise and practical. It must explain what the product does, the target user/problem, how AI/agents are used, how to run it, required environment variables, the primary demo flow, and known limitations/fallbacks.

Do not spend significant hackathon time writing theory while core functionality is incomplete.

## Agent behavior

Act as an execution-focused senior engineer. Do not spend the user's limited time explaining routine implementation details.

When an assumption is needed but does not materially threaten the submission, make the assumption, implement it, and document it briefly. Ask only when a missing detail blocks implementation or could invalidate the submission.

Do not wait for permission for routine repository inspection, coding, testing, debugging, or cleanup.

After each task, report: what changed, what was tested, what is demonstrable now, and what remains risky.

Near an hourly checkpoint, prioritize making the current build demonstrable over starting another feature.

## Final freeze

Stop feature development. Fix only release-blocking bugs.

Run the complete demo path from a clean start. Verify startup, required configuration, AI response, visible result, failure handling, README instructions, Git status, and absence of secrets.

Do not perform risky architectural changes after final rehearsal.

The final repository must be understandable, runnable, and demonstrable without improvisation.
