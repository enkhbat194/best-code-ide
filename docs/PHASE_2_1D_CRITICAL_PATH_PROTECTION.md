# Phase 2.1D — Critical-path protection

## Scope

This package establishes one deterministic path classifier for files that can alter BestCode's source of truth, authentication, CI/release behavior, production runtime, or dependency supply chain.

## Policy rules

| Rule | Class | Examples | Required handling |
|---|---|---|---|
| `BC-R31` | Canonical source | `BESTCODE_MASTER.md`, roadmap/status/architecture, `docs/DECISIONS/*` | core/critical review + explicit owner approval |
| `BC-R32` | Security/auth | backend auth/security modules and credential-related types | core/critical review + negative tests |
| `BC-R33` | Workflow/release | `.github/workflows/*` | core/critical review + workflow conformance |
| `BC-R34` | Deploy/runtime | Wrangler, deploy, release, rollback paths | core/critical review + rollback evidence |
| `BC-R35` | Dependency control | manifests, lockfiles, compiler/build config | core/critical review + dependency/build validation |
| `BC-R30` | Ordinary | non-matching application paths | normal review policy |

## Current delivery

- deterministic path normalization;
- exact rule ID and reason for every finding;
- batch classification with duplicate removal;
- owner-readable policy error listing exact rules and paths;
- unit tests covering critical and ordinary paths.

## Next integration slice

The classifier will be connected to staged repository changes so operations containing any critical finding automatically become `high` risk, display the exact `BC-R3x` rule, and cannot be delivered without the core/critical review contract.

## Deliberate exclusions

This foundation does not yet change existing approval behavior or deployment. Integration, conformance workflow, and incident severity/runbook remain separate bounded commits on this Phase 2.1D branch.
