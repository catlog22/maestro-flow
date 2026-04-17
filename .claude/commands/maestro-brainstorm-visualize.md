---
name: maestro-brainstorm-visualize
description: Open a local HTTP server to browse HTML prototypes in the browser; selection happens via AskUserQuestion
argument-hint: "[--dir PATH] [--session WFS-ID] [--host HOST] [--url-host HOST] [--port PORT]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---
<purpose>
Start a local HTTP server that serves HTML prototypes from a directory so the user can open them in a browser. Selection is out-of-band: after the user reviews the pages, use `AskUserQuestion` to capture their choice.

The visualizer is optional — prototypes are already self-contained HTML files you can open directly. Use this command when the user wants a stable URL to browse multiple variants, or when your environment makes `file://` awkward.

Lifecycle is tracked by Maestro's delegate-broker primitives (detached spawn + PID tracking + status) on a **dedicated** broker state file, so visualizer jobs never appear in `maestro delegate show`.
</purpose>

<context>
$ARGUMENTS — flags only.

**Flags**:
- `--dir PATH`: Directory containing the `*.html` prototypes to serve (e.g. `.brainstorming/html-prototypes/`). Recommended.
- `--session ID`: Used only when `--dir` is absent — scopes an ephemeral serve dir under `.workflow/.brainstorm-visualize/<id>/`.
- `--host HOST`: Bind host (default `127.0.0.1`). Use `0.0.0.0` for remote/containerized setups.
- `--url-host HOST`: Hostname shown in the returned URL JSON. Useful when bind host ≠ what the browser reaches.
- `--port PORT`: Specific port. Default: random high port.
- `--owner-pid PID`: Auto-shutdown when this PID dies. Optional — omit to let the server live until `stop` or the 30m idle timeout. Do **not** pass the CLI's own PID (the CLI exits immediately).
</context>

<execution>

### Step 1 — Launch

```bash
maestro brainstorm-visualize start --dir <path-to-html-dir> [--port <port>]
```

Prints one JSON line to stdout:

```json
{"execId":"viz-193021-a7f2","serveDir":"...","logDir":"...",
 "type":"server-started","port":49501,"host":"127.0.0.1","url_host":"localhost",
 "url":"http://localhost:49501","screen_dir":"..."}
```

Save `execId` and `url`. Share the `url` with the user.

### Step 2 — Let the user browse

- `GET /` lists every `*.html` in `serveDir` as clickable links.
- `GET /screen/<name>.html` serves a single prototype, wrapped in a dark-theme frame (or passed through as-is if it's already a full `<!doctype>` document).
- Add / edit / remove files in `serveDir` — the next page reload will reflect them.

### Step 3 — Capture the decision

Once the user has reviewed the prototypes, use **AskUserQuestion** to record their choice. The visualizer itself does not capture clicks — Claude owns the question.

Example:

```
AskUserQuestion({
  question: "Which prototype would you like to proceed with?",
  options: ["A — 01-minimal.html", "B — 02-split-view.html", "C — 03-dashboard.html"]
})
```

### Step 4 — Status / resume

```bash
maestro brainstorm-visualize status <execId>
```

Includes `alive` (actual PID check), `status` (broker state), `url`, `serveDir`. If `alive: false` but you still need it, relaunch via Step 1.

### Step 5 — Shutdown

```bash
maestro brainstorm-visualize stop <execId>
```

Sends SIGTERM, waits 2s, escalates to SIGKILL, publishes `cancelled`. The `serveDir` is preserved (it holds the user's / agent's HTML — we never auto-delete it).

Safety net: the server also self-exits after 30 minutes of HTTP inactivity.

</execution>

<decision_criteria>

**Use this command when**:
- Multiple HTML prototypes exist and the user wants a stable URL to browse them
- `project_type` is `web` / `mobile` / `desktop-gui` and `file://` is awkward

**Skip when**:
- Only one prototype — just share the file path
- `project_type` is `cli` (ASCII) or `library` / `service` (API sketches) — no HTML to browse
- Running under `-y` / non-interactive — no user to ask

</decision_criteria>

<css_classes_reference>

Fragment files (not full documents) are wrapped in a frame providing these semantic classes:

| Class | Purpose |
|-------|---------|
| `.options` | Vertical A/B/C choices (each `.option` takes `data-choice="X"`) |
| `.cards` | Grid of cards (`data-choice="X"` for labeling) |
| `.mockup` / `.mockup-header` / `.mockup-body` | Bordered preview container |
| `.split` | Side-by-side comparison (two `.mockup` children) |
| `.pros-cons` / `.pros` / `.cons` | Tradeoff lists |
| `.mock-nav` / `.mock-sidebar` / `.mock-content` / `.mock-button` / `.mock-input` / `.placeholder` | Wireframe primitives |
| `.subtitle` / `.section` / `.label` | Typography helpers |

Full-document HTML (`<!doctype...`) is served as-is — use this when you need full control.

</css_classes_reference>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `maestro` not found on PATH | Install maestro or ensure npm bin dir is on PATH |
| E002 | error | Visualizer server script missing | Reinstall maestro (ships at `dist/src/brainstorm-visualize/server.js`) |
| E003 | error | Server did not emit `server-started` within 5s | Retry, or specify `--port` manually |
| W001 | warning | `status` reports `alive: false` | Server exited (idle timeout / external kill) — relaunch via `start` |
</error_codes>

<success_criteria>
- [ ] `start` returned an `execId` + URL, URL shared with the user
- [ ] User's choice captured via `AskUserQuestion`
- [ ] `stop <execId>` invoked when the server is no longer needed (or left to idle-timeout)
</success_criteria>
