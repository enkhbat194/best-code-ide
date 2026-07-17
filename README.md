# best-code-ide

iPhone дээр ажилладаг AI coding assistant PWA. Chat дотроос DeepSeek AI-д даалгавар өгөхөд файл унших/бичих/commit/push зэргийг шууд GitHub дээр хийдэг — яг л Claude Code chat дотор ажилладаг шигээ. Мөн Claude/ChatGPT зэрэг **гадаад AI chat**-аас ч холбогдож удирдах боломжтой.

## Бүтэц

```
frontend/   React + Vite PWA — Chat / Files / Preview / Settings
backend/    Cloudflare Worker — DeepSeek agent + GitHub API + MCP + REST
```

- **Chat tab** — DeepSeek-тэй ярилцаж, файл унших/бичих/commit/push хийлгэнэ
- **Files tab** — кодыг утсан дээрээ (IndexedDB) GitHub-аас үл хамааран хадгалж засна
- **Preview tab** — JS/TS/HTML/CSS кодыг сервэргүйгээр, шууд утсан дээр bundle хийж ажиллуулж үзнэ (esbuild-wasm)
- **Settings tab** — backend URL, auth token, GitHub owner/repo/branch тохиргоо

Backend Worker нэг л газраас гурван янзаар ашиглагдана:
1. `/api/chat` — mobile app-ийн chat (streaming)
2. `/mcp` — Claude-ийн custom connector (Model Context Protocol)
3. `/openapi.json` + `/api/repos/...` — ChatGPT Custom GPT Actions (REST)

Бүгд ижил Bearer token-оор хамгаалагдана.

## 1. DeepSeek API key авах

https://platform.deepseek.com → бүртгүүлээд API key үүсгэнэ. Төлбөр нь ашигласан хэмжээгээрээ (маш хямд, ойролцоогоор 1 сая token ≈ $0.3).

## 2. GitHub Personal Access Token үүсгэх

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
- Repository access: зөвхөн ажиллах repo(гуудаа) сонго
- Permissions → **Contents: Read and write**

## 3. Backend deploy хийх (Cloudflare Workers — үнэгүй)

```bash
cd backend
npm install
npx wrangler login          # Cloudflare данс холбоно (үнэгүй бүртгэл хангалттай)

npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put AUTH_TOKEN   # өөрөө think up хийсэн урт random string — энэ бол таны апп-ийн "нууц түлхүүр"

npx wrangler deploy
```

Deploy дуусахад `https://best-code-ide-api.<таны-нэр>.workers.dev` гэсэн URL өгнө — үүнийг хадгал.

## 4. Frontend deploy хийх (Cloudflare Pages — үнэгүй)

```bash
cd frontend
npm install
npm run build
npx wrangler pages deploy dist --project-name=best-code-ide
```

Энэ нь `https://best-code-ide.pages.dev` шиг URL өгнө.

## 5. iPhone дээр суулгах

1. iPhone дээрх **Safari**-аар Pages URL-аа нээ (Chrome биш — "Add to Home Screen" зөвхөн Safari дээр ажилладаг)
2. Share товч → **Add to Home Screen**
3. Апп нээгээд **Settings** tab руу орж:
   - Worker backend URL (3-р алхамын URL)
   - Auth token (3-р алхамд `AUTH_TOKEN`-д оруулсан утга)
   - GitHub owner / repo / branch

Одоо **Chat** tab-с даалгавраа бичиж эхэлж болно.

## 6. Гадаад AI chat-аас холбох

### Claude
claude.ai → Settings → **Connectors** → Add custom connector:
- URL: `https://<worker-url>/mcp`
- Auth: Bearer token (AUTH_TOKEN)

*Claude Pro/Max/Team эрх шаардлагатай.*

### ChatGPT
Custom GPT үүсгээд → Configure → **Actions** → Import from URL:
- `https://<worker-url>/openapi.json`
- Auth: API Key → Bearer

*ChatGPT Plus/Team эрх шаардлагатай.*

## Аюулгүй байдал

- `AUTH_TOKEN`-оо хэнтэй ч бүү хуваалц — үүнийг мэдэх хэн ч таны GitHub repo-д бичиж, DeepSeek API мөнгийг зарцуулж чадна
- GitHub PAT-аа зөвхөн шаардлагатай repo(гуудаар)аа хязгаарла
- Worker URL нь public боловч AUTH_TOKEN-гүйгээр юу ч хийж чадахгүй
