# BestCode — Production Architecture

## Product contract

Хэрэглэгч ChatGPT эсвэл Claude-д энгийн хэлээр ажлаа өгнө. AI нь BestCode-ийн project-scoped хэрэгслээр repository болон Project Brain-ийг уншиж, working branch дээр change set бэлтгэж, test/CI ажиллуулж, баталгаатай үр дүн хүргэнэ. PWA нь workspace, Preview, diagnostics, task status болон approval-ийг харуулна. DeepSeek нь апп доторх нэмэлт coding/diagnostics туслах байна.

## Logical flow

```text
User
 ├─ ChatGPT Actions ─┐
 ├─ Claude MCP ──────┼─> BestCode Cloudflare Worker
 └─ BestCode PWA ────┘          │
          │                      ├─ Project Brain / Durable task / Approval
          └─ DeepSeek API        ├─ GitHub repository / Pull Requests
                                 ├─ GitHub Actions build/test/deploy
                                 └─ Preview / diagnostics metadata
```

## Provider-neutral controller

ChatGPT Actions болон Claude MCP нь тусдаа business logic хэрэгжүүлэхгүй. Хоёулаа ижил tool definition болон executor ашиглана. DeepSeek/PWA ч боломжтой үед ижил project ID, branch policy, task ID, approval ID ашиглана.

## Project Brain layers

### Canonical layer

GitHub `main` дээрх version-controlled Markdown/JSON. Алсын хараа, architecture, status, roadmap, decision history хадгална.

### Dynamic layer

Cloudflare Durable Object storage. Project-scoped task, approval, handoff, diagnostics metadata хадгална. Энэ layer-ийн AI-reported төлөв нь GitHub/CI/deployment-ийн баталгааг орлохгүй.

### Context assembly

`project_context_get` нь canonical memory, одоогийн task/handoff болон project metadata-г bounded response болгон нэгтгэнэ. AI бүх repository-г сохроор дахин уншихын оронд энэ context-оос эхэлнэ.

`project_memory_search` нь зөвхөн configured canonical memory файлуудаас хайна. Эхний хувилбар Markdown/JSON дээр deterministic text search ашиглана; vector database шаардлагагүй.

## Repository change flow

```text
inspect
→ agent/<task> branch
→ stage coherent change set
→ user approval
→ prepare commit
→ fast-forward push
→ build + test
→ draft PR
→ merge
→ separate deployment approval
→ production verification
```

## Security boundaries

- GitHub/provider token frontend болон Project Brain-д хадгалахгүй.
- Project registry-ээс гадуур repository ашиглахгүй.
- `main/master` direct write/push блоклогдоно.
- Approval exact project, branch, base SHA болон change set-тэй холбоотой.
- Canonical memory change нь high-risk audit reason авна.
- Dynamic task/handoff нь source-of-truth priority-г өөрчилж чадахгүй.
- Project бүрийн memory тусдаа байна.

## Current deployment

- Backend Worker: `best-code-ide.enkhbat194.workers.dev`
- Git-integrated installed PWA: `best-code-ide-appl.enkhbat194.workers.dev`
- Manual frontend deployment target: `best-code-ide-app.enkhbat194.workers.dev`

