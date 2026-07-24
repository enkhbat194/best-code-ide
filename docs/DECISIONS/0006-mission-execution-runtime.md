---
decision_id: BC-040
title: Mission Execution Runtime foundation
status: accepted
accepted_at: 2026-07-24
owner: Enkhbat
risk: core/critical
---

# BC-040 â€” Mission Execution Runtime foundation

BestCode Ð½ÑŒ model session Ð±Ð¸Ñˆ, Mission execution state-Ð¸Ð¹Ð½ authoritative control plane Ð±Ð°Ð¹Ð½Ð°.
Provider-neutral Execution Plan Ð½ÑŒ immutable version, context version/hash, deterministic hash,
safety constraint, approval gate, task ID Ð±Ð¾Ð»Ð¾Ð½ dependency DAG Ñ…Ð°Ð´Ð³Ð°Ð»Ð½Ð°. Plan Ó©Ó©Ñ€Ñ‡Ð»Ó©Ð³Ð´Ð²Ó©Ð» Ñ…ÑƒÑƒÑ‡Ð½Ñ‹Ð³
overwrite Ñ…Ð¸Ð¹Ñ…Ð³Ò¯Ð¹; version Ó©ÑÐ³Ó©Ð¶ `supersedes_plan_id`-Ð°Ð°Ñ€ Ñ…Ð¾Ð»Ð±Ð¾Ð½Ð¾.

Execution Task Ð½ÑŒ Mission v1-Ð¸Ð¹Ð½ lifecycle Ð±Ð¾Ð»Ð¾Ð½ existing Project Task-Ð¸Ð¹Ð³ Ð¾Ñ€Ð»Ð¾Ñ…Ð³Ò¯Ð¹. Mission v1
owner objective/context-Ð¸Ð¹Ð½ root Ñ…ÑÐ²ÑÑÑ€, execution task Ð½ÑŒ Ñ‚Ò¯Ò¯Ð½ Ð´ÑÑÑ€Ñ… Ð¶Ð¸Ð¶Ð¸Ð³, lease-ÑÑÑ€ ÑÐ·ÑÐ¼ÑˆÐ¸Ñ…
Ð°Ð¶Ð»Ñ‹Ð½ Ð½ÑÐ³Ð¶ Ð±Ð°Ð¹Ð½Ð°. Hard dependency Ð°Ð¼Ð¶Ð¸Ð»Ñ‚Ð³Ò¯Ð¹ Ð±Ð¾Ð» downstream task Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð°Ð°Ñ€ Ð°Ð¶Ð¸Ð»Ð»Ð°Ñ…Ð³Ò¯Ð¹; optional
dependency Ð½ÑŒ Ð¼ÑÐ´ÑÑÐ»Ð»Ð¸Ð¹Ð½ Ñ…Ð¾Ð»Ð±Ð¾Ð¾Ñ Ð±Ð°Ð¹Ð¶ Ð±Ð¾Ð»Ð½Ð¾.

Task state:

`planned â†’ blocked|ready â†’ leased â†’ running â†’ waiting_for_input|waiting_for_approval|succeeded|failed|cancelled`

Terminal task-Ð¸Ð¹Ð³ Ð´Ð°Ñ…Ð¸Ð½ Ð½ÑÑÑ…Ð³Ò¯Ð¹. Retry Ð±Ò¯Ñ€ ÑˆÐ¸Ð½Ñ Attempt Ò¯Ò¯ÑÐ³ÑÐ½Ñ. Lease Ð±Ð°Ð¹Ñ…Ð³Ò¯Ð¹ task `running`
Ð±Ð¾Ð»Ð¾Ñ…Ð³Ò¯Ð¹. Approval-required task owner approval-Ð³Ò¯Ð¹ Ò¯Ñ€Ð³ÑÐ»Ð¶Ð»ÑÑ…Ð³Ò¯Ð¹. Model/provider/agent text Ð½ÑŒ
permission ÑÑÐ²ÑÐ» completion evidence Ð±Ð¾Ð»Ð¾Ñ…Ð³Ò¯Ð¹.

ÐÑÐ³ task-Ð¸Ð¹Ð³ Ð½ÑÐ³ Ð¼Ó©Ñ‡Ð¸Ð´ Ð½ÑÐ³ agent lease ÑÐ·ÑÐ¼ÑˆÐ¸Ð½Ñ. Fencing token stale update-Ð¸Ð¹Ð³ Ñ…Ð¾Ñ€Ð¸Ð³Ð»Ð¾Ð½Ð¾.
Repository writer lease Ñ‚ÑƒÑÐ´Ð°Ð° Ð±Ó©Ð³Ó©Ó©Ð´ write task Ð°Ð»ÑŒ Ð°Ð»Ð¸Ð½Ñ‹Ð³ Ð½ÑŒ Ñ…Ð°Ð½Ð³Ð°Ð½Ð°. Merge, deploy, rollback,
credential/permission, paid resource, destructive delete Ð±Ð¾Ð»Ð¾Ð½ irreversible migration Ð½ÑŒ owner-only
approval gate Ñ…ÑÐ²ÑÑÑ€. Ð­Ð½Ñ ADR automatic merge/deploy/rollback Ð±Ð¾Ð»Ð¾Ð½ paid provider-Ð¸Ð¹Ð³ Ð½ÑÑÑ…Ð³Ò¯Ð¹.

