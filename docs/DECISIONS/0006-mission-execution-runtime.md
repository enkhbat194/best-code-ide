---
decision_id: BC-040
title: Mission Execution Runtime foundation
status: accepted
accepted_at: 2026-07-24
owner: Enkhbat
risk: core/critical
---

# BC-040 — Mission Execution Runtime foundation

BestCode нь model session биш, Mission execution state-ийн authoritative control plane байна.
Provider-neutral Execution Plan нь immutable version, context version/hash, deterministic hash,
safety constraint, approval gate, task ID болон dependency DAG хадгална. Plan өөрчлөгдвөл хуучныг
overwrite хийхгүй; version өсгөж `supersedes_plan_id`-аар холбоно.

Execution Task нь Mission v1-ийн lifecycle болон existing Project Task-ийг орлохгүй. Mission v1
owner objective/context-ийн root хэвээр, execution task нь түүн дээрх жижиг, lease-ээр эзэмших
ажлын нэгж байна. Hard dependency амжилтгүй бол downstream task автоматаар ажиллахгүй; optional
dependency нь мэдээллийн холбоос байж болно.

Task state:

`planned → blocked|ready → leased → running → waiting_for_input|waiting_for_approval|succeeded|failed|cancelled`

Terminal task-ийг дахин нээхгүй. Retry бүр шинэ Attempt үүсгэнэ. Lease байхгүй task `running`
болохгүй. Approval-required task owner approval-гүй үргэлжлэхгүй. Model/provider/agent text нь
permission эсвэл completion evidence болохгүй.

Нэг task-ийг нэг мөчид нэг agent lease эзэмшинэ. Fencing token stale update-ийг хориглоно.
Repository writer lease тусдаа бөгөөд write task аль алиныг нь хангана. Merge, deploy, rollback,
credential/permission, paid resource, destructive delete болон irreversible migration нь owner-only
approval gate хэвээр. Энэ ADR automatic merge/deploy/rollback болон paid provider-ийг нээхгүй.
