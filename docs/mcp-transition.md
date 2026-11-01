# MCP Transition — living design doc

> Purpose: plan turning **custom-ide** into an app that AI agents can drive (and
> that can drive agents) via the **Model Context Protocol (MCP)**. This is a big,
> multi-stage change; this file is the single source of truth for it and will
> grow stage by stage. Nothing here is built yet.

Status: **Stage 1 — understand the technology and decide scope.** No code.

---

## Stage 1 · Part A — What MCP actually is (plain language)

**The problem MCP solves.** Before MCP, every AI app that wanted to use a tool
(a database, GitHub, a filesystem) had to hand-write a custom integration, and
every tool had to be re-integrated for every AI app. That's an M×N explosion of
brittle, one-off adapters, each inventing its own auth and data handling. MCP
turns M×N into **M+N**: you build a *server* for your tool once, and any
MCP-compatible AI app can use it. The common analogy is **"USB-C for AI"** — one
standard port instead of a different connector per device.

**Under the hood** MCP is just **JSON-RPC 2.0** messages (request/response +
one-way notifications) sent over a transport. There's nothing magic: it's a
disciplined, standardized way for an AI application and a capability provider to
talk. The value is the *standard*, not the wire format.

**The three roles.** MCP has a clean separation:

- **Host** — the AI application the user interacts with (Claude Desktop, Claude
  Code, Cursor, VS Code, ChatGPT, or *our app if we embed an agent*). It owns the
  LLM and, crucially, **owns security and user consent**.
- **Client** — lives inside the host; one client per connected server; manages
  that one connection, discovers what the server offers, and invokes it.
- **Server** — exposes capabilities (our app, or GitHub, Postgres, etc.). Can be
  local (same machine) or remote (a service over HTTPS).

So "adding MCP support" is really **two independent decisions**: do we want to be
a **server** (expose our functions so agents can use them), a **host** (run an
agent inside our app that uses tools), or both? (See Part D.)

---

## Stage 1 · Part B — The primitives (the vocabulary of MCP)

A server exposes up to **three** capability types; a client can optionally offer
**three** back. Everything we'd build maps onto these.

### Server-side (what our app would expose)
- **Tools** — functions the *model* can call to take an action (read a file,
  write a file, run git, create a task). Each has a name, description, and a
  **JSON Schema** for its inputs. Model-controlled, like function calling — the
  host normally asks the user to approve a call.
- **Resources** — **read-only data** the model consumes as context, addressed by
  URI (e.g. `file:///project/Hub.md`, `git://graph`). App/user-controlled: the
  model reads them on demand instead of us stuffing everything into a prompt.
- **Prompts** — reusable, parameterized templates surfaced to the *user* (think
  slash-commands / workflows, e.g. "/scaffool-project", "/plan-feature").

### Client-side (what a host offers a server) — *note the 2026 shift*
- **Sampling** — the server asks the host's model to generate text on its behalf
  (enables recursive/agentic workflows without the server holding its own API key).
- **Roots** — the host tells the server which filesystem paths/URIs it may touch
  (a scoping mechanism).
- **Elicitation** — the server asks the host to collect **structured user input**
  mid-flow (e.g. "confirm this destructive action", "enter a value") — a clean
  human-in-the-loop primitive.

> **Important currency note (as of the 2026-07-28 spec revision):** the protocol
> is going **stateless**, and **Roots, Sampling, and Logging are deprecated**
> (they keep working for ~12 months but new builds shouldn't adopt them; they're
> being redesigned). **Elicitation stays.** The legacy HTTP+SSE transport is also
> deprecated. Practical implication for us: lean on **tools + resources +
> prompts + elicitation**, and **enforce path-scoping ourselves in the server**
> rather than relying on Roots.

---

## Stage 1 · Part C — Transports (how the bytes travel)

Two that matter:

- **stdio** — the server runs as a **local subprocess** the host spawns and talks
  to over stdin/stdout. This is how Claude Desktop/Code run local servers today.
  Great for a small companion binary; awkward for a *persistent GUI app* (our app
  isn't naturally a subprocess of anything).
- **Streamable HTTP** — the server is an **HTTP endpoint** (local loopback port or
  remote). Recommended for anything long-lived or multi-client; the newest spec
  makes it stateless so it scales behind a load balancer. (The old SSE transport
  is deprecated.)

**For a running Electron GUI, the natural fit is a local Streamable HTTP server**
in our **main process**, bound to `127.0.0.1`, that (a) our own embedded agent can
call in-process and (b) external hosts can connect to. We could *also* ship a
thin **stdio companion** so tools like Claude Desktop/Code can spawn us the way
they expect. (Decision needed — Part G, Q4.)

**SDK:** the official `@modelcontextprotocol/sdk` (TypeScript) gives us
`McpServer` + transports so we don't hand-roll JSON-RPC. It's the most-used SDK in
the ecosystem, which matters for compatibility.

---

## Stage 1 · Part D — The two ways *our* app can participate

This is the central fork. The user's goal ("agents access files, gather
knowledge, plan, implement, report; agents use app functions for development")
touches both, but they're built separately and in order.

### Role A — App as **MCP server** ("our app is *used by* agents")
We expose custom-ide's capabilities as **tools + resources + prompts**. Then:
- **External** hosts (Claude Desktop, Claude Code, Cursor…) connect and drive the
  live app — with **zero LLM cost or key management on our side**.
- Our **own** embedded agent (Role B) can reuse the exact same server in-process.

This is the **foundation** and the recommended first build.

### Role B — App as **MCP host** ("our app *runs* an agent that uses tools")
We embed an agent loop inside the app: it plans, calls tools (ours + external
servers like a GitHub MCP), observes results, and reports. This is the "AI does
development inside the app" experience. It **requires more**: an LLM provider +
API key, an agent/orchestration loop, an agent-activity UI, and a stronger
approval/permission story.

### Recommendation
**Build Role A first (server), then Role B (host).** Reasons: the server is the
substrate both roles need; it delivers value immediately (any external agent can
use it); and it lets us prove the security model before we hand an autonomous
in-app agent the keys.

---

## Stage 1 · Part E — Why custom-ide is unusually well-suited

Two existing assets make this a strong fit rather than a bolt-on:

1. **The typed IPC contract is already a function catalog.** Every capability the
   app has (`fs-service`, `projects`, `git`, `hub`/`repair`, `templates`,
   `pipeline`, `notifications`, `trackers`) is already a typed request in
   `RequestMap` in `src/shared/ipc.ts`. Mapping those to MCP **tools** is close to
   mechanical — the schemas and the safety boundary (all I/O already goes through
   the main process, never the renderer) are already there.

2. **The PM / "coordination files" layer is a ready-made agent workspace.** Note
   the project config is literally named **`big-mcp.config.json`** — the app was
   named as if this day was coming. The coordination surface maps 1:1 onto the
   agent workflow the user described:

   | Agent verb        | Existing app surface                                             | MCP primitive |
   |-------------------|------------------------------------------------------------------|---------------|
   | **access files**  | fs read/write/list (main), project-scoped                        | tools + resources |
   | **gather knowledge** | Hub docs, README, architecture, `big-mcp.config.json`, `big-state.json`, git graph | resources + read tools |
   | **plan**          | Pipeline tasks in `big-state.json`, task stages                  | tools (+ prompts) |
   | **implement**     | write files, scaffold/apply template, git (needs write ops)      | tools |
   | **report**        | **notifications/toasts**, Hub `pm:` generated sections, task-stage moves | tools + notifications |

   In short: **the Hub + config + tasks are the agent's shared memory/plan/report,
   and the notification system is its reporting channel.** That's the thesis of
   this whole transition.

---

## Stage 1 · Part F — Security & safety (the hard part)

This deserves the most care because our app is **deliberately locked down** today:
the renderer has zero filesystem/OS access, everything crosses a typed IPC
boundary in the main process, the CSP is strict, and template/file ops assert
they stay inside allowed roots. **Exposing tools to an agent removes the implicit
human-in-the-loop that the GUI provided.** The industry reality: 30+ MCP-related
CVEs were disclosed in early 2026 (including a critical RCE in a popular remote
shim). Security in MCP **lives in the host** — consent, credential scope, per-tool
allow-listing — so if we're the host we own it, and if we're the server we still
must not trust callers.

What we'll need (details firm up in later stages):
- **Path scoping** — every fs tool restricted to the open project root, reusing
  the existing `assertInside…` pattern generalized to `assertInsideProject`.
- **Read vs write gating** — read tools can auto-allow; **writes / git-commit /
  delete require explicit approval** (via **elicitation**), at least until trusted.
- **Consent model** — per-call approval, or a per-session "trust with audit +
  kill-switch". (Decision — Q6.)
- **Audit log** — every tool call recorded (what/when/args/result), surfaced in
  the app (ties naturally into notifications).
- **Loopback + token** — if we serve HTTP, bind `127.0.0.1` only and require a
  local token; **OAuth 2.1** only if ever exposed beyond localhost.
- **Prompt-injection awareness** — file/repo contents an agent reads can contain
  hostile instructions ("tool poisoning"); the plan must assume untrusted inputs.
- **Secret isolation** — the GitHub token (in `safeStorage`) and any LLM key must
  never be readable via a tool.
- **Global pause / rate limits** — a one-click "stop the agent" and per-session caps.

---

## Stage 1 · Part G — Open questions (decisions needed to start Stage 2)

1. **Which role first?** Expose the app to external agents (**server**), embed an
   agent (**host**), or both? *(Recommendation: server first, host later.)*
2. **Who drives it?** External hosts (Claude Desktop/Code/Cursor) connecting in,
   an in-app agent, or both?
3. **If in-app agent:** which LLM provider(s) (Anthropic / OpenAI / local model),
   and do we use a **bring-your-own-key** model like the existing GitHub OAuth flow
   (key in `safeStorage`)?
4. **Transport:** local **Streamable HTTP** on loopback (fits a persistent GUI),
   a **stdio companion** binary for hosts that expect to spawn a subprocess, or
   both? *(Recommendation: loopback HTTP now, optional stdio companion later.)*
5. **Initial capability scope:** start read-only (files + coordination docs +
   git graph), or include writes (file edits, task/plan changes, git commit) from
   the start? What is explicitly **off-limits** (account tokens, delete, network)?
6. **Approval model:** approve every write, or per-session trust + audit +
   kill-switch? How fine-grained should human-in-the-loop be?
7. **PM-layer access:** should agents only *read* the plan/tasks, or also
   *create/modify* tasks and *write reports* into Hub/pipeline generated sections?
8. **Concurrency:** one agent/session per open project, or many at once?
   (Affects the session + locking model.)
9. **Config home:** should MCP server settings live inside `big-mcp.config.json`
   (per-project) or in app settings (per-machine)? Was the "mcp" in that filename
   an intentional anticipation of this?

---

## Proposed staging roadmap (subject to the answers above)

- **Stage 1 — Understand & decide.** ← *this document.* No code.
- **Stage 2 — Read-only server.** Stand up an MCP server (Streamable HTTP,
  loopback) exposing **resources** (project files, coordination docs, git graph)
  and **safe read tools**; verify with the **MCP Inspector** and Claude Desktop.
  Establishes transport, schema generation from `RequestMap`, and path-scoping.
- **Stage 3 — Write tools + permissions.** File writes, task/plan updates, git
  commit — each behind the **approval + audit + elicitation** layer and a
  kill-switch.
- **Stage 4 — Embedded agent (host).** LLM provider + key, the agent loop
  (access→gather→plan→implement→report), and an **agent-activity UI**, reusing the
  Stage-2/3 server in-process.
- **Stage 5 — Hardening & polish.** External exposure/auth, rate limits, prompts
  & workflow templates, and (optionally) an **MCP Apps** interactive surface.

---

## Glossary (quick reference)

- **MCP** — Model Context Protocol; open JSON-RPC standard from Anthropic (late
  2024) for connecting LLM apps to tools/data.
- **Host / Client / Server** — the AI app / its per-server connector / the
  capability provider.
- **Tool / Resource / Prompt** — action / read-only data / reusable template.
- **Sampling / Roots / Elicitation** — client-side capabilities (server asks host
  to: run the model / know allowed paths / collect user input). *Roots & sampling
  deprecated in the 2026-07-28 spec; elicitation retained.*
- **stdio / Streamable HTTP** — local-subprocess transport / HTTP transport
  (SSE is deprecated).
- **MCP Inspector** — official tool to connect to and exercise a server manually.
- **SDK** — `@modelcontextprotocol/sdk` (TypeScript) — `McpServer` + transports.

## Stage 1 · Part H — Architecture decided (from review)

- **Agents are external CLI agents** (Claude Code, Codex, …). The app does **not**
  embed an LLM/agent — we build **only the server role** (no agent loop, no LLM key).
- **The MCP server is a coordination hub** multiple agents connect to, with a
  **human on overwatch** → **loopback Streamable-HTTP, multi-client** (not stdio 1:1).
- **Our app is the overwatch cockpit** — accept changes, correct mistakes, write
  **PBIs** (Product Backlog Items), and **manage the MCP server**.
- **Templated coordination files are the agents' documentation** (context, PBIs,
  architecture), exposed as **resources**.
- **Approval = the Pipeline task-state machine**: some states are **human gates**;
  an agent can move a task *into* a gate but the human confirms to proceed.
- **Read-only first**, then code tools (`find_function`, `change_function`).
- **Secondary goal: token savings** — tools return **precise, minimal** results
  (e.g. `find_function` returns just that function, not the whole file).

Hooks already present: `PipelineTask` has an **`agent`** field and
`review`/`approval`/`qa` stages (natural gates); all file I/O is already behind the
typed main-process boundary; coordination docs + `big-mcp.config.json` +
`big-state.json` already exist.

## Stage 1 · Part I — Impact analysis (what changes). [NEW]/[MOD]/[REUSE]

1. **MCP server subsystem — [NEW]** `src/main/mcp/`; `@modelcontextprotocol/sdk`;
   loopback Streamable-HTTP in main; multi-client; start/stop/status controlled
   from the app; map `RequestMap` → resources/tools.
2. **Resource layer (agent docs) — [MOD/REUSE]** providers exposing coordination
   files + config/state + git graph as read-only resources (reuse hub/repair path
   resolution); templates gain a context doc + PBI structure.
3. **PBIs — [NEW]** data model the human authors + agents read; relation to
   pipeline tasks TBD; small authoring UI.
4. **Pipeline = approval-gate machine — [MOD]** add explicit human-gate flag to
   stages; tools let agents move a task *into* (not past) a gate; overwatch surfaces
   "awaiting approval"; ties `big-state.json` to the tool surface.
5. **Overwatch UI — [NEW/MOD]** MCP server panel (start/stop, port, connected
   agents, activity/audit log); change/diff review (git); PBI authoring; agent
   events → notifications.
6. **Code-intelligence for token-saving tools — [NEW]** symbol/AST awareness
   (tree-sitter or LSP) for `find_function`/`get_outline` (read) then
   `change_function` (write) — the largest new subsystem, heart of token savings.
7. **Security/permissions — [NEW]** generalize `assertInside…` → `assertInsideProject`;
   read-only first; loopback + token; audit log → notifications; global kill switch.
8. **Config/settings — [MOD]** MCP server settings per-project in
   `big-mcp.config.json` + app defaults; which files are "documentation" resources.
9. **IPC contract — [MOD]** channels for server control / PBI CRUD / gate confirm;
   events (agent connected, tool called, task submitted) → renderer.

Read-only Stage 2 ≈ items 1,2,7,8,9 + minimal server panel; code-intel reads = 2b;
writes = Stage 3 behind pipeline gates.

## Stage 1 · Part J — New questions

10. PBI model & storage (in `big-state.json` / markdown / new file?) and PBI↔task
    relationship.
11. Code intelligence: tree-sitter vs LSP vs heuristic? which languages first?
12. Server lifecycle: per-project vs one global scoped to current project; auto vs
    manual start.
13. Agent connection UX: do we generate the config snippet (URL+token) for the user?
14. Multi-agent coordination: is the task `agent`/ownership the write-conflict lock?
15. Which stages are gates (confirm `review`/`approval`, others?).

---

## Stage 2 · Feature set (brainstorm — no code yet)

Four linked pieces: a **bare-bones MCP server**, an **Agent Configurations**
Overview section, and two skeleton views — **Logs** (server/agent activity) and
**Tools** (exposed tools, TODO).

### 1. Bare-bones MCP server
Minimum plumbing: `@modelcontextprotocol/sdk`, loopback Streamable-HTTP in main,
start/stop/status, stable local **port + token**. No real tools yet (maybe a
`ping`/server-info) — a reachable, registerable server to build on.

### 2. Logs view (skeleton) — new activity-bar view: left/right pane + header
(title + settings hamburger) + a new **Logs** settings section. Content TODO.

### 3. Tools view (skeleton, TODO) — new activity-bar view: left/right pane +
header (title + settings hamburger) + a new **Tools** settings section.

### 4. Agent Configurations (new Overview section)
Find local AI agents and register *this project* into their MCP config. Initial
set: **Claude Code, Codex, Claude Desktop**.

Where each agent stores MCP config (verified Aug 2026):

| Agent | Config file | Format |
|-------|-------------|--------|
| Claude Code | `.mcp.json` (repo root, project scope) or `~/.claude.json` (local/user) | JSON `mcpServers` |
| Codex CLI | `~/.codex/config.toml` (win `%USERPROFILE%\.codex\config.toml`; `CODEX_HOME` relocates) | TOML `[mcp_servers.<name>]` |
| Claude Desktop | mac `~/Library/Application Support/Claude/claude_desktop_config.json`; win `%APPDATA%\Claude\…`; linux `~/.config/Claude/…` | JSON `mcpServers` (read at startup → restart) |

**"Register" = write an entry for our loopback server** (URL + token, tied to this
project) into the agent's config. Claude Code can use in-repo `.mcp.json` (clean);
Codex/Claude Desktop are home-dir global configs (outside project scope).

**Health (per agent):**
- **active** (green): entry present, points to *this* project → button **Unregister** (confirm).
- **mismatch** (amber): entry present, wrong target (other path / stale port/token) → **Fix** (confirm).
- **missing** (red): agent present, no entry / config not found → **Register**; row grayed/disabled.
- **not found**: agent not installed → row shows "Not found".

**Row:** left = name · `Project: {none/our path/other path}` · `Config: {path}` (or
"Not found"). Right = health text + colored icon + state button beneath. Actions
**toast**; **health-change toasts**; **mismatch/missing → notification** (hover hint
explains; mismatch gives the specific problem).

**Header:** title "Agent configurations" (hover hint "Register this project root
path in the configuration files of your local AI agent") · **Register detected
configs** (scan + register found) · **Refresh** (re-scan/re-health). Both toast.

**Tracking:** section right-click → track number of **agents / missing / active /
mismatch**; row right-click → track **that agent's health status** (new `agent.*`
trackables + agent data in tracker context).

**Cross-cutting:** editing Codex/Claude-Desktop configs writes files in the
**home dir, outside the project** (scope expansion → dedicated permission +
confirmations); detection = known config paths per-OS + binary on PATH; **staleness**
(port/token change → mismatch, argues for a stable port + token file); Claude Desktop
needs a **restart** after edits; exact register payload (URL/token/scope, `.mcp.json`
vs `~/.claude.json`) to be pinned down; health recomputed on Refresh (optional watch
for external edits to fire health-change toasts).

*(Stage 2 build order TBD; this captures the target feature set.)*

