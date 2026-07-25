---
document: BestCode Threat Model
version: 1.0.0
status: ACTIVE
owner: Enkhbat
updated_at: 2026-07-19
review_after: Phase 2.1
---

# BestCode — Threat Model

## 1. Scope ба бодит өнөөгийн төлөв

BestCode production Worker нь Bearer `AUTH_TOKEN` шалгалттай, GitHub/DeepSeek secret server-side хадгалдаг, project allowlist болон approval-gated write foundation-тэй. Иймээс “auth огт байхгүй” гэж үзэх нь буруу.

Гэхдээ shared bearer token нь per-client identity, capability scope, revocation, rate limit, replay protection-ийг дангаараа шийдэхгүй. Энэ threat model нь одоогийн single-owner system болон target Personal Creation OS хоёрыг хамарна.

## 2. Хамгаалах хөрөнгө

- GitHub repository, branch, commit, workflow, release;
- Cloudflare Worker/PWA deployment ба traffic routing;
- GitHub, AI provider, Cloudflare болон future integration secret;
- Owner Intent, personal memory, project context;
- Source/Claim/Evidence/Asset ба тэдгээрийн integrity;
- approval, task, lease, audit log;
- browser session, cookie, uploaded document;
- runner compute, budget, API quota;
- бодит амьдралын safety ба owner-ийн мөнгө/нэр хүнд.

## 3. Итгэлийн хил

```text
Owner device / PWA
  ↕ authenticated API
Worker policy & evidence gate
  ↕ scoped provider APIs
GitHub | AI providers | Search | Browser | Runner | Storage
  ↕ untrusted content
Web pages | repositories | logs | uploads | generated code
```

## Chat 11 bounded-write credential addendum

The `subscription-write-bounded-v1` profile introduces repository mutation authority, so possession of its raw bearer is treated as a P0 capability.

New fail-closed controls:

- a maximum two-hour lifetime, with a 30-minute default;
- one-time raw-secret display and hash-only storage;
- authoritative project/Mission/plan/task/attempt/lease/fencing/agent/provider binding;
- exact branch and base-SHA binding;
- allowed-tool and path allowlists plus protected-path deny rules;
- file, byte, operation, commit, push, and draft-PR limits;
- deterministic scope hash and idempotency namespace;
- immediate owner revoke and lease-expiry denial;
- no merge, deploy, rollback, credential administration, approval, secret, or arbitrary-shell tool.

Threats explicitly covered include stolen credential replay, provider or agent spoofing, cross-project and cross-Mission reuse, stale lease or fencing-token reuse, stale-source overwrite, branch switching, path traversal and protected-path mutation, partial continuation after a limit, and secret disclosure through storage or status responses.

Trust boundary бүрт identity, capability, validation, audit, timeout, data classification байна. “AI ойлгоно” бол security control биш.

## 4. Actor

- legitimate owner;
- connected AI/provider;
- compromised provider account/session;
- malicious repository contributor/dependency;
- malicious web publisher;
- stolen Bearer token holder;
- supply-chain attacker;
- accidental operator/AI mistake;
- abusive external caller/bot.

## 5. Threat register

### T1 — Shared Bearer token алдагдах — P0

**Attack:** token авсан этгээд owner мэт API дуудна.

**Current control:** Bearer check, project allowlist, approval-gated writes, server-side secrets.

**Gap:** client identity, fine-grained capability, device/session revoke, rate limit, replay detection сул.

**Required:** token rotation runbook, hashed token identifiers, per-client credential/OAuth design, scoped short-lived session, rate limit, anomaly/audit, secret redaction.

### T2 — Prompt injection via repository/web/document — P0

**Attack:** source content AI-д policy-г үл тоох, secret/tool ашиглах instruction өгнө.

**Required:** untrusted content separation, instruction/data boundary, least-capability tool context, injection flag, output validation, critical operation owner approval, conformance corpus.

### T3 — Non-main branch production traffic / unverifiable source — P0

**Observed integrity finding:** Git-integrated Cloudflare deployment history-д PR branch version merge-ээс өмнө харагдсан. Тухайн үед active traffic → branch/SHA mapping durable evidence-д бичигдээгүй тул production traffic авсан эсэхийг одоо баттай дүгнэх боломжгүй. Cloudflare-ийн documented default нь non-production branch-д preview version upload хийх боловч actual trigger configuration-ийг audit хийгээгүй.

**Required:** actual build trigger audit, production environment source restriction, branch preview тусдаа URL, traffic/source assertion, approved main SHA allowlist, deployment evidence, mismatch auto-rollback, release pause.

### T4 — CI/workflow privilege escalation — P0

**Attack:** `.github/workflows/**`, deploy config, scripts, dependency lifecycle hook өөрчилж secret/production access авна.

**Required:** `class:critical`, independent review, CODEOWNERS/branch protection боломжтой үед, workflow permission minimization, SHA-pinned actions, untrusted PR-д secret өгөхгүй, policy diff detector.

### T5 — Approval confusion, stale decision, replay — P0

**Attack/accident:** owner өөр зүйл гэж ойлгон approve хийх; base/context/price өөрчлөгдсөн approval execute болох; approve endpoint давтан дуудагдах.

**Observed UX defect:** approved operation дээр UI дахин decision илгээж `Operation cannot be decided from status approved` алдаа харуулсан.

**Required:** semantic card, exact hash binding, TTL, terminal button state, idempotency key, one-time execute, stale invalidation, decision audit.

**Phase 2.1B control:** PWA terminal state/disabled buttons, stable decision idempotency
key, Durable Object exact-replay no-op, owner-visible TTL/context SHA, мөн branch/file/
deployment context өөрчлөгдвөл write/dispatch-аас өмнө `superseded` invalidation нэмэгдсэн.
Full semantic card, capability identity, audit/evidence event болон generic execution lease
нь дараагийн gate хэвээр.

### T6 — Secret/data leakage — P0

**Path:** log, diagnostics, source snapshot, model prompt/response, screenshot, error, artifact export.

**Required:** data classification, redaction before persistence/model, canary fixtures, no raw secret in evidence, bounded logs, private artifact ACL, incident rotation.

### T7 — Research SSRF/egress abuse — P0 before Research Agent

**Attack:** `source_read` private IP, metadata service, credential URL, redirect/rebinding, giant file руу fetch хийнэ.

**Required:** protocol/IP/DNS/redirect policy, byte/time cap, content-type validation, isolated acquisition service, audit, deny-by-default authenticated origins.

### T8 — Browser session abuse — P1 before authenticated browser

**Attack:** AI account setting солих, order/payment илгээх, cookie exfiltrate хийх, download malware.

**Required:** owner-controlled login, credential isolation, domain/action scope, visible browser, transaction checkpoint, download quarantine, session expiry, recording/audit with privacy controls.

### T9 — Preview/runner/container escape — P1 before Phase 7

**Attack:** generated code host/network/secret рүү хандах, crypto mining, fork bomb, malicious package script.

**Required:** ephemeral VM/container, no host socket, read-only base, per-task secret, egress allowlist, CPU/memory/disk/time/process cap, lifecycle-hook policy, destroy-on-finish, abuse monitoring.

### T10 — Supply-chain compromise — P1

**Attack:** malicious dependency, typosquat, GitHub Action, CDN import, compromised update.

**Required:** lockfile, integrity, dependency diff/risk, allow/deny policy, provenance/SBOM target, SHA-pinned critical action, vulnerability scan, minimal dependencies.

### T11 — Project/owner data mixing — P1

**Attack/bug:** BestCode memory/source/approval нь Czech app эсвэл future project-т буруу очих.

**Required:** namespace at storage key and query layer, project in signed context, cross-project negative tests, no implicit default for writes, export boundaries.

### T12 — Compromised or conflicting AI provider — P1

**Attack:** provider malicious output, instruction deviation, account takeover, data retention concern.

**Required:** provider is untrusted planner, policy enforced outside model, least capability, independent reviewer for critical, context minimization, provider kill switch, no canonical state in provider memory.

### T13 — Denial of wallet / resource exhaustion — P1

**Attack/accident:** infinite research loop, repeated build/browser/model calls, huge context/artifacts.

**Required:** mission budget, per-tool cap, recursion/depth cap, cached source, concurrency limit, soft warning/hard stop, cancel, actual-cost evidence.

### T14 — Evidence tampering/fake completion — P1

**Attack:** AI “tests passed” гэж зохиох, log/artifact солих, wrong SHA deployment-ийг success гэж тайлагнах.

**Required:** trusted producer, checksums, append-only events, acceptance→evidence mapping, active traffic/source assertion, immutable artifact refs.

### T15 — Unsafe real-world recommendation — P0 for Engineering Assist

**Attack/accident:** forum/AI мэдээллээр барилга, машин, химийн бодис, цахилгаан дээр аюултай action хийх.

**Required:** domain classification, assumption/standard/jurisdiction, qualified sign-off gate, owner warning/approval, refusal/block when input/review missing.

### T16 — Privacy, retention, backup failure — P1 before Personal Brain

**Attack/accident:** personal memory хэт их хадгалах, deletion/export ажиллахгүй, backup алдагдах, AI-д бүх profile өгөх.

**Required:** explicit memory intent, minimization, sensitivity label, retention UI, encrypted storage/transport, export/delete/restore tests, context packet scoping.

### T17 — Malicious/incorrect update ба rollback failure — P1

**Attack/accident:** stale service worker, bad PWA cache, incompatible schema, previous-good байхгүй.

**Required:** signed/versioned release metadata target, cache migration, stale-tab guard, previous-good release, schema compatibility, rollback drill.

### T18 — Physical device/session loss — P1

**Attack:** unlocked phone/PWA token ашиглах.

**Required:** device/session revoke, local secure storage, biometric/OS gate where feasible, short session for critical action, no token in screenshot/export, recovery procedure.

## 6. Phase 2.1 security floor — exit gate

Production feature workээс өмнө:

- [x] non-main production traffic техникийн түвшинд блоклогдсон;
- [x] active deployment SHA/source evidence endpoint байна;
- [ ] shared token rotation хийж болох runbook ба leak-free logs;
- [ ] rate limit + request size/time limit;
- [ ] idempotency/replay protection бүх critical execution-д (decision replay control implemented);
- [ ] terminal approval UI production observation (code/build implemented);
- [ ] `.github/workflows/**`, auth, policy, deploy config critical class;
- [ ] evidence record v1 + redaction fixtures;
- [ ] threat/conformance test CI-д;
- [ ] current CORS/origin allowlist reviewed;
- [x] incident response ба previous-good rollback drill.

Research Agent enable хийхээс өмнө T2/T7/T13; remote runner enable хийхээс өмнө T6/T9/T10/T13; Personal Brain enable хийхээс өмнө T11/T16/T18 gate заавал ногоон байна.

## 7. Residual risk

Одоогийн single-owner foundation-д түр хүлээн зөвшөөрч буй эрсдэл:

- shared Bearer token per-client identity биш;
- production source lock болон rollback drill нотлогдсон ч GitHub/Cloudflare provider
  availability ба continuous audit ажиллагаанаас хамаарна;
- audit/evidence schema v1 хараахан хэрэгжээгүй;
- PWA token device security нь browser/PWA storage-аас хамаарна;
- no remote runner/browser research yet, тиймээс тэдгээрийн risk latent.

Эдгээрийг “аюулгүй” гэж хаахгүй. `/docs/PROJECT_STATUS.md` дээр open gap хэвээр хадгална.

## 8. Incident severity

- **SEV-0:** secret compromise, unauthorized production/data/external transaction, physical safety event.
- **SEV-1:** wrong source production traffic, critical policy bypass, cross-project leak, false safety gate.
- **SEV-2:** stale approval blocked after attempt, cost cap breach without external damage, rollback degradation.
- **SEV-3:** UI/state mismatch, non-sensitive evidence gap, recoverable availability issue.

SEV-0/1 үед autonomous writes pause, credential/session containment, previous-good restore, owner notice, evidence preservation, root-cause ADR/action шаардана.

## 9. Review triggers

Threat model-ийг дараах бүрт version bump хийнэ:

- шинэ provider/search/browser/runner/storage холбох;
- authenticated browsing/payment/external messaging нэмэх;
- personal memory эсвэл шинэ data class хадгалах;
- public/multi-user access нээх;
- security incident;
- critical architecture/permission өөрчлөх.
