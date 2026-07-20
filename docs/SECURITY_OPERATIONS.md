# BestCode Security Operations

Status: Phase 2.1C foundation

## 1. Authentication coverage matrix

| Route class | Public | Authentication |
|---|---:|---|
| `GET /health` | yes | none; no secret data |
| `GET /openapi.json` | yes | none; schema discovery only |
| `OPTIONS *` | yes | CORS preflight only |
| `/mcp` | no | Bearer token or compatibility `?key=` token |
| `/api/actions/*` | no | Bearer token |
| `/api/approvals/*` | no | Bearer token |
| `/api/tasks/*` | no | Bearer token |
| `/api/maintenance/*` | no | Bearer token |
| `/api/release/*` | no | Bearer token |
| `/api/chat`, `/api/llm` | no | Bearer token |
| `/api/files/*`, `/api/workspace/*` | no | Bearer token |
| legacy REST routes | no | Bearer token plus feature policy where applicable |

Шинэ protected route-ийг global authorization gate-ийн өмнө байрлуулахгүй. Public route нэмэх бүр threat review, response data review болон regression test шаардана.

## 2. Request body limits

Default limits:

| Route class | Default |
|---|---:|
| ordinary JSON mutation | 1 MiB |
| chat, LLM, MCP context | 2 MiB |
| single file/staged commit payload | 5 MiB |
| workspace export payload | 10 MiB |

Environment overrides:

- `MAX_REQUEST_BYTES`
- `MAX_CHAT_REQUEST_BYTES`
- `MAX_FILE_REQUEST_BYTES`
- `MAX_WORKSPACE_REQUEST_BYTES`

Эдгээр нь repository-ийн нийт хэмжээний хязгаар биш. Нэг HTTP request-ийн body envelope юм. Том төсөл file-by-file, staged batch, chunked upload эсвэл тусдаа artifact storage-аар ажиллана.

Limit-ийг өсгөхдөө:

1. route-ийн бодит payload хэмжээг хэмжих;
2. memory/CPU/cost нөлөөг шалгах;
3. нэг удаагийн том JSON-оос chunk/batch/upload замыг давуу үзэх;
4. regression болон oversized negative test нэмэх;
5. production variable өөрчлөлтийг owner-visible operation болгох.

## 3. Token rotation runbook

`AUTH_TOKEN` нь BestCode-ийн protected Worker routes-ийн одоогийн shared credential.

Rotation дараалал:

1. Шинэ хүчтэй random token үүсгэнэ. Token-ийг repository, chat, log, screenshot-д бичихгүй.
2. Cloudflare secret binding дээр `AUTH_TOKEN`-ийг шинэчилнэ.
3. ChatGPT Action, Claude MCP болон зөвшөөрөгдсөн client бүрийн credential-ийг шинэчилнэ.
4. `/health` болон `/openapi.json` public хэвээр байгааг шалгана.
5. Хуучин token protected route дээр `401` авч байгааг шалгана.
6. Шинэ token-оор MCP, Actions, task read болон нэг safe read smoke ажиллуулна.
7. Audit note-д token утга биш, rotation time, actor, verification evidence-г хадгална.
8. Client шинэчлэлт бүрэн дуусаагүй бол old/new dual-token дэмжлэгийг чимээгүй нэмэхгүй; тусдаа approval бүхий migration design хийнэ.

Сэжигтэй credential exposure үед rotation-ийг incident гэж үзэж, log/evidence redaction audit болон access review давхар хийнэ.

## 4. Redaction contract

Дараах мэдээллийг owner-facing diagnostics, log, evidence болон model context-д бүтнээр нь гаргахгүй:

- `Authorization` болон Bearer token;
- API key, access/refresh token;
- password, cookie, private key, secret;
- GitHub/provider common token patterns;
- URL query дахь `key`, `token`, `api_key`, `access_token`, `auth`.

Machine evidence-д secret-ийн оронд `[REDACTED]` тэмдэглэгээ үлдээнэ. Ингэснээр redaction болсон нь харагдана, гэхдээ credential алдагдахгүй.

## 5. Энэ багцад зориуд оруулаагүй

- distributed Durable Object rate limiter;
- scoped OAuth/capability tokens;
- strict production CORS allowlist migration;
- append-only audit export;
- file upload/object storage;
- request body streaming enforcement.

Эдгээрийг тусдаа хэмжигдэхүйц багцаар, ChatGPT Actions болон Claude MCP compatibility-г эвдэхгүйгээр хэрэгжүүлнэ.
