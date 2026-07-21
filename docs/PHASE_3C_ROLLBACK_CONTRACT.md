# Phase 3C — Exact rollback request contract

Status: implemented as a bounded request-only package.

## Owner-visible contract

The Settings rollback card requires values copied from the latest immutable rollback-plan artifact:

- exact Worker (`best-code-ide` or `best-code-ide-appl`);
- exact Cloudflare version ID;
- exact 40-character target commit SHA;
- incident note;
- expected smoke outcome.

## Safety boundary

Creating the request:

- pins the operation to the current GitHub `main` SHA;
- rejects the current main SHA as a rollback target;
- creates a 30-minute high-risk approval;
- stores exact Worker/version/target/current-main reasons;
- requires restore and smoke evidence;
- does **not** dispatch GitHub Actions;
- does **not** switch Cloudflare traffic.

Approval alone still does not execute rollback. Actual rollback/rehearsal remains an irreversible production action using the existing `rollback-rehearsal.yml` controller and requires an explicit owner execution boundary, exact approved context, smoke, restore, and incident evidence.

## Exit evidence

- OpenAPI action: `rollback_request`;
- PWA owner card: `RollbackRequestCard`;
- request is visible in the existing semantic approval history;
- Test and Validate must pass before merge.
