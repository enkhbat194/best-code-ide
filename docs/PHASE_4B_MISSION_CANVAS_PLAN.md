# Phase 4B — Mission Canvas delivery plan

Status: `IN PROGRESS — 4B.1–4B.4 MERGED; CORE OWNER SMOKE PASSED; AI CHAT MISSION TOOL PARITY OWNER RE-VERIFY PENDING`

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
- deterministic provisional next most valuable action.

Evidence:

- PR #44;
- Test run `29827166374`: success;
- Validate run `29827166318`: success;
- merge SHA `c71230a0571f8333d9c14ba51664df6228073514`.

### 4B.2 — AI framing and done-contract editor — MERGED

Delivered:

- owner intent-ийг bounded structured DeepSeek framing request болгох;
- strict JSON extraction and schema validation;
- AI-ийн ойлгосон title, outcome, assumptions, exclusions, risks болон proposed done criteria-г owner-д харуулах;
- owner title/outcome/criteria-г edit, remove, add хийх;
- owner confirmation хүртэл provider proposal durable Mission-д хадгалагдахгүй;
- accepted criteria-г `mission_mutate:add_criterion`-оор хадгалах;
- lifecycle `captured → framing → planned` transition;
- create flow-ийн writer lease cleanup;
- AI unavailable үед explicit manual creation fallback.

Evidence:

- PR #45;
- Test run `29827675319`: success;
- Validate run `29827675318`: success;
- merge SHA `d13dfbee466b7c9f82e1699b220f3700603f0b48`.

Safety:

- AI proposal нь owner confirmation биш;
- provider raw text-ийг schema validationгүйгээр Mission-д хадгалахгүй;
- criteria 2–4, item бүр 180 тэмдэгтээр bounded;
- repository/deployment/rollback action эхлүүлэхгүй;
- DeepSeek secret browser руу гарахгүй, existing authenticated `/api/llm` proxy ашиглана.

### 4B.3 — Multimodal capture, timeline and decision inbox — MERGED

Delivered:

- iOS/browser Web Speech API боломжтой үед Mongolian voice transcription;
- Web Speech байхгүй үед keyboard microphone/text fallback тайлбар;
- image/file сонголтоос зөвхөн filename, MIME type, size metadata capture;
- http/https URL normalize болон credential/hash stripping;
- нийт 5 bounded reference metadata-г Goal outcome дотор owner-readable reference хэсгээр durable хадгалах;
- binary file/image-г Mission record руу upload хийхгүй;
- Mission composer-ийг тусдаа component болгож modular болгох;
- operation timeline-д human-readable mutation label;
- writer lease holder, expiry, heartbeat display;
- open Decision бүрт owner note + accept/reject/supersede action;
- decision mutation writer lease болон current context version ашиглана;
- бүх open decision хаагдаж lifecycle `decision` байвал `planned` руу буцаана;
- context mismatch/lease conflict үед шинэ төлөв татах recovery UX.

Evidence:

- PR #46;
- Test run `29828294827`: success;
- Validate run `29828294857`: success;
- merge SHA `d8e7b435843d5589b7cd61f09d23d51f41934e51`.

Safety:

- microphone болон file picker зөвхөн user gesture-ээр эхэлнэ;
- reference binary хадгалахгүй, metadata нь 5 item, нэр/төрөл/хэмжээ/URL-аар bounded;
- URL зөвхөн http/https бөгөөд username/password/hash хадгалахгүй;
- owner decision бүр active writer lease, optimistic context version, idempotency key ашиглана;
- repository write, deployment, rollback эсвэл production traffic action эхлүүлэхгүй.

### 4B.4 — Next-action engine, handoff and verification — MERGED

Delivered:

- deterministic next-action policy engine;
- open owner decision үед autonomous continuation fail-closed;
- active writer lease үед second writer wait action;
- Goal/done-contract missing, running/blocked/ready task, verifying, completed/package states-ийн тайлбартай action;
- task dependency болон priority-aware selection;
- provider-neutral `mission-context-packet-v1` татах UI;
- Context Packet clipboard copy болон JSON export;
- DeepSeek resume-readiness check нь tool executionгүйгээр packet sufficient эсэхийг structured JSON-оор шалгана;
- ChatGPT/Claude нь authenticated `mission_context_packet` MCP/Actions tool-оор packet авах contract-тай;
- Mission identity, context version/hash, goal/criteria, decision safety, next action, writer lease visibility шалгах owner-visible smoke card;
- deterministic policy unit tests.

Evidence:

- PR #47;
- Test run `29828782586`: success;
- Validate run `29828782679`: success;
- merge SHA `1dedcb16d13ba1dc141b3b2f12b2b25fea742d86`.

Safety:

- next-action engine өөрөө tool execute хийхгүй;
- open Decision байхад action `blocked=true`, `ownerRequired=true`;
- DeepSeek resume check repository/deployment/payment/destructive action хийхгүй read-only evaluation;
- packet export нь current bounded Mission data;
- external provider handoff current context version/hash-ийг заавал хэрэглэнэ.

## Owner production evidence — 2026-07-21

Installed iOS PWA дээр owner дараах core flow-г амжилттай шалгасан:

- Mission ID: `4b602323-67f4-492d-9b51-2c6aa7f87db9`;
- schema: `mission-context-packet-v1`;
- lifecycle: `planned`;
- context version: `v10`;
- context hash: `fnv1a32:c8a14932`;
- goals: `1`;
- acceptance criteria: `4`;
- open decisions: `0`;
- active tasks: `0`;
- writer lease: `null`;
- DeepSeek resume: ready;
- Mission identity, context concurrency, goal/done contract, decision safety, next-action policy болон writer lease visibility бүх smoke мөр: passed;
- overall: `Phase 4B Mission Canvas smoke амжилттай`.

## Discovered integration gap and correction

Owner regular `AI Chat` дээр Mission ID-аар `mission_context_packet` уншуулахад agent Mission-ийг local/GitHub файл гэж андуурч асуусан. Шалтгаан нь Canvas-ийн DeepSeek resume path packet-ийг бэлдэж өгдөг боловч regular browser agent tool registry-д Mission tools байгаагүй.

Current correction package:

- regular AI Chat-д read-only `mission_list`, `mission_get`, `mission_context_packet` tools нэмэх;
- existing authenticated Actions clients-ийг ашиглах;
- Mission ID нь durable backend record болохыг system prompt-д түгжих;
- Mission ID өгөгдсөн үед local файл эсвэл GitHub document хаана байгааг асуухгүй байх;
- mutation, repository write, deployment, rollback capability нэмэхгүй;
- source-level regression test нэмэх.

## Remaining verification and closeout gate

AI Chat parity PR merge/deploy болсны дараа installed iOS PWA дээр owner:

1. regular `AI Chat` нээнэ;
2. Mission ID `4b602323-67f4-492d-9b51-2c6aa7f87db9`-ээр read-only packet хүснэ;
3. tool card дээр `mission_context_packet` дуудагдсан эсэхийг шалгана;
4. хариу `v10` болон `fnv1a32:c8a14932`-тай таарч байгааг шалгана;
5. agent local файл эсвэл GitHub pull асуухгүй байгааг батална.

Full Phase 4B formal closeout-д мөн multimodal capture болон Decision inbox-ийн owner-visible evidence-ийг бүртгэнэ. Эдгээр evidence бүрдсэний дараа тусдаа docs-only closeout PR-аар Phase 4B-г `COMPLETED` болгоно.

## Current package boundary

Core Mission Canvas implementation болон owner smoke амжилттай. Regular AI Chat Mission read parity current package-д хэрэгжсэн боловч CI, merge, production deployment болон owner re-verification хүлээгдэж байна. Binary asset vault/storage нь Phase 4D/Asset Graph хүрээнд хэвээр.
