---
document: BestCode Master
version: 1.0.0
status: LOCKED
locked_at: 2026-07-19
owner: Enkhbat
canonical_path: /BESTCODE_MASTER.md
---

# BestCode — Locked Master Plan

Энэ файл нь BestCode төслийн алсын хараа, AI-уудын үүрэг, ажлын хатуу дүрэм, source of truth болон үндсэн roadmap-ийн canonical баримт бичиг мөн.

`LOCKED` гэдэг нь AI эсвэл автомат ажиллагаа энэ баримтын зорилго, үүргийн хуваарилалт, хатуу дүрмийг чимээгүй өөрчилж болохгүй гэсэн үг. Өөрчлөлт шаардлагатай бол:

1. тусдаа working branch дээр санал болгоно;
2. яг ямар заалт, яагаад өөрчлөгдөхийг diff-ээр харуулна;
3. төслийн эзэмшигчийн ил тод approval авна;
4. хуучин шийдвэрийг устгахгүй, `superseded` тэмдэглэлтэй үлдээнэ;
5. CI, PR, merge-ийн дараа version-ийг нэмнэ.

## 1. Эцсийн зорилго

BestCode бол код мэдэхгүй хэрэглэгч энгийн хэлээр зорилгоо хэлэхэд ChatGPT, Claude болон апп доторх DeepSeek нэг баталгаатай төслийн мэдээлэл дээр хамтран ажиллаж, кодыг унших, засах, шалгах, Preview хийх, PR болон deployment хүртэл хүргэх mobile-first хөгжүүлэлтийн орчин байна.

Хэрэглэгч Git, branch, commit, CI-ийн техникийн ажиллагааг өөрөө хийх ёсгүй. Хэрэглэгчийн үндсэн үүрэг:

- зорилго, шаардлагаа энгийн хэлээр хэлэх;
- AI-ийн гаргасан үр дүнг хянах;
- зөвхөн бодит эрсдэлтэй change set, production deployment, устгал зэрэгт ойлгомжтой approval өгөх.

## 2. AI болон системийн тогтмол үүрэг

### 2.1 ChatGPT

- ChatGPT Actions/OpenAPI-аар BestCode Worker-тэй холбогдоно.
- Үндсэн төслийн программист, төлөвлөгч, хэрэгжүүлэгч байж болно.
- Project Brain-аас context авч repository, task, CI, diagnostics-ийн бодит төлөв дээр ажиллана.
- BestCode-ийн project allowlist, working branch, approval, validation дүрмийг дагана.

### 2.2 Claude

- MCP-ээр BestCode Worker-тэй холбогдоно.
- ChatGPT-тай ижил Project Brain, task, repository, approval, CI хэрэгслүүд ашиглана.
- ChatGPT-ийн эхлүүлсэн ажлыг task/handoff-аас үргэлжлүүлж чадна.
- Тусдаа үнэн эсвэл тусдаа roadmap үүсгэхгүй.

### 2.3 DeepSeek

- BestCode PWA доторх нэмэлт coding болон diagnostics туслах байна.
- Local workspace, идэвхтэй файл, Preview console, runtime/network error, build/test log зэрэг апп доторх context дээр ажиллана.
- Гаднын AI хараагүй алдааг илрүүлэх, тайлбарлах, засвар санал болгох, хэрэглэгч хүсвэл local эсвэл staged засвар хийх үүрэгтэй.
- ChatGPT/Claude-ийг орлох үндсэн төслийн удирдагч гэж үзэхгүй.
- Repository source of truth-ийг тойрч шууд production өөрчлөлт хийхгүй.

### 2.4 BestCode PWA

- AI чатны өрсөлдөгч биш; mobile workspace, Preview, diagnostics, diff, task status, approval болон project visibility-ийн интерфэйс байна.
- Хэрэглэгчээр давтагдсан техникийн ажиллагаа хийлгэхгүй.
- Нэг coherent change set-д нэг ойлгомжтой approval үзүүлнэ.

### 2.5 BestCode Worker

- ChatGPT Actions, Claude MCP, DeepSeek болон PWA-г нэг project-scoped backend-ээр холбоно.
- GitHub token, provider key болон бусад secret-ийг frontend/AI response-д задруулахгүй.
- Repository, approval, task, diagnostics, handoff болон deployment policy-г бүх AI-д ижил хэрэгжүүлнэ.

## 3. Source of truth

Зөрчил гарвал дараах дарааллыг баримтална:

1. GitHub-ийн `main` branch дахь canonical файл ба код
2. Production Cloudflare deployment-ийн бодит хувилбар
3. `BESTCODE_MASTER.md` болон баталгаажсан decision record
4. GitHub PR, CI, deployment-ийн бодит үр дүн
5. Durable Project Brain task, approval, diagnostics, handoff record
6. AI chat summary болон тайлбар

AI “хийсэн” гэж хэлсэн нь GitHub/CI/deployment нотлоогүй бол дууссан гэсэн үг биш.

## 4. Project Brain

Project Brain нь бүх AI-г нэг модель болгохгүй. Харин бүгдийг ижил зорилго, ижил дүрэм, ижил баталгаатай төлөв дээр ажиллуулна.

### 4.1 Canonical memory

GitHub `main` дээр version-controlled байдлаар хадгална:

- `/BESTCODE_MASTER.md` — locked зорилго ба дүрэм
- `/docs/PROJECT_STATUS.md` — одоогийн бодит төлөв
- `/docs/ARCHITECTURE.md` — системийн бүтэц, урсгал
- `/docs/ROADMAP.md` — хувилбарын дараалал
- `/docs/DECISIONS/` — supersede history бүхий шийдвэрүүд
- `/README.md` — ашиглалт болон integration заавар

### 4.2 Dynamic memory

Worker-ийн durable storage-д project тус бүрээр хадгална:

- task болон түүний үе шат;
- approval operation;
- AI handoff;
- diagnostics snapshot;
- build/test/deployment evidence;
- audit timestamps болон actor.

Dynamic record нь GitHub, CI, deployment-ийн нотолгоог орлохгүй.

### 4.3 Project isolation

`bestcode`, `czech-app` болон ирээдүйн project бүр тусдаа memory, task, diagnostics context-тэй байна. Нэг төслийн дүрэм, өгөгдөл нөгөөд автоматаар холилдохгүй.

## 5. Нэгдсэн task lifecycle

Development task дараах үндсэн төлөвтэй байна:

```text
planned
→ inspecting
→ editing
→ awaiting_approval
→ validating
→ pull_request
→ merged
→ deployed
→ completed
```

Нэмэлт төлөв:

- `blocked` — бодит хаалттай, next action заавал бичигдсэн;
- `cancelled` — зориудаар цуцалсан;
- validation амжилтгүй бол `editing` рүү буцна.

AI хооронд task шилжихэд handoff нь дор хаяж дараах мэдээлэлтэй байна:

- зорилго;
- одоогийн stage;
- branch ба operation/task ID;
- өөрчилсөн болон уншсан гол файл;
- баталгаажсан үр дүн;
- үлдсэн эрсдэл;
- яг дараагийн action.

## 6. Хатуу ажлын дүрэм

1. `main/master` руу шууд AI write, commit, push хийхгүй.
2. Coding task бүр `agent/<task>` working branch ашиглана.
3. Read/search/status зэрэг read-only ажиллагаа автоматаар явна.
4. Файл бүрт тусдаа approval үүсгэхгүй; нэг coherent change set-д нэг approval байна.
5. Approval-аас өмнө commit, push, PR, deployment хийхгүй.
6. Force push хийхгүй.
7. Base SHA өөрчлөгдвөл stale approval ашиглахгүй.
8. Build/test нотолгоогүй бол PR/merge-ийг амжилттай гэж тайлагнахгүй.
9. Production deployment тусдаа high-risk approval-тай байна.
10. AI хэрэглэгчээр хийх боломжтой техникийн ажлыг давтаж хийлгэхгүй; зөвхөн external account login, secret үүсгэх, billing эсвэл бодит high-risk decision үед хэрэглэгчийн оролцоо авна.
11. Нууц түлхүүр, token, password Project Brain болон log-д хадгалахгүй.
12. Хэрэглэгчид харагдах ажлын тайланг ойлгомжтой монгол кириллээр өгнө.
13. Fake result, fake test, fake preview, fake completion үүсгэхгүй.
14. Canonical memory өөрчлөх бол `project_brain_source_of_truth_change` high-risk reason хэрэглэнэ.

## 7. Баталгаажсан гүйцэтгэл

### Phase 0 — Суурь холболт ба architecture — COMPLETED

- Cloudflare backend Worker
- Cloudflare frontend PWA
- Server-side secrets
- ChatGPT Custom GPT Actions/OpenAPI
- Remote MCP
- Project registry
- Read-only repository tools
- Approval-gated safe write tools
- Git delivery, build/test, PR болон deployment tools

### Phase 1 — Repository тогтворжуулалт — COMPLETED

- OpenAPI description hard limit болон regression tests
- Branch list/compare/delete tools
- SHA-pinned high-risk branch deletion
- Superseded PR болон хуучин branch cleanup
- Зөвхөн `main` үлдсэн final verification

## 8. Үндсэн roadmap

### Phase 2 — Project Brain v1 — CURRENT

- Canonical Master, Status, Architecture, Roadmap
- Project context aggregation
- Canonical memory search
- Durable development task
- AI handoff
- ChatGPT Actions, Claude MCP, DeepSeek-д ижил context
- Provenance болон source-of-truth policy
- Project Brain tests

### Phase 3 — Production-grade PWA update system

- Build/version metadata
- Update detection болон хэрэглэгчид ойлгомжтой update UI
- Service worker lifecycle, cache migration, stale-tab protection
- Offline recovery, rollback, iPhone standalone verification

### Phase 4 — Professional Workspace v1

- Жинхэнэ file tree, multi-tab editor, breadcrumb, search
- File create/rename/move/delete
- Git status, unsaved change, conflict UI
- Mobile болон desktop usability

### Phase 5 — Preview ба diagnostics

- HTML/JS/TS/React/Python бодит smoke tests
- Preview console/runtime/network error capture
- Diagnostics snapshot-ийг DeepSeek болон external AI-д өгөх
- Preview sandbox security

### Phase 6 — Remote runner ба terminal

- Ephemeral sandbox
- Dependency install, shell command, process/port management
- Build/test/preview log streaming
- Command policy, timeout, resource болон secret isolation

### Phase 7 — Security hardening

- Per-user/session auth эсвэл OAuth
- Rate limiting, replay protection, idempotency
- Audit history, approval expiry, secret redaction, CORS tightening

### Phase 8 — Release verification

- ChatGPT Actions, Claude MCP, DeepSeek end-to-end smoke tests
- Full approval, PR, CI, deployment, rollback flow
- iPhone Safari болон installed PWA test
- Release notes, stable version tag

## 9. Ажлын багцын Definition of Done

Ажлын багц зөвхөн дараах бүх нөхцөл биелсэн үед дууссан:

- scope ба acceptance criteria биелсэн;
- lint/typecheck/unit/integration test ногоон;
- diff хянагдсан;
- шаардлагатай approval авсан;
- working branch push хийгдсэн;
- PR нээгдэж CI ногоон болсон;
- `main` руу merge хийгдсэн;
- шаардлагатай бол production deployment баталгаажсан;
- `docs/PROJECT_STATUS.md` шинэчлэгдсэн;
- хэрэглэгчид үр дүн, нотолгоо, үлдсэн эрсдэлийг товч тайлагнасан.

## 10. Тайлагналын тогтмол хэлбэр

```text
☑ Дууссан:
- ...

◐ Одоо хийж байгаа:
- ...

☐ Дараагийн ажил:
- ...

⏸ Хаалт/эрсдэл:
- ...
```

## 11. Locked decision register

| ID | Шийдвэр | Төлөв |
|---|---|---|
| BC-001 | ChatGPT болон Claude нь external primary coding agent байж болно | Active |
| BC-002 | DeepSeek нь PWA доторх нэмэлт coding/diagnostics туслах | Active |
| BC-003 | Бүх AI нэг Project Brain болон task system ашиглана | Active |
| BC-004 | Хэрэглэгч техникийн Git ажиллагаа хийх үүрэггүй | Active |
| BC-005 | GitHub `main` бол кодын эхний source of truth | Active |
| BC-006 | Нэг coherent change set-д нэг approval | Active |
| BC-007 | Master-ийн locked заалтыг зөвхөн explicit owner approval-аар өөрчилнө | Active |
