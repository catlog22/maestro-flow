# Maestro Dashboard

A real-time project dashboard for the Maestro workflow orchestration system. Runs at `http://127.0.0.1:3001`.

## Views

The `/workflow` page provides four views:

| View | Shortcut | Description |
|------|----------|-------------|
| **Board** | `1` | Kanban-style pipeline with 6 status columns |
| **Timeline** | `2` | Phase timeline with Gantt-style progress |
| **Center** | `3` | Command Center — active execution panel, quality status, agent logs |
| **Table** | `4` | Tabular phase list with all metadata |

## Phase Status ↔ Command Reference

Each phase moves through a lifecycle of statuses. The **ActiveExecutionPanel** (in the Center view) shows the recommended command for the current phase.

| Status | Display Label | Recommended Command | Notes |
|--------|--------------|---------------------|-------|
| `pending` | Pending | `/maestro-analyze {N}` | Start phase exploration |
| `exploring` | Explore | `/maestro-plan {N}` | Exploration in progress — run plan next |
| `planning` | Plan | `/maestro-execute {N}` | Execution plan ready |
| `executing` | Execute | *(running)* | Phase actively executing |
| `verifying` | Verify | `/quality-review {N}` | Goal-backward verification |
| `testing` | Test | `/quality-test {N}` | UAT + integration tests |
| `completed` | Done | `/maestro-phase-transition` | Advance to next phase |
| `blocked` | Blocked | `/quality-debug` | Debug and unblock |

> **Note on naming**: The `exploring` status is *entered by* running `/maestro-analyze` on a `pending` phase. Once a phase is in `exploring` state, the next action is `/maestro-plan` — hence the table above. The label "explore" describes the phase state; "analyze" was the command that initiated it.

## Pre-Pipeline Commands

Before any phases exist, run these setup commands in order:

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `/maestro-init` | Initialize project workspace (`.workflow/` directory, `state.json`, `project.md`) |
| 2 | `/maestro-brainstorm` *(optional)* | Multi-role brainstorming session for idea refinement |
| 3a | `/maestro-roadmap` | Create a lightweight phase roadmap interactively |
| 3b | `/maestro-spec-generate` | Full spec pipeline (PRD → architecture → roadmap) |
| 4 | `/maestro-ui-design` *(optional)* | Generate UI design prototypes |
| 5 | `/maestro-plan 1` | Create execution plan for Phase 1 |

After `/maestro-plan 1`, the dashboard will show your first phase in `planning` status and the full pipeline becomes visible.

## Development Setup

```bash
cd dashboard
npm install
npm run dev        # Starts Vite dev server + Hono API server on port 3001
```

### Build

```bash
npm run build      # TypeScript compile + Vite build
npm start          # Start production server
```

## Architecture

```
dashboard/
├── src/
│   ├── client/           # React frontend (Vite)
│   │   ├── components/   # UI components
│   │   │   └── workflow/ # Workflow-specific components
│   │   ├── pages/        # Page-level components (WorkflowPage, etc.)
│   │   ├── store/        # Zustand state (board-store)
│   │   └── hooks/        # Custom React hooks
│   ├── server/           # Hono API server
│   │   └── state/        # StateManager — reads .workflow/ files
│   └── shared/           # Shared types and constants
│       ├── types.ts       # PhaseCard, BoardState, PhaseStatus, etc.
│       └── constants.ts   # STATUS_COLORS, API endpoints, etc.
```

The server's `StateManager` reads `.workflow/state.json` and `.workflow/phases/*/index.json` to assemble the `BoardState` pushed to the client via Server-Sent Events (SSE).
