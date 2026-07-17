# Best Code IDE

Утаснаас GitHub repository-г бүхэлд нь шинжилж, код хайж, олон файл уншиж/засаж, working branch үүсгэж, build шалгаж, алдааны log-ийг дахин уншин засварлаж, commit болон Pull Request хийх mobile-first AI coding agent PWA.

## Гол зорилго

Custom GPT заавал мэдэх шаардлагагүй. Үндсэн хэрэглээ нь Best Code IDE app-ийн өөрийн **Chat** хэсэг:

```text
Хэрэглэгчийн coding task
        ↓
Best Code IDE Agent (DeepSeek)
        ↓
Repository tree → code search → related files
        ↓
agent/<task> working branch
        ↓
atomic multi-file commit
        ↓
GitHub Actions build/lint/typecheck
        ↓
failed log → AI repair → validation дахин
        ↓
diff → draft Pull Request
```

ChatGPT, Claude, Gemini зэрэг гаднын chat холболт нь нэмэлт интерфэйс; app-ийн үндсэн agent ажиллахад заавал шаардлагагүй.

## Одоогийн agent core

### Repository ба coding

- Recursive repository tree болон directory listing
- Code, symbol, error text хайх
- Нэг дуудалтаар 12 хүртэл related file унших
- `main/master` дээр AI шууд write хийхийг хориглох
- `agent/<task>` working branch автоматаар үүсгэж app-ийн branch тохиргоог солих
- 20 хүртэл file addition/update/delete-ийг **нэг atomic Git commit** болгох
- Branch diff харах

### Build, validation, repair

- GitHub Actions дээр:
  - frontend lint
  - frontend production build
  - backend TypeScript typecheck
- Validation run болон job төлөв унших
- Failed job log-ийн error мөрүүдийг agent-д буцаах
- Алдааны log дээр үндэслэн хоёр хүртэл удаа autonomous repair хийх agent workflow

### Mobile IDE

- **Chat** — repository-aware coding agent
- **Files** — GitHub-аас code/text файлыг iPhone IndexedDB local workspace руу import хийх, CodeMirror дээр засах
- **Changes** — branch diff, validation, draft Pull Request
- **Preview** — local HTML/JS/TS preview
- **Settings** — backend, token, repository, branch

### Нэмэлт AI холболт

- MCP-compatible client: `/mcp`
- REST/OpenAPI client: `/openapi.json`

Эдгээр нь Claude, ChatGPT болон бусад supported AI client-д зориулсан нэмэлт боломж. App доторх agent-ийг ашиглахад тохируулах албагүй.

## Бүтэц

```text
frontend/   React + Vite PWA — Chat / Files / Changes / Preview / Settings
backend/    Cloudflare Worker — DeepSeek agent + GitHub tools + MCP + REST
.github/    validation workflow
```

## Cloudflare Worker secret

```bash
cd backend
npm install
npx wrangler login
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put AUTH_TOKEN
npx wrangler deploy
```

- `DEEPSEEK_API_KEY` — app доторх coding agent
- `GITHUB_TOKEN` — selected repository-г унших, branch/commit/Actions/PR удирдах
- `AUTH_TOKEN` — frontend болон backend хоорондын Bearer хамгаалалт

## GitHub fine-grained token permission

Зөвхөн ашиглах repository-уудаа сонгоод:

- **Contents: Read and write** — file, branch, atomic commit
- **Actions: Read and write** — validation эхлүүлэх, run/job/log унших
- **Pull requests: Read and write** — draft PR үүсгэх
- `create_repo` ашиглах бол **Administration: Write**; ашиглахгүй бол бүү өг

## Frontend deploy

```bash
cd frontend
npm install
npm run lint
npm run build
npx wrangler deploy
```

## iPhone дээр ашиглах

1. Safari-аар frontend Worker URL-аа нээнэ.
2. Share → **Add to Home Screen**.
3. Settings хэсэгт backend URL, `AUTH_TOKEN`, GitHub owner/repo/branch оруулна.
4. Chat дээр шууд coding task өгнө.

Жишээ:

```text
Энэ repo-г бүхэлд нь шалга. Login алдааны шалтгааныг ол.
Main дээр бүү бич. Working branch үүсгээд холбогдох файлуудыг
нэг commit-оор зас. Build шалга. Алдаа гарвал log-ийг уншаад дахин зас.
Амжилттай бол diff-ийг дүгнэж draft Pull Request үүсгэ.
```

Agent дараахыг автоматаар хийх ёстой:

1. Repository tree унших
2. Code search хийх
3. Related files унших
4. Working branch үүсгэх
5. Atomic commit хийх
6. Validation хүлээх
7. Failure log уншиж repair хийх
8. Diff шалгах
9. Хэрэглэгч end-to-end publish хүссэн бол draft PR үүсгэх

## Subscription ба API-ийн ялгаа

- Best Code IDE app доторх agent одоогоор `DEEPSEEK_API_KEY` ашиглана.
- ChatGPT Plus, Claude Pro, Google AI subscription-ийг гуравдагч app дотор API key шиг шууд ашиглах боломжгүй.
- App дотор GPT/Claude/Gemini model шууд нэмэх бол тухайн provider-ийн тусдаа API key болон billing хэрэгтэй.
- Subscription chat-аас Best Code IDE-г удирдах боломж нь тухайн платформын connector/action support-оос хамаарна; энэ нь app-ийн үндсэн workflow биш.

## Аюулгүй ажиллагаа

- AI `main/master` руу шууд write/delete/atomic commit хийж чадахгүй.
- Working branch, diff, validation ашиглана.
- Agent Pull Request үүсгэж болно, merge хийхгүй.
- `AUTH_TOKEN`, GitHub PAT, AI API key-г source code эсвэл GitHub-д commit хийхгүй.
- Token permission-ийг зөвхөн шаардлагатай repository-д хязгаарлана.

## Үлдсэн том ажлууд

- Local workspace-ийн олон файлын changes-ийг GitHub atomic commit-тэй бүрэн нэгтгэх
- Full React/Vite/Next remote preview sandbox
- OpenAI / Anthropic / Gemini API provider adapters
- MCP OAuth болон олон хэрэглэгчийн account security
- Conflict resolution болон commit revert UI
