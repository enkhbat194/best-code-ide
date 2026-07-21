# Phase 2.1C — Rate limit, origin policy, and security audit foundation

## Scope

Энэ багц дараах P0 хамгаалалтыг нэмнэ:

- client/IP-based bounded request rate limiting;
- `RATE_LIMIT_REQUESTS` болон `RATE_LIMIT_WINDOW_MS` тохиргоо;
- `CORS_ALLOWED_ORIGINS` browser origin allowlist;
- origin, request-size, rate-limit, authorization rejection бүрт redacted structured security audit event;
- regression tests.

## Default behavior

- authenticated route бүрт 60 секундэд 120 хүсэлт;
- `/health` болон `/openapi.json` rate limit-ээс тусдаа;
- `CORS_ALLOWED_ORIGINS` тохируулаагүй үед одоогийн integration compatibility хадгалагдана;
- allowlist тохируулсан үед browser `Origin` заавал жагсаалтад байна;
- server-to-server, ChatGPT Actions, Claude MCP шиг `Origin` header-гүй client зөвшөөрөгдөнө.

## Audit event

Worker log-д дараах хэлбэрийн redacted JSON event бичигдэнэ:

```json
{
  "type": "bestcode.security.audit",
  "event": "authorization_rejected",
  "occurred_at": "ISO-8601",
  "details": {
    "path": "/api/tasks",
    "method": "POST",
    "client": "ip:..."
  }
}
```

Authorization, token, API key, cookie, password болон provider secret утга audit event-д хадгалагдахгүй.

## Deliberate exclusions

Энэ foundation нь global/distributed exact quota биш. Cloudflare isolate-local limiter нь immediate abuse blast radius-ийг бууруулна. Дараагийн production package-д Durable Object эсвэл Cloudflare rate-limit binding дээр distributed enforcement, audit export retention, owner-visible security report нэмнэ.

Strict allowlist-ийг production-д идэвхжүүлэхээс өмнө PWA, ChatGPT Actions, Claude MCP болон preview origin inventory-г баталгаажуулна.
