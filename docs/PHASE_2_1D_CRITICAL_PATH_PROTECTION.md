# Phase 2.1D — Critical Path Protection

## Owner outcome

Canonical source, authentication, CI/release, deployment/runtime болон dependency control файлууд жирийн UI өөрчлөлттэй адил эрсдэлээр дамжихгүй. Staged change бүр shared policy classifier-аар шалгагдаж, critical файл орсон бол approval operation автоматаар `high` risk болно.

## Rule IDs

| Rule | Class | Examples |
|---|---|---|
| `BC-R31` | canonical source | `BESTCODE_MASTER.md`, Roadmap, Status, Architecture, Decisions |
| `BC-R32` | security/auth | auth, security, credential-handling paths |
| `BC-R33` | workflow/release | `.github/workflows/**` |
| `BC-R34` | deploy/runtime | Wrangler, deploy, release, rollback controls |
| `BC-R35` | dependency control | manifests, lockfiles, TypeScript/Vite build config |
| `BC-R30` | ordinary | no critical rule matched |

## Enforcement point

`approvalClient.createApproval()` бүх approval producer-ийн shared boundary. Persistence хийхээс өмнө `applyCriticalPathRisk()` ажиллана. Ингэснээр MCP staged writes, mobile REST staged file change болон shared approval client ашиглах дараагийн producer ижил policy хэрэглэнэ.

Critical path илэрвэл:

- `risk = high`;
- existing risk reasons хадгалагдана;
- `critical_path:BC-Rxx` reason нэмэгдэнэ;
- `critical_path_file:<path>` reason нэмэгдэнэ;
- duplicate reason арилна.

Ordinary staged change existing risk болон reasons-оо хэвээр хадгална.

## Conformance workflow

`.github/workflows/critical-path-conformance.yml` нь critical source өөрчлөгдөх pull request дээр classifier/integration tests болон backend typecheck ажиллуулна. Existing `Test` болон `Validate` workflow мөн merge gate хэвээр.

## Review contract

Critical change merge хийхийн өмнө explicit owner approval, exact rule/path evidence, green CI, source SHA/context revalidation, main-only deployment болон post-deploy smoke шаардлагатай.

## Incident severity

- SEV-1: unauthorized production deploy, leaked credential, approval bypass.
- SEV-2: critical path ordinary гэж буруу ангилагдах, stale approval deliver хийх, rollback unavailable.
- SEV-3: owner-visible risk metadata дутуу боловч underlying approval хамгаалалт ажилласан.

SEV-1/2 үед mutation зогсоож, token/source/active SHA шалган, previous-good rollback plan ашиглаж, redacted incident evidence хадгална.

## Exit evidence

- бүх critical fixture зөв `BC-Rxx` rule авна;
- ordinary fixture `BC-R30` хэвээр;
- staged critical operation `high` risk болно;
- exact rule/path reason operation-д хадгалагдана;
- shared approval producer coverage болон conformance workflow ногоон;
- production deploy дараа ordinary ба critical canary staging smoke батлагдана.

## Next package

Phase 2.1D production closeout evidence дууссаны дараа Phase 3A Version/update contract эхэлнэ. Шинэ chat handoff: `docs/HANDOFF_NEXT_CHAT.md`.
