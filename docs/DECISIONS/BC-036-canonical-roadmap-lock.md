---
decision_id: BC-036
title: Canonical roadmap lock
status: accepted
accepted_at: 2026-07-21
owner: Enkhbat
risk: core/critical
supersedes:
  - duplicate phase numbering in older Master and roadmap drafts
canonical_roadmap_path: /docs/ROADMAP.md
---

# BC-036 — BestCode canonical roadmap lock

## 1. Шийдвэр

BestCode төслийн хэрэгжүүлэлтийн **цорын ганц canonical roadmap** нь GitHub-ийн `main` branch дахь `/docs/ROADMAP.md` байна.

`/BESTCODE_MASTER.md` нь бүтээгдэхүүний алсын хараа, AI-уудын үүрэг, аюулгүй ажиллагаа, source-of-truth болон түгжсэн зарчмыг тогтооно. Master доторх roadmap хэсэг нь зөвхөн өндөр түвшний товчлол байна. Phase-ийн дугаар, дараалал, төлөв, dependency, exit evidence болон deliberate exclusion зөрвөл `/docs/ROADMAP.md` түрүүлж хүчинтэй.

`/docs/PROJECT_STATUS.md` нь одоогийн бодит хэрэгжилтийн төлөвийг харуулна. Энэ нь roadmap-ийн дарааллыг өөрчлөхгүй.

## 2. Түгжсэн үндсэн архитектур

BestCode-ийн үндсэн AI холболтын зам:

```text
ChatGPT native chat → Actions/OpenAPI ┐
Claude native chat → MCP             ├→ BestCode Worker → Project Brain / Mission / Task / Approval
Gemini болон бусад native chat adapter┘
```

AI бүр өөрийн төрөлх чатнаасаа BestCode-ийн ижил Project Brain, task, handoff, repository, diagnostics болон approval хэрэгслийг ашиглана.

Нэмэлт, сонголтот зам:

```text
BestCode Agent Runtime → OpenAI API / Anthropic API / Gemini API / DeepSeek API / бусад provider adapter
```

Model API execution нь үндсэн native-chat архитектурыг орлохгүй. Background, batch, bounded automation эсвэл owner зориудаар сонгосон үед л ашиглагдана. Provider бүр adapter boundary-тай, optional, budget/risk policy-тэй байна.

## 3. Canonical phase дараалал

### Phase 0 — Core Controller — COMPLETED

Worker/PWA, ChatGPT Actions/OpenAPI, MCP, project registry, safe repository read/write, approval, Git delivery, CI/deploy foundation.

### Phase 1 — Repository Stabilization — COMPLETED

OpenAPI regression protection, branch management, SHA-pinned destructive approval, cleanup workflow.

### Phase 2 — Project Brain v1 — COMPLETED

Canonical context/search, durable development task, handoff, ChatGPT Actions/MCP parity.

### Phase 2.1 — Production Integrity & Security Floor — IN PROGRESS / P0

Production source lock, approval/idempotency, auth/rate/redaction, critical-path protection.

### Phase 3 — Mobile Trust UX & Release Control

Version/update contract, semantic approval, release history, rollback UX, installed-PWA verification.

### Phase 4 — Mission Control & Second Brain v2

Mission schema, lifecycle, dependency graph, Context Packet, structured Owner Intent/Project Brain/World Evidence, Asset Graph.

Одоогийн Agent Runtime-ийн task persistence, create/update API, dependency planner нь энэ Phase 4-ийн суурь implementation байна. Энэ нь API provider dispatch-ийг үндсэн архитектур болгосон гэсэн үг биш.

Lease/heartbeat, resumable mission болон cross-agent context handoff нь Phase 4-д бүрэн гүйцэд орно.

### Phase 5 — Web Research Agent v1

Provider-neutral search adapter, safe source reader, evidence/claim/contradiction, research dossier.

### Phase 6 — Professional Creation Workspace & Diagnostics

Жинхэнэ file tree, file create/rename/move/delete, multi-tab editor, search, Git/workspace status, Preview, diagnostics болон BestCode chat-аас workspace файл үүсгэж/засах урсгал.

### Phase 7 — Secure Runtime & Terminal

Ephemeral sandbox/container, dependency install, shell command, process/port management, log streaming, timeout, resource/secret isolation, mobile terminal.

### Phase 8 — Provider Quality, Routing & Economics

Native-chat adapter parity, optional model API provider selection, capability/cost/quality evaluation, bounded automatic dispatch.

### Phase 9 — Real-world Creation Modes

Engineering assist, diagnosis/repair, personal automation, document/media workflows болон owner approval boundary.

### Phase 10 — Asset Vault, Backup & Migration

Reusable asset/skill/template graph, export, backup, restore, provider portability болон long-term ownership.

## 4. Workspace, chat ба Second Brain-ийн холбоо

BestCode file tree, editor, Preview, terminal болон chat нь тусдаа үнэн үүсгэхгүй.

AI ажил эхлэхдээ scoped Context Packet-аар дараах мэдээллийг авна:

- active project, mission, task, acceptance criteria;
- repository, branch, base SHA;
- workspace tree болон relevant file content;
- staged/unsaved change;
- diagnostics, build/test/preview evidence;
- accepted decision;
- previous handoff болон next action;
- context hash/version.

Raw chat transcript canonical memory болохгүй. Owner explicit `remember` хийсэн, accepted decision болсон, эсвэл machine evidence-ээр нотлогдсон зүйл л structured Second Brain/Project Brain-д орно.

## 5. Status vocabulary

Canonical roadmap болон status document дараах нэр томьёог хэрэглэнэ:

- `LIVE` — production дээр нотлогдсон;
- `COMPLETED` — package exit evidence бүрэн, merge хийгдсэн;
- `IN PROGRESS` — идэвхтэй bounded package;
- `PARTIAL` — хэсэг нь ажилладаг боловч exit evidence дутуу;
- `CODE_READY_NOT_MERGED` — code/CI бэлэн боловч `main`-д ороогүй;
- `TARGET` — roadmap-д түгжсэн, хараахан эхлээгүй;
- `EXPERIMENT` — хэмжилтээр батлах таамаг;
- `BLOCKED` — хаалт ба next action тодорхой.

AI chat дахь “хийсэн” гэсэн тайлбар энэ төлөвийг өөрчлөхгүй.

## 6. Roadmap өөрчлөх дүрэм

Canonical phase order, scope boundary эсвэл үндсэн native-chat/provider архитектурыг өөрчлөх бүр:

1. тусдаа `agent/<task>` branch;
2. semantic diff ба шалтгаан;
3. `project_brain_source_of_truth_change` high-risk classification;
4. owner-ийн explicit approval;
5. decision record;
6. Master/ROADMAP/STATUS consistency check;
7. CI, PR, merge;
8. version/supersession history.

AI roadmap-ийг хэрэгжүүлэх явцдаа чимээгүй дахин эрэмбэлэхгүй.

## 7. Ойрын хэрэгжүүлэлтийн дараалал

Одоогийн Agent Runtime branch-ийн ажил canonical roadmap-тай дараах байдлаар холбоно:

1. Agent Runtime foundation-ийг CI болон code review-оор баталгаажуулах;
2. task persistence/create/update/dependency planner-ийг Phase 4 foundation гэж тэмдэглэх;
3. native ChatGPT Actions болон Claude MCP-д task/context parity-г хадгалах;
4. API provider dispatch-ийг одоогоор `TARGET / optional` хэвээр үлдээх;
5. Phase 2.1-ийн үлдсэн security floor болон Phase 3 trust UX gate-ийг алгасахгүй;
6. дараа нь Phase 4 Mission/Context Packet/Second Brain-ийг дуусгах;
7. Phase 6-д professional file tree/editor/chat workspace integration;
8. Phase 7-д terminal/runner.

## 8. Acceptance

Энэ шийдвэрийг owner 2026-07-21-нд “canonical roadmap болгож түгжих” гэж ил тод зөвшөөрсөн.

Энэ decision merge болсны дараа хуучин phase дугаарын зөрчилтэй chat summary, draft болон uploaded copy canonical биш болно.