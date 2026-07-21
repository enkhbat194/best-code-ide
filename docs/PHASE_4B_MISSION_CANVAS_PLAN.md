# Phase 4B — Mission Canvas delivery plan

Status: `IN PROGRESS — 4B.1 MERGED; 4B.2 IMPLEMENTED`

## Owner outcome

Owner зорилгоо нэг удаа бичээд durable Mission үүсгэнэ. Дараа нь аль AI үргэлжлүүлсэн ч ижил goal, done criteria, decision, task, context version/hash болон writer lease төлвөөс ажиллана.

## Delivery packages

### 4B.1 — Canvas shell and text intent capture — MERGED

Delivered:

- primary mobile tab-ийг `Mission` болгосон;
- Mission Canvas болон existing AI Chat хооронд нэг workspace дотор шилждэг;
- durable Mission жагсаах, сонгох, refresh хийх;
- text intent capture;
- owner хадгалахаас өмнө exact name/outcome confirmation;
- Mission create → writer lease → initial Goal mutation → lease cleanup;
- lifecycle, context version/hash, goals, criteria count, open decisions, active tasks, lease болон recent operations snapshot;
- deterministic provisional “next most valuable action”.

Evidence:

- PR #44;
- Test run `29827166374`: success;
- Validate run `29827166318`: success;
- merge SHA `c71230a0571f8333d9c14ba51664df6228073514`.

### 4B.2 — AI framing and done-contract editor — IMPLEMENTED

Delivered in current package:

- owner intent-ийг bounded structured DeepSeek framing request болгох;
- strict JSON extraction and schema validation;
- AI-ийн ойлгосон title, outcome, assumptions, exclusions, risks болон proposed done criteria-г owner-д харуулах;
- owner title/outcome/criteria-г edit, remove, add хийх;
- owner confirmation хүртэл provider proposal durable Mission-д хадгалагдахгүй;
- accepted criteria-г `mission_mutate:add_criterion`-оор хадгалах;
- lifecycle `captured → framing → planned` transition;
- create flow-ийн writer lease cleanup;
- AI unavailable үед explicit manual creation fallback.

Safety:

- AI proposal нь owner confirmation биш;
- provider raw text-ийг schema validationгүйгээр Mission-д хадгалахгүй;
- criteria 2–4, item бүр 180 тэмдэгтээр bounded;
- repository/deployment/rollback action эхлүүлэхгүй;
- DeepSeek secret browser руу гарахгүй, existing authenticated `/api/llm` proxy ашиглана.

### 4B.3 — Multimodal capture, timeline and decision inbox

Scope:

- voice transcription capture;
- image/file attachment metadata capture;
- bounded URL reference capture;
- task/operation progress timeline-г action grouping болон status copy-оор сайжруулах;
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

4B.2 нь AI framing болон creation-time done-contract editor. Voice/image/file/URL ingestion, existing Mission criteria mutation editor, decision mutation, cross-provider handoff болон Phase 4B closeout-г дууссан гэж тэмдэглэхгүй. Тэдгээрийг 4B.3–4B.4 багцаар хэрэгжүүлнэ.
