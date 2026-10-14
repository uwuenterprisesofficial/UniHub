# UniHub

Academic workspace built from `specs.MD`: dashboard, modules, calendar, tasks, documents, notes, flashcards/exam prep, thesis workspace. Server-first with live sync across devices.

**Stack:** Vite · React 18 · TypeScript (strict) · React Router · Zustand · Dexie (IndexedDB) — server: Hono · Node `node:sqlite` · Zod · tsx

```bash
npm install
npm run dev:all    # web on :5173 (proxies /api) + API on :8787
npm run typecheck  # client + server
```

Production: `npm run build && npm start` — one Node process serves the app and the API (default port 8787, set `PORT`).
Data lives in `./server-data` (override with `UNIHUB_DATA`); back it up like any SQLite file plus the `files/` folder. Requires Node 22.5+ (built-in SQLite). Put it behind HTTPS (reverse proxy) when exposing it beyond localhost.

## How sync works (server-first, live)
UniHub is **not** local-first: your workspace lives in your account on the server, and this browser only holds a working copy in memory.
- You must sign in. After sign-in the app opens once your data has arrived; nothing from the workspace is stored in the browser (only the sign-in token, your AI keys and the derived search index). Signing out removes the workspace from the device. A bar and the sidebar badge show connection state; if the connection drops, unsaved changes are kept in the open tab and sent on reconnect (the browser warns before you close a tab with unsent changes).
- Every change is sent within ~150 ms (`POST /api/sync`). The server keeps one event stream per open device (`GET /api/events`, server-sent events) and announces each save, so other devices pull it immediately — no polling, typically well under a second. A 20 s safety poll and reconnect-with-backoff cover dropped connections.
- Accounts: email + password (scrypt hashed); the client keeps a 30-day bearer session token. Every record carries a last-modified time; deletes are kept as tombstones; conflicts resolve per record, newest edit wins.
- Uploaded documents are sent **before** the record that references them (`/api/files/:key`, 100 MB max each) and downloaded on demand on other devices.
- Data a previous (local-first) version left in the browser is offered for one-time import after you sign in.

## Reader, glossary, quotes and knowledge base
- PDF (pdf.js), Word (.docx, mammoth), Markdown and text files are converted to text on import. Text is kept in IndexedDB and re-extracted on other devices, so annotations anchor to character offsets of that text.
- Select text in the reader to highlight it, add a note, mark it as a glossary term, or save it as a quote. Summaries, key facts, glossary suggestions and quote suggestions come from a local extractive analyser (`src/lib/nlp.ts`): it ranks and selects the document's own sentences and never generates text. No data leaves the device for this.
- The knowledge base (`src/lib/kb.ts`) indexes documents, notes, annotations, quotes, glossary, flashcards, tasks, thesis material and modules, ranks passages with BM25 and expands queries with glossary aliases and related terms.

## Semantic index, RAG and knowledge graph
- **Vector index** (`src/lib/embed.ts`): passages of the knowledge index are embedded either on-device (`@huggingface/transformers` in a worker; ONNX runtime served from `/ort`, model weights downloaded once from Hugging Face and cached) or with an OpenAI-compatible `/embeddings` endpoint of your provider. Vectors live in IndexedDB (`vectors` table), are keyed by a content hash so only changed passages are re-embedded, and are never synced.
- **RAG** (`src/lib/rag.ts`): keyword (BM25) + vector ranking fused with reciprocal rank fusion → near-duplicate/per-document limits → neighbouring paragraphs and graph neighbours → numbered, budgeted context → answer with `[n]` citations → citation check (uncited/invalid references are flagged). Follow-up questions are rewritten into standalone queries.
- **Knowledge graph** (`src/lib/graph.ts`, `/graph`): modules, documents, notes, glossary concepts, quotes, annotations, tasks, thesis chapters/sources and flashcards, linked by typed edges (mentions, related, defines, cites, links to, similar, …). Document similarity comes from the vectors (or shared concepts when no index exists).

## Automation and offline
- **Deadlines** (`src/lib/deadlines.ts`): the reader's *Dates* tab lists upcoming deadlines/exam dates found in a document (ISO, `12.11.2026`, `2 November 2026`, `March 2, 2026`; EN + DE cue words) with the source sentence; one click creates a task (linked to the document) or a calendar exam.
- **Weekly planner** (`src/lib/planner.ts`): *Tasks → Plan my week* places open tasks with an estimate into free calendar slots, earliest deadline first, within your daily study capacity, and warns when a deadline cannot be met. Sessions are only created after confirmation and are tagged so re-planning does not double count them.
- **Installable** (the app shell loads offline, but your data needs the server) (`public/sw.js`, `manifest.webmanifest`): production builds register a service worker (page: network-first with offline fallback; assets, OCR and ONNX files: cache-first; `/api` never cached). Browsers offer "Install app".

## Tests
`npm test` runs 87 tests (Vitest): language analysis, deadline detection, the planner, recurrence/ICS, bibliography and citation formats, knowledge index/graph/retrieval, re-anchoring, AI quote verification, and an end-to-end suite that starts the real server and runs the client sync engine as two devices (accounts, rate limits, conflict resolution, tombstones, files, size limits).

## Self-hosting with Docker
```bash
docker compose up -d        # http://localhost:8787 — app + API in one container
```
Data (SQLite database and uploaded files) lives in the `unihub-data` volume (`/data`); back it up like any volume. The container runs plain Node 24 (built-in SQLite, no build step for the server). Put it behind an HTTPS reverse proxy (Caddy, nginx, Traefik) before exposing it to the internet; the service worker and sign-in need HTTPS outside localhost.

## Password reset and email
"Forgot password?" in Settings → Account sends a single-use link that is valid for one hour; using it signs the account out everywhere. Requests are rate-limited and always get the same answer, so accounts cannot be probed.

Outgoing mail uses any SMTP server (set these environment variables):

| Variable | Meaning |
|---|---|
| `SMTP_URL` | e.g. `smtps://user:pass@smtp.example.com:465` — or use the four below |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` for port 465), `SMTP_USER`, `SMTP_PASS` | alternative to `SMTP_URL` |
| `SMTP_FROM` | sender, e.g. `UniHub <no-reply@example.com>` |
| `PUBLIC_URL` | address users open, e.g. `https://unihub.example.com` (used in the link) |

Without SMTP the reset link is printed in the server log instead (`docker logs …`), so the person running the server can pass it on. In `docker-compose.yml` add the variables under `environment:`.

## Calendar subscriptions
*Calendar → Subscriptions* keeps a Google, Outlook or university calendar up to date (read-only), using the calendar's private iCal address — no OAuth app or API key needed. Feeds refresh every ~6 hours while the app is open; events are updated in place (stable ids), so devices that sync never see duplicates. The reader understands UTC and floating times, all-day events, `BYDAY` lists, `COUNT`/`UNTIL`, `EXDATE`, changed single occurrences (`RECURRENCE-ID`) and cancellations; times with a `TZID` are read as wall-clock time in your own time zone; monthly/yearly rules import their first occurrence only.

Browsers cannot read most calendar links (CORS), so when you are signed in the **server fetches the feed** (`GET /api/feed`). Because that makes the server request arbitrary addresses, it is locked down against SSRF: http(s) on common ports only, every resolved address must be public and the connection is pinned to the checked address, redirects are re-validated, 10 s / 5 MB limits, signed-in users only and rate limited. To subscribe to a calendar on your own network, start the server with `UNIHUB_ALLOW_PRIVATE_FEEDS=1`.

## Lecture workspace
Each module has a **Lecture workspace** (module page → 📓, or the 📓 button on a lecture in the calendar/dashboard): one *session* per lecture day with live notes (Markdown, quick-insert for points, `Term ::` definitions, `?` questions, `- [ ]` to-dos), attached documents (upload, drop, or attach from the library) and tasks. **Finish & summarise** builds a lecture summary (`src/lib/lecture.ts`) from the student's notes first, then the day's highlights in the attached documents, then key sentences of those documents: covered topics, key points, definitions and glossary terms (new ones can be added in one click), open questions, to-dos and deadlines found, and the materials. It never invents text; with an AI provider configured the summary can instead be written by the model from the same material (after a confirmation showing what is sent). Summaries are editable (the app asks before replacing your edits), can become a note, tasks, glossary terms or flashcards, are searchable in the knowledge base, appear in the graph, and roll up into a **course overview** (all summaries, open questions and to-dos; export as Markdown; optional AI course summary).

## Scopes: everything, one module, one lecture day
Search, chat and the graph all share one **scope** (`Scope` in `src/lib/kb.ts`): everything, a module, or a single lecture day of a module. A lecture day contains its own notes, summary, attached documents, highlights and quotes; a module contains all of its material. **The glossary is global**: definitions are available in every scope, and the workspace has a Glossary tab (this lecture's terms first, then the whole glossary; add terms, edit, insert a definition into the lecture notes). In the lecture workspace the *Ask* and *Graph* tabs default to "this lecture" with one-click switches to the module or everything; the module page has *Knowledge* and *Graph* tabs; the standalone pages accept `?module=…&session=…`. In the graph a lecture shows its own material and the concepts it mentions, but modules and concepts are not expanded (they touch the whole course). Selecting any item shows its content (`src/lib/nodeinfo.ts`): document excerpt and key points, note text, lecture summary, term definition, quote with its source, highlight with your note, task, thesis chapter, and so on — not just its connections.

## Navigation memory
Back always returns to where you were. The position inside a page lives in the address (`src/lib/nav.ts`): lecture workspace (`?s=lecture&tab=docs`, plus the Ask question / graph selection), module tabs, document view and reader panel, calendar view and date, tasks view, glossary/quotes/study/thesis tabs. Changing a tab *replaces* the history entry, so Back leaves the page instead of stepping through tabs. "← Back to …" links (`BackLink`) go to the page you actually came from and name it (e.g. "Back to CS201 lectures · 2026-10-13 · Documents"); with no history (bookmark / new tab) they fall back to the parent page. Scroll positions are restored on Back.

## AI providers
Anthropic, OpenAI and **Google Gemini** are built in: choose the provider, paste the key, done (Gemini keys are free at aistudio.google.com/apikey; default model `gemini-2.5-flash`, embeddings use `gemini-embedding-001`). Gemini is called through its native API with the key in a header. "OpenAI-compatible" remains for Ollama, LM Studio, OpenRouter and similar.
