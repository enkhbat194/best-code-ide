---
decision: BC-008..BC-020
status: accepted
accepted_at: 2026-07-19
owner: Enkhbat
master_version: 2.0.0
supersedes: []
extends: BC-001..BC-007
---

# BestCode-ийг Personal Creation OS болгох шийдвэр

## Context

BestCode v1 нь ChatGPT Actions, Claude MCP, DeepSeek/PWA, GitHub, approval болон Project Brain-ийг нэг controller-оор холбох зөв суурь тавьсан. Гэхдээ бүтээгдэхүүнийг “AI-аар код бичүүлэх mobile IDE” гэж хэт нарийн тодорхойлсон хэвээр байв.

Owner-ийн жинхэнэ зорилго илүү том:

- зөвхөн код биш, бодит амьдралын судалгаа, зураг төсөл, sourcing, засвар, automation, баримт бүтээх;
- утсаас эхлүүлж, техникийн алхмаар дарамтлуулахгүй байх;
- ChatGPT, Claude, DeepSeek эсвэл ирээдүйн AI-аас үл хамаарах нэг зорилго ба санах ойтой байх;
- бүтээл бүрийг дахин ашиглагдах, export хийж болох хувийн хөрөнгө болгох;
- AI-ийн хариунд сохроор итгэх биш, эх сурвалж, шалгалт, approval, rollback-оор удирдах.

Claude-ийн review нь capability scope, evidence record, semantic approval, path class, lease, idempotency, cross-vendor review болон threat model шаардлагатайг зөв тодорхойлсон. Gemini-ийн санал web research agent-ийн хэрэглээг сайн харуулсан. Гэхдээ arbitrary scraping endpoint, нэг search vendor-д түгжих, CAPTCHA/proxy тойрох, хуучирдаг API үнэ, web/forum-ийн мэдээллийг инженерийн эцсийн шийдвэр мэт үзэх нь Master-д тохирохгүй.

## Decision

1. BestCode-ийг private, owner-first **Personal Creation OS** гэж тодорхойлно.
2. North Star нь phone-only verified outcome байна.
3. AI provider-ууд canonical state эзэмшихгүй; BestCode role, context, policy, evidence, budget-ийг удирдана.
4. Second Brain нь Owner Intent, Project Brain, World Evidence, Asset Graph гэсэн тусдаа boundary-тай байна.
5. Mission бүрийн гарцыг reusable/exportable Asset болгох боломжтой schema хэрэглэнэ.
6. Approval нь raw code diff-ээс өмнө semantic outcome, preview, evidence, risk, cost, rollback харуулна.
7. Core/critical өөрчлөлт independent review эсвэл owner-ийн explicit waiver шаардана.
8. Web Research нь search → source → claim → cross-check → dossier гэсэн evidence pipeline байна.
9. Safety-critical бодит шийдвэр qualified review gate-ийг тойрохгүй.
10. Non-main deployment production traffic авахыг хориглоно.
11. AI/search/runner/storage vendor бүр adapter boundary-тай байна.
12. Ownership, privacy, retention, export, restore нь бүтээгдэхүүний үндсэн feature байна.
13. Public SaaS-аас өмнө owner-ийн 20 дараалсан бодит mission-оор системийг батална.

## Why this can win

BestCode Cursor-ийн editor, Replit-ийн idea-to-app, VS Code-ийн ecosystem, Codex-ийн agent execution-ийг бүхэлд нь дахин бүтээх шаардлагагүй. Тэдгээрийн чадварыг tool/provider хэлбэрээр ашиглаж болно. Харин owner-ийн зорилго, project truth, world evidence, approval, asset ownership-ийг нэгтгэсэн давхарга нь BestCode-ийн хамгаалагдах онцлог байна.

## Consequences

### Positive

- AI солигдсон ч project ба personal knowledge үлдэнэ.
- Software-аас гадуурх бодит creation mode нэмэх архитектуртай болно.
- Код мэдэхгүй owner meaningful шийдвэр гаргаж чадна.
- Судалгаа citation болон contradiction-тэй болно.
- Нэг удаагийн ажил дараагийн mission-д compound хийдэг asset болно.

### Cost

- UI-аас өмнө schema, evidence, policy, orchestration-д хөрөнгө оруулна.
- “AI өөрөө бүгдийг хийнэ” гэдэг хурдан demo-оос илүү олон safety gate хэрэгтэй.
- Cross-provider review, browser, runner, storage нь зардалтай; budget routing шаардлагатай.
- Personal memory нь privacy/export/retention engineering шаардана.

### Constraint

- v1-ийн GitHub `main`, safe branch, approval, Project Brain суурийг хаяхгүй.
- Existing PWA/Worker/repository-гээ өргөжүүлнэ; тусдаа шинэ BestCode app эхлүүлэхгүй.
- Target architecture-ийг production дээр нотлоогүй бол LIVE гэж тэмдэглэхгүй.

## Supersession

BC-001…BC-007 хүчинтэй хэвээр. Энэ ADR тэднийг устгахгүй, бүтээгдэхүүний хүрээ болон safety contract-ийг BC-008…BC-020-оор өргөжүүлнэ.

Энэ шийдвэрийг өөрчлөх бол энэ файлыг устгахгүй. Шинэ ADR үүсгэж `status: superseded`, шинэ decision ID, migration impact болон owner approval-ийг заана.
