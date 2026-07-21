# Phase 4B — Mission Canvas delivery plan

Status: `IN PROGRESS — 4B.1–4B.3 MERGED; 4B.4 IMPLEMENTED; OWNER SMOKE PENDING`

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
- нийт 5 bounded reference metadata-г Goal outcome дотор ил owner-readable reference хэсгээр durable хадгалах;
- binary file/image-г Mission record руу upload хийхгүй;
- Mission composer-ийг тусдаа component болгож modular болгох;
- operation timeline-д human-readable mutation label;
- writer lease holder, expiry, heartbeat display;
- open Decision бүрт owner note + accept/reject/supersede action;
- decision mutation writer lease болон current context version ашиглана;
- бүх open decision хаагдаж lifecycle `decision` байвал `planned` руу буцаана;
- context mismatch/lease conflict үед “Шинэ төлөв татах” recovery UX.

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

### 4B.4 — Next-action engine, handoff and verification — IMPLEMENTED

Delivered in current package:

- deterministic next-action policy engine;
- open owner decision үед autonomous continuation fail-closed;
- active writer lease үед second writer wait action;
- Goal/done-contract missing, running/blocked/ready task, verifying, completed/package states-ийн тайлбартай action;
- task dependency болон priority-aware selection;
- provider-neutral `mission-context-packet-v1` татах UI;
- Context Packet clipboard copy болон JSON export;
- DeepSeek resume-readiness check нь tool executionгүйгээр packet sufficient эсэхийг structured JSON-оор шалгана;
- ChatGPT/Claude нь existing authenticated `mission_context_packet` MCP/Actions tool-оор copy/pasteгүй авах contract-тай;
- Mission identity, context version/hash, goal/criteria, decision safety, next action, writer lease visibility шалгах owner-visible Phase 4B smoke card;
- deterministic policy unit tests.

Safety:

- next-action engine өөрөө tool execute хийхгүй;
- open Decision байхад action `blocked=true`, `ownerRequired=true`;
- DeepSeek resume check repository/deployment/payment/destructive action хийхгүй read-only evaluation;
- packet export нь current bounded Mission data;
- external provider handoff current context version/hash-ийг заавал хэрэглэнэ.

## Verification and closeout gate

Implementation merge хийсний дараа installed iOS PWA дээр owner дараахыг шалгана:

1. `Mission` tab болон `AI Chat` switch харагдана;
2. text intent + AI framing-аар Mission үүсгэнэ;
3. 2–4 done criteria durable харагдана;
4. voice болон file/image/URL metadata capture UI ажиллана;
5. open Decision байвал next action blocked болох ба owner шийдвэр гаргаж чадна;
6. Context Packet version/hash Mission card-тай таарна;
7. DeepSeek resume check packet-оос summary/next action гаргана;
8. `Phase 4B smoke test ажиллуулах` бүх мөр ногоон болно;
9. ChatGPT эсвэл Claude MCP-ээр тухайн Mission-ийн packet-ийг нэр/ID ашиглан унших cross-provider dogfood хийнэ.

Owner screenshot + cross-provider dogfood evidence гарсны дараа тусдаа docs-only closeout PR-аар Phase 4B-г `COMPLETED` болгоно.

## Current package boundary

4B.4 implementation хийсэн боловч production deploy, installed-PWA owner smoke болон ChatGPT/Claude бодит resume dogfood хараахан баталгаажаагүй. Иймээс Phase 4B-г одоогоор бүрэн хаасан гэж тэмдэглэхгүй. Binary asset vault/storage нь Phase 4D/Asset Graph хүрээнд хэвээр.
