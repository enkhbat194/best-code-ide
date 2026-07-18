---
decision: BC-001..BC-007
status: accepted
accepted_at: 2026-07-19
owner: Enkhbat
master_version: 1.0.0
supersedes: []
---

# Project Brain болон AI-уудын үүрэг

## Context

BestCode-ийн зорилго нь хэрэглэгчээр Git, branch, commit, CI зэрэг техникийн ажлыг хийлгэх биш. ChatGPT, Claude болон PWA доторх DeepSeek өөр өөр chat memory, өөр өөр ойлголтоор ажиллавал төслийн зорилго зөрөх, хийсэн ажлыг дахин хийх, баталгаагүй төлөвийг үнэн гэж үзэх эрсдэлтэй.

## Decision

1. ChatGPT Actions болон Claude MCP нь үндсэн external coding agent байж болно.
2. DeepSeek нь PWA-ийн local workspace ба Preview diagnostics-д төвлөрсөн нэмэлт туслах байна.
3. Бүх connected AI нэг canonical Project Brain, durable task lifecycle болон handoff ашиглана.
4. GitHub `main` дахь код ба canonical баримт нь эхний source of truth байна.
5. Dynamic task/handoff metadata нь GitHub, CI, deployment evidence-ийг орлохгүй.
6. Хэрэглэгч coherent change set, production deployment, устгал зэрэг бодит эрсдэлтэй шийдвэрт л ойлгомжтой approval өгнө.
7. Locked Master-ийг зөвхөн owner-ийн explicit approval, version bump, PR/CI/merge-ээр өөрчилнө.

## Consequences

- AI солигдсон ч task ба context-оос ажлыг үргэлжлүүлэх боломжтой.
- Chat summary дангаараа completion evidence болохгүй.
- PWA нь AI-ийн өрсөлдөгч биш, mobile control/workspace surface байна.
- Canonical memory write нь high-risk operation гэж ангилагдана.

## Supersession rule

Энэ шийдвэрийг өөрчлөх бол энэ файлыг устгахгүй. Шинэ decision record үүсгэж, энд `status: superseded` болон шинэ ID-г заана.
