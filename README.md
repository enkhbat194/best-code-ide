# Best Code IDE

Утаснаас GitHub repository-г шинжилж, код хайж, олон файл уншиж/засаж, working branch үүсгэж, diff болон validation шалган, commit/push хийхэд зориулсан mobile-first AI coding agent PWA.

## Одоогийн v0.2 agent core

```text
ChatGPT Custom GPT Actions ─┐
Claude remote MCP ──────────┼── Best Code IDE Worker ── GitHub
Best Code IDE Chat ─────────┘            │
                                         └── validation workflow

GitHub repository ── import ── iPhone local workspace ── editor / local preview
```

### Хийгдсэн үндсэн чадвар

- **Repository inspection** — recursive tree, directory listing, code search
- **Multi-file context** — нэг дуудалтаар 12 хүртэл файл унших
- **Editing** — файл үүсгэх, шинэчлэх, устгах, GitHub commit хийх
- **Safe Git workflow** — branch жагсаах, working branch үүсгэх, branch diff харах
- **Validation** — GitHub Actions дээр frontend lint/build, backend typecheck ажиллуулах
- **External AI control**
  - ChatGPT Custom GPT Actions: `/openapi.json`
  - Claude болон MCP-compatible client: `/mcp`
- **Mobile local workspace** — GitHub-аас text/code файлуудыг IndexedDB руу import хийх
- **Local editor/preview** — CodeMirror + esbuild-wasm

## Бүтэц

```text
frontend/   React + Vite PWA — Chat / Files / Preview / Settings
backend/    Cloudflare Worker — AI agent + GitHub tools + MCP + REST
.github/    validation workflow
```

## Нууц түлхүүрүүд

Cloudflare Worker дээр:

```bash
cd backend
npm install
npx wrangler login
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put AUTH_TOKEN
npx wrangler deploy
```

`AUTH_TOKEN` нь Best Code IDE, ChatGPT Action болон MCP client-ийг Worker-тэй холбох нууц Bearer token.

### GitHub fine-grained token permission

Зөвхөн ашиглах repository-уудаа сонгоод:

- **Contents: Read and write** — файл, commit, branch
- **Actions: Read and write** — validation workflow эхлүүлэх, status унших
- `create_repo` хэрэглэх бол **Administration: Write**; хэрэглэхгүй бол энэ permission-ийг бүү өг

## Frontend deploy

```bash
cd frontend
npm install
npm run lint
npm run build
npx wrangler deploy
```

`frontend/wrangler.toml` нь static assets deploy-ийг тохируулсан.

## iPhone дээр ашиглах

1. Safari-аар frontend Worker URL-аа нээнэ.
2. Share → **Add to Home Screen**.
3. Settings хэсэгт:
   - Worker backend URL
   - `AUTH_TOKEN`
   - GitHub owner
   - repository
   - branch
4. Files → **GitHub** товчоор repository-н code/text файлуудыг local workspace руу татна.
5. Chat хэсэгт repository дээр хийх ажлаа өгнө.

## ChatGPT Plus эрхээр удирдах

ChatGPT-ийн web хувилбарт Custom GPT үүсгээд:

- Actions → Import from URL: `https://<backend-worker>/openapi.json`
- Authentication → API key → Bearer
- Secret → Worker-ийн `AUTH_TOKEN`

Custom GPT-г нэг удаа web дээр тохируулсны дараа ChatGPT mobile app-аас ашиглаж болно. ChatGPT Plus эрх нь Custom GPT үүсгэх/ашиглах эрх өгдөг; энэ нь OpenAI API credit биш.

## Claude Pro эрхээр удирдах

Claude web → Settings → Connectors → Add custom connector:

- MCP URL: `https://<backend-worker>/mcp`

Claude Pro/Max/Team/Enterprise нь remote MCP connector ашиглаж чадна. Connector-оо web дээр нэмсний дараа Claude mobile app-аас ашиглана. Production түвшинд MCP authentication-ийг OAuth болгох шаардлагатай; одоогийн Worker нь нэг хэрэглэгчийн Bearer хамгаалалттай.

## Gemini

Backend-ийн MCP endpoint нь MCP-compatible. Гэхдээ Gemini mobile chat дахь custom MCP app нь бүс нутаг, хэл болон Gemini Spark access-аар хязгаарлагдаж болно. Gemini-г app дотор шууд model provider болгон ашиглахад тусдаа Gemini API key шаардлагатай; Google AI subscription нь API credit-тэй адил биш.

## Аюулгүй ажиллагааны дүрэм

- AI-г `main`/`master` дээр өргөн засвар хийлгэхгүй; `agent/<task>` branch үүсгэнэ.
- Diff болон validation амжилттай болсон эсэхийг шалгасны дараа merge хийнэ.
- `AUTH_TOKEN`, GitHub PAT, AI API key-г frontend source эсвэл GitHub-д commit хийхгүй.
- Token permission-ийг зөвхөн шаардлагатай repository болон capability-д хязгаарлана.

## Одоогийн хязгаарлалт

- Local import нь Cloudflare subrequest хамгаалалтаас шалтгаалан нэг удаад 40 хүртэл text/code файл татна.
- Local preview npm package import-ыг бүрэн дэмжээгүй; full React/Vite/Next preview-д remote sandbox дараагийн шатанд хэрэгтэй.
- GitHub Contents API засвар бүрийг тусдаа commit болгодог; multi-file atomic patch/commit дараагийн шатанд хийгдэнэ.
- MCP OAuth, Pull Request creation, workflow log ingestion, automatic fix loop дараагийн milestone-д орно.
