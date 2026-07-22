# ADR 0003 — Chat-first Project Nervous System

- Status: `ACCEPTED / LOCKED`
- Owner approval: 2026-07-22
- Scope: Phase 4C-аас эхлэх Second Brain v2, automatic 4B ingestion, universal AI connection
- Supersedes: none

## 1. Owner outcome

Owner зөвхөн AI Chat-тай харилцана. Текст бичих, зураг, PDF, аудио, видео, кодын файл болон URL хавсаргах нь үндсэн хэрэглээ байна.

Owner дараах гар ажиллагааг хийх ёсгүй:

- Mission нэр, төрөл, task-ийг тусдаа дэлгэц дээр давтан бөглөх;
- хавсралтыг дахин Mission-д гараар холбох;
- нэг AI-аас нөгөө AI руу context copy/paste хийх;
- AI-ийн үүсгэсэн файл, test result, шийдвэрийг гараар архивлах.

## 2. Locked operating model

```text
Owner AI Chat
    ↓
4B automatic ingestion
    ↓
Second Brain v2
    ↓
Context Builder
    ↓
Connected AI provider
    ↓
Structured write-back
    ↓
Second Brain v2
```

- **AI Chat** — owner-д харагдах үндсэн хаалга.
- **4B automatic ingestion** — эх мэдээллийг хүлээн авч Project/Mission-тэй автоматаар холбох дотоод ажилтан.
- **Second Brain v2** — төслийн зорилго, эх материал, шийдвэр, task, evidence, AI үр дүнгийн үндсэн санах ой.
- **Context Builder** — бүх архивыг өгөхгүй; тухайн ажилд хэрэгтэй хамгийн бага багцыг гаргана.
- **AI Gateway** — ChatGPT, Claude, DeepSeek, Gemini, Cursor, local AI болон ирээдүйн provider-ийг ижил эрх, audit, write-back дүрмээр холбоно.

## 3. Storage decision

### Canonical source

Server-side Second Brain нь үндсэн үнэн байна. Local IndexedDB нь зөвхөн хурдан cache, offline draft, pending upload хадгална.

### Structured records

Мэдээллийг нэг том JSON summary-д чихэхгүй. Дараах объектууд тусдаа durable record байна:

- project;
- mission;
- source;
- asset;
- goal;
- criterion;
- task;
- decision;
- evidence;
- agent run;
- memory;
- relationship;
- event.

### Original and interpreted data

Owner-ийн эх текст, файл болон transcript-ийг AI-ийн тайлбараар сольж болохгүй.

```text
Original source = owner яг юу өгсөн
Interpretation = AI юу гэж ойлгосон
Verified fact = evidence-аар батлагдсан зүйл
```

Эдгээр нь тусдаа status болон provenance-тай байна.

### Large files

Зураг, PDF, аудио, видео болон generated artifact-ийг database JSON дотор хадгалахгүй. Тусдаа object storage-д хадгалж, Second Brain-д metadata, hash, relationship, extracted content reference хадгална.

### Vector index

Embedding/vector нь canonical memory биш. Keyword болон structured filter эхэлж хэрэглэнэ. Vector index нь зөвхөн дахин үүсгэж болох derived search index байна.

## 4. AI connection decision

AI database руу шууд нэвтрэхгүй.

```text
AI → BestCode REST/MCP/Internal API → permission check → Brain
```

Provider бүр:

- project scope;
- read/write capability;
- file access;
- repository permission;
- production permission;
- expiry болон audit identity

гэсэн тусдаа эрхтэй байна.

Connected AI бүр context авч болно. Гэхдээ бүх AI бүх мэдээллийг харахгүй; тухайн ажилд хэрэгтэй, зөвшөөрөгдсөн object-уудыг л авна.

## 5. Automatic write-back decision

AI-ийн урт хариуг бүхэлд нь active memory болгохгүй. Provider бүр ажлын дараа provider-neutral бүтэц буцаана:

- summary;
- completed tasks;
- new tasks;
- decisions required;
- artifacts;
- evidence;
- next action.

4B энэ үр дүнг зөв object болон relationship болгон хадгална. Нотолгоогүй AI санал `verified fact` болохгүй.

## 6. Safety invariants

- Owner-ийн анхны зорилго хадгалагдана.
- Secret value Second Brain-д хадгалахгүй; зөвхөн secret reference байж болно.
- Production, payment, permission болон irreversible action owner approval-гүй явахгүй.
- Нэг Mission-д нэг active writer lease байна.
- Stale version write татгалзана.
- Completed төлөв evidence шаарддаг.
- Бүх өөрчлөлт event/audit мөртэй байна.
- Export, backup, restore, forget ажиллагаа заавал байна.
- Одоогийн branch, PR, CI, deployment safety дүрэм сулрахгүй.

## 7. Locked implementation packages

1. `Brain Store v2 foundation` — normalized durable objects, relationships, events, versioned writes, export contract.
2. `Asset storage` — R2/object storage, hash deduplication, upload lifecycle.
3. `Chat attachments` — image/PDF/audio/video/code/URL input.
4. `Automatic 4B routing` — Project/Mission resolve, draft Mission, uncertainty gate.
5. `Extraction` — PDF text, image vision/OCR, audio transcript, code parsing.
6. `Context Engine` — minimal bounded packet and on-demand retrieval.
7. `Universal AI Gateway` — REST, MCP, internal adapter, scoped capabilities.
8. `Automatic write-back` — provider-neutral result contract and cross-agent resume.
9. `Project Nervous System` — drift, stale decision, duplicate task, evidence and risk detection.
10. `Backup/security/production closeout` — export, restore, retention, forget, owner smoke.

Package бүр branch → PR → CI → merge дарааллаар орно. Өмнөх package-ийн exit evidence ногоон болоогүй бол дараагийн autonomous power нээгдэхгүй.

## 8. Phase 4B UI decision

`4B Test` нь owner-ийн өдөр тутмын үндсэн tab биш. Production closeout evidence хадгалсны дараа Settings → Diagnostics дотор шилжинэ.

Owner-ийн үндсэн UI:

- Chat;
- Mission summary;
- Needs your decision.

## 9. Current first package

`agent/brain-store-v2-foundation` нь энэ ADR-ийн эхний implementation package.

Энэ package:

- тусдаа `BRAIN_STORE` Durable Object;
- typed Brain object/relation/event schema;
- original text + structured attributes;
- optimistic object version;
- authenticated `/api/brain/*` REST route;
- project export foundation;
- Mission v1-ийн 3800 тэмдэгтийн envelope-ээс тусгаарласан хадгалалт

нэмнэ.

Mission v1 энэ package дээр устахгүй. Migration болон dual-read дараагийн package-д evidence-тэй орно.
