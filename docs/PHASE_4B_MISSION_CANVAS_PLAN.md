# Phase 4B — Mission Canvas delivery plan

Status: `IN PROGRESS — 4B.1 FOUNDATION IMPLEMENTED`

## Owner outcome

Owner зорилгоо нэг удаа бичээд durable Mission үүсгэнэ. Дараа нь аль AI үргэлжлүүлсэн ч ижил goal, done criteria, decision, task, context version/hash болон writer lease төлвөөс ажиллана.

## Delivery packages

### 4B.1 — Canvas shell and text intent capture

Scope:

- primary mobile tab-ийг `Mission` болгох;
- Mission Canvas болон existing AI Chat хооронд нэг workspace дотор шилжих;
- durable Mission жагсаах, сонгох, refresh хийх;
- text intent capture;
- owner хадгалахаас өмнө яг ямар нэр/үр дүн хадгалагдахыг харуулах;
- Mission create → writer lease → initial Goal mutation → lease cleanup;
- lifecycle, context version/hash, goals, criteria count, open decisions, active tasks, lease болон recent operations snapshot;
- deterministic provisional “next most valuable action”.

Exit evidence:

- frontend lint/build green;
- Test/Validate CI green;
- installed PWA дээр text intent-ээс Mission үүсч, Goal болон released lease харагдах;
- existing AI Chat алдагдахгүй.

### 4B.2 — AI framing and done-contract editor

Scope:

- owner intent-ийг bounded structured framing request болгох;
- AI-ийн ойлгосон goal, exclusions, assumptions, risks болон proposed done criteria-г owner-д харуулах;
- owner edit/accept/reject хийх хүртэл durable Mission-д автоматаар батлахгүй;
- accepted criteria-г `mission_mutate:add_criterion`-оор хадгалах;
- lifecycle `captured → framing → planned` transition;
- text input-д URL reference metadata нэмэх.

Safety:

- AI proposal нь owner confirmation биш;
- provider raw text-ийг schema validationгүйгээр Mission-д хадгалахгүй;
- repository/deployment action эхлүүлэхгүй.

### 4B.3 — Multimodal capture, timeline and decision inbox

Scope:

- voice transcription capture;
- image/file attachment metadata capture;
- bounded URL capture;
- task/operation progress timeline;
- active agent/role/writer lease heartbeat display;
- open Decision inbox;
- decision accept/reject/supersede mutation UX;
- stale-context refresh and retry UX.

Safety:

- file/image binary-г Mission v1 record дотор хийхгүй, зөвхөн bounded reference metadata;
- microphone/file permission user gesture-ээр;
- external content нь prompt-injection болон retention boundary-тай.

### 4B.4 — Next-action engine and closeout

Scope:

- lifecycle, decisions, criteria, dependencies, task priority болон lease state-аас next most valuable action тодорхойлох;
- owner decision шаардлагатай үед autonomous work зогсоох;
- Context Packet copy/export/provider handoff;
- ChatGPT/Claude/DeepSeek resume dogfood test;
- installed PWA verification card;
- Phase 4B closeout decision/evidence.

Exit evidence:

1. owner text/voice/image/file/URL-аас intent capture хийнэ;
2. AI understanding-ийг owner edit/confirm хийнэ;
3. done criteria durable хадгалагдана;
4. timeline, agent/lease, decision inbox нэг дэлгэцэд харагдана;
5. next action тайлбартай харагдана;
6. өөр AI Context Packet-аас copy/pasteгүй үргэлжлүүлнэ;
7. stale context болон second writer fail closed;
8. installed iOS PWA owner smoke passed.

## Current package boundary

4B.1 нь text capture болон Canvas foundation. Энэ package AI framing, criteria mutation editor, voice/image/file/URL ingestion эсвэл decision mutation-ийг дууссан гэж тэмдэглэхгүй. Тэдгээрийг 4B.2–4B.4 багцаар дараалан хэрэгжүүлнэ.
