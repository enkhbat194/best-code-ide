---
document: BestCode Evidence Standard
version: 1.0.0
status: LOCKED-BY-MASTER-2.0.0
owner: Enkhbat
updated_at: 2026-07-19
---

# BestCode — Evidence, Approval & Rollback Standard

## 1. Яагаад evidence хэрэгтэй вэ?

AI-ийн “хийчихлээ”, “ажиллана”, “аюулгүй” гэсэн өгүүлбэр бол claim. BestCode-ийн completion нь machine болон human evidence-д тулгуурлана.

Evidence дараах асуултад хариулна:

- Яг ямар goal/acceptance criteria шалгасан бэ?
- Ямар version/context дээр шалгасан бэ?
- Хэн, ямар trusted tool ажиллуулсан бэ?
- Ямар үр дүн гарсан бэ?
- Log/artifact хаана, checksum нь юу вэ?
- Энэ evidence одоо хүртэл хүчинтэй юу?
- Алдаа гарвал аль previous-good state рүү буцах вэ?

## 2. Evidence-ийн төрөл

| Type | Producer | Жишээ |
|---|---|---|
| `source` | research acquisition service | page hash, source metadata |
| `claim_check` | verifier + source graph | supporting/contradicting claim |
| `test` | CI/runner | unit/integration/e2e conclusion |
| `build` | CI/runner | build artifact, checksum |
| `preview` | preview/browser | URL, screenshot, console/network result |
| `review` | independent AI/human | criteria-based review verdict |
| `approval` | owner/policy UI | exact operation decision |
| `release` | deployment provider/Worker | source SHA → deployment version |
| `observation` | owner/telemetry | real-use outcome, defect, metric |
| `rollback` | release controller | previous-good restore result |
| `specialist_signoff` | qualified person | domain, scope, assumptions, date |

AI prose `test_passed: true` гэж бичсэн нь `test` evidence биш.

## 3. Canonical Evidence Record

```yaml
evidence_id: ev_...
schema_version: 1
type: test
project_id: bestcode
mission_id: mis_...
task_id: tsk_...
operation_id: op_...
producer:
  actor_type: worker | runner | browser | ci | owner | reviewer | specialist
  actor_id: string
  tool: string
  tool_version: string
scope:
  repository: enkhbat194/best-code-ide
  branch: agent/example
  commit_sha: string | null
  deployment_version: string | null
  source_ids: []
integrity:
  input_hash: sha256:...
  context_hash: sha256:...
  policy_hash: sha256:...
  artifact_hashes: []
execution:
  started_at: datetime
  finished_at: datetime
  environment: string
  command_or_check: string
  exit_code: number | null
  conclusion: success | failure | neutral | blocked
outputs:
  summary: string
  artifact_refs: []
  bounded_log_ref: string | null
security:
  redaction_applied: true
  sensitivity: public | internal | private | secret
validity:
  expires_at: datetime | null
  invalidated_by: string | null
rollback:
  previous_good_ref: string | null
  procedure_ref: string | null
```

## 4. Integrity

- Evidence нь append-only event байдлаар үүснэ; засварлахын оронд шинэ evidence өмнөхийг supersede/invalidates хийнэ.
- Artifact/log том бол immutable object storage-д, metadata ба checksum structured store-д байна.
- Approval, task, evidence бүр context/policy hash-тай байна.
- System clock, producer identity, schema version audit хийнэ.
- Secret-containing raw log хадгалахаас өмнө redaction хийнэ; redaction failure бол evidence publish block.
- AI evidence record-ийн protected fields-ийг өөрөө бичихгүй.

## 5. Acceptance Criteria Mapping

Mission contract:

```yaml
acceptance_criteria:
  - id: AC-01
    text: Installed PWA shows the new release version.
    required_evidence: [build, release, preview]
  - id: AC-02
    text: Previous good version can be restored.
    required_evidence: [rollback]
```

Completion report:

```yaml
criteria_results:
  - criterion_id: AC-01
    status: passed
    evidence_ids: [ev_build_1, ev_release_1, ev_preview_1]
  - criterion_id: AC-02
    status: passed
    evidence_ids: [ev_rollback_1]
```

Evidence байхгүй criterion `passed` болж болохгүй. `not_applicable` нь owner/reviewer reason-тэй байна.

## 6. Semantic Approval

Approval raw operation JSON эсвэл 500 мөр code diff-ээр owner-ийг төөрөгдүүлэхгүй.

### 6.1 Owner-facing card

1. **Goal** — таны хүссэн зүйл.
2. **Outcome preview** — яг юу өөрчлөгдөх/гарах.
3. **Verification** — test, preview, sources, reviewer.
4. **Impact** — project, files/data, production/users, external side effect.
5. **Risk & uncertainty** — known, unknown, residual risk.
6. **Cost & time** — spent + maximum next action.
7. **Rollback/stop** — буцаах арга ба previous-good state.

Advanced хэсэгт diff, SHA, commands, logs, source graph байна.

### 6.2 Approval binding

Approval дараах exact tuple-д хүчинтэй:

```text
owner + project + mission + operation + capability + target
+ base/context hash + artifact/change hash + budget + expiry
```

Эдгээрийн аль нэг materially өөрчлөгдвөл approval stale.

### 6.3 Decision status

`pending → approved | rejected | expired | superseded`

Approved operation execute эхэлсэн бол дахин approve/reject хийхгүй. UI нь terminal status-ийг харуулж товчийг disable хийнэ. Одоогийн branch cleanup UI-д илэрсэн `Operation cannot be decided from status approved` алдаа нь энэ contract хэрэгжээгүйг нотолсон defect бөгөөд Phase 2.1-д засна.

## 7. Risk-based approval

| Risk | Default behavior |
|---|---|
| Routine read/research | auto, audit only |
| Reversible draft/local edit | auto эсвэл batch notice |
| Repo staged change | coherent semantic approval |
| Core/policy/workflow | owner approval + independent review |
| Production/release | owner approval + previous-good + rollback proof |
| Delete/transaction/authenticated browser | owner approval immediately before action |
| Safety-critical real-world action | owner + qualified sign-off when applicable |

Approval fatigue нь security defect. Нэг outcome-ийг 30 жижиг approval болгон хуваахгүй; харин blast radius хэт том бол 2–4 meaningful stage болгоно.

## 8. Independent Review Record

Reviewer builder-ийн summary-г давтахгүй. Дараах checklist-ээр verdict өгнө:

- goal ба acceptance criteria бүрэн үү;
- diff/artifact scope тайлбартай таарч байна уу;
- core/critical boundary өөрчлөгдсөн үү;
- tests failure mode-ийг хамарсан уу;
- prompt injection/secret/permission risk байна уу;
- research claim source-той юу;
- rollback бодитоор ажиллах уу;
- residual risk owner-д ойлгомжтой юу.

Verdict: `approve`, `request_changes`, `block`, `approve_with_owner_waiver`.

## 9. Release evidence

Release бүр дараах chain-тэй:

```text
approved main commit SHA
→ CI run IDs and conclusions
→ build artifact hash
→ deployment version ID
→ active traffic percentage
→ health/smoke result
→ previous_good_sha/version
→ rollback drill/result
```

Cloud provider “deployment created” гэсэн нь production active болсон гэсэн үг биш. Traffic/source mapping evidence шаардлагатай.

Non-main branch production traffic авсан бол severity-high integrity incident нээнэ, traffic-ийг previous-good main руу буцааж, integration rule засагдах хүртэл release pause хийнэ.

### 9.1 Dynamic truth ба immutable history

Release evidence хоёр өөр үүрэгтэй байна:

- **Dynamic runtime truth** — одоогийн GitHub `main` HEAD, active deployment version,
  traffic, PWA asset/build ID-г API, provider metadata, Release & Integrity UI-аас
  тухайн мөчид query хийж авна.
- **Immutable historical event** — тодорхой PR/commit/build/deployment/smoke-ийн exact
  identifier, timestamp, checksum-ийг append-only evidence record-д хадгална.

Git-д хадгалсан status document өөрийнхөө одоогийн commit SHA-г “current” гэж claim
хийж болохгүй: уг document-ийг commit хийх үйлдэл SHA-г өөрчилж, claim-ийг шууд
хуучруулна. Ийм self-referential identifier нь runtime query эсвэл CI-аас гаргасан
immutable external evidence record байна. Historical release identifier-ийг тухайн
event-ийн нэр, огноо, scope-той нь хадгалж болно.

## 10. Research evidence

Research conclusion бүр:

- material claim IDs;
- supporting ба contradicting sources;
- retrieved date/freshness;
- source tier/independence;
- inference/assumption;
- jurisdiction/version;
- specialist review requirement;
- dossier checksum-тэй байна.

## 11. Rollback contract

Rollback нь “хуучин code байгаа” гэдэг тайлбар биш.

Release өмнө:

- previous-good version immutable reference;
- data/schema compatibility;
- rollback command/API path;
- secret/config dependency;
- expected recovery time;
- owner impact;
- rollback smoke test тодорхой байна.

Irreversible migration-д restore/forward-fix strategy, backup evidence, explicit critical approval шаардана.

## 12. Retention ба privacy

- Security/audit evidence-ийн minimum retention policy ADR-аар тогтооно.
- Personal/private research artifact owner-controlled retention-тэй.
- Secret evidence-д хадгалахгүй; secret reference ID ч шаардлагагүй бол хадгалахгүй.
- Export нь JSON/Markdown + checksums + artifact bundle байна.
- Delete нь tombstone/audit-тай; legal/security retention байвал owner-д ил харагдана.

## 13. Conformance tests

- AI fake evidence submit хийхэд protected producer татгалзана.
- Same idempotency key duplicate side effect үүсгэхгүй.
- Context hash өөрчлөгдөхөд approval stale болно.
- Expired approval execute болохгүй.
- Approved/terminal approval UI дахин decision илгээхгүй.
- Log redaction fixture бүр secret-ийг арилгана.
- Evidence checksum mismatch verification failure болно.
- Release source SHA `main`-тай таарахгүй бол production block.
- Rollback exercise active version-ийг previous-good руу сэргээнэ.
- Completion criterion evidence-гүй бол completed status block.
