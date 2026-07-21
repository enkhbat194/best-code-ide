---
decision_id: BC-037
title: Phase 2.1 production integrity and security floor closeout
status: accepted
accepted_at: 2026-07-21
owner: Enkhbat
risk: core
---

# BC-037 — Phase 2.1 closeout

## Шийдвэр

Phase 2.1 — Production Integrity & Security Floor нь Package A current-state verification болон Package B ordinary/critical canary evidence амжилттай дууссанаар `COMPLETED` болно.

## Баталгаажсан зүйл

- production source зөвхөн approved `main` commit байна;
- non-main branch production traffic авахгүй;
- previous-good backend/PWA rollback ба exact-current restore rehearsal амжилттай;
- approval terminal state, replay/idempotency, TTL болон stale-context invalidation хэрэгжсэн;
- request size limit, redaction foundation, security audit foundation хэрэгжсэн;
- canonical/auth/workflow/deploy/dependency path classifier shared approval boundary дээр ажиллана;
- ordinary staged operation `risk: normal` хэвээр;
- critical staged operation `risk: high` болж exact rule/path reason авна;
- Test, Validate болон Critical Path Conformance CI ногоон.

## Package B immutable GitHub evidence

- canary branch: `agent/phase-2-1d-live-canary-closeout`;
- canary head: `d0aa554ef8f30b5ba912845fea2550684f6122a3`;
- draft PR: `#31`, merge хийгдээгүй, evidence авсны дараа хаасан;
- ordinary fixture: `docs/canary/ordinary-fixture.txt` → `risk=normal`, operation `cancelled`;
- critical fixture: `backend/src/types.ts` → `risk=high`;
- exact reasons: `critical_path:BC-R32`, `critical_path_file:backend/src/types.ts`;
- critical operation `superseded`;
- delivery metadata үүсээгүй;
- Test run `29816541851`: success;
- Validate run `29816541966`: success;
- Critical Path Conformance run `29816541838`: success.

## Process deviation

Package B canary evidence нь BestCode production approval store-д удаан хадгалах canary operation үүсгэхийн оронд repository-ийн бодит classifier болон `ApprovalStore` state machine-ийг CI дээр ажиллуулсан. Энэ нь production delivery хийгээгүй, `main` өөрчлөөгүй, яг production code path-ийг ашигласан bounded evidence юм.

Энэ deviation нь live Durable Object audit event биш. Иймээс append-only evidence service болон distributed audit export нь дараагийн security/evidence package-ийн нээлттэй gap хэвээр.

## Дараагийн gate

Phase 3A — Version/update contract эхэлнэ. Editor, terminal, Research Agent, provider router эсвэл Agent Runtime merge рүү Phase 3A gate-ийг алгасаж орохгүй.
