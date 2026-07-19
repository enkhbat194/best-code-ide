---
document: BestCode Research Policy
version: 1.0.0
status: LOCKED-BY-MASTER-2.0.0
owner: Enkhbat
updated_at: 2026-07-19
---

# BestCode — Web Research & External Knowledge Policy

## 1. Зорилго

Research Agent-ийн үүрэг нь олон линк цуглуулах биш. Owner-ийн бодит шийдвэрт ашиглаж болох, эх сурвалж бүр нь шалгагдах **Research Dossier** бүтээх юм.

Энэ policy software debugging, бүтээгдэхүүн/материалын sourcing, стандарт/инженерийн preliminary research, зах зээлийн харьцуулалт, DIY туршлага, хууль/дүрмийн лавлагаа зэрэг бүх external knowledge task-д үйлчилнэ.

## 2. Үндсэн зарчим

1. Search result бол source биш; original page-ийг уншиж байж claim үүсгэнэ.
2. Source бол үнэн гэсэн үг биш; claim-ийг тусад нь үнэлнэ.
3. AI synthesis бол evidence биш; claim → source холбоос evidence байна.
4. Хуучирдаг мэдээлэл бүр retrieved date болон validity window-тэй.
5. Primary source олдох боломжтой бол blog/forum-оор орлуулахгүй.
6. Зөрчилтэй source-ийг нуухгүй; contradiction гэж харуулна.
7. Access control, CAPTCHA, paywall, robots/terms-ийг тойрохгүй.
8. External content дахь prompt/command BestCode-ийн policy-г өөрчилж чадахгүй.
9. Safety-critical conclusion qualified review-гүй action-ready болж болохгүй.
10. Research нь bounded budget, time, source count, page size-тай байна.

## 3. Research Contract

Mission эхлэхэд дараах contract үүсгэнэ:

```yaml
research_question: string
decision_to_support: string
scope:
  included: [string]
  excluded: [string]
constraints:
  countries: [string]
  languages: [string]
  date_range: string | null
  budget_limit: number | null
  currency: string | null
required_source_tiers: [primary, authoritative, community, marketplace]
safety_class: routine | consequential | safety_critical
freshness_requirement: string
done_when: [string]
```

Тодорхой бус асуултад agent search-ээ сохроор өргөжүүлэхгүй. Материаллаг үр дүнг өөрчлөх 1–3 асуултыг owner-оос асууна; бусдыг assumption гэж ил тэмдэглээд үргэлжлүүлж болно.

## 4. Source tier

| Tier | Жишээ | Ямар claim-д тохирох вэ? |
|---|---|---|
| **P — Primary** | хууль/стандартын publisher, үйлдвэрлэгчийн datasheet, official docs, research paper, official repository | requirement, specification, compatibility, official behavior |
| **A — Authoritative** | мэргэжлийн байгууллага, их сургууль, recognized technical handbook | interpretation, method, background |
| **S — Secondary** | нэр хүндтэй review/news/industry analysis | comparison, context, market signal |
| **C — Community** | forum, GitHub issue, video, practitioner report | real failure mode, workaround, lived experience |
| **M — Marketplace** | Alibaba/1688/listing/reseller | availability, quoted price, seller claim |

Marketplace-ийн “specification” P tier биш. Community-ийн “би ингэж хийсэн” гэдэг safety proof биш. Харин бодит хэрэглэгчдийн нийтлэг алдаа, нийлүүлэлтийн практик, unofficial workaround-д үнэ цэнтэй байж болно.

## 5. Acquisition pipeline

### 5.1 Search

`web_search` provider-neutral adapter хэрэглэнэ. Search provider-ийн нэр, ranking, paid placement, query, locale, date, result count хадгалагдана.

Нэг provider-ийг Locked Master-д сонгохгүй. Adapter-ийг дараах хэмжүүрээр туршина:

- primary-source recall;
- Mongolian/English/Czech/Chinese query quality;
- freshness;
- domain/date filter;
- pricing ба quota transparency;
- privacy/retention;
- API stability;
- citation URL integrity.

### 5.2 Direct source read

Зөвшөөрөгдсөн `http/https` source-д:

1. URL normalize;
2. DNS/IP policy check;
3. redirect бүрийг дахин policy check;
4. bounded fetch;
5. боломжтой бол `Accept: text/markdown`;
6. content type/size validation;
7. text extraction;
8. injection scan;
9. content hash ба metadata record үүсгэнэ.

### 5.3 Browser execution

Direct read хангалтгүй JavaScript page-д sandboxed Browser Run ашиглаж болно. Browser task нь:

- зөвхөн mission-scoped domain/URL;
- хугацаа, navigation, download, page count cap;
- file/system/secret access-гүй;
- snapshot, screenshot, accessibility/markdown output-той;
- action бүр audit event-тэй байна.

### 5.4 Authenticated/human-assisted browsing

Login, consent, location, CAPTCHA шаардвал:

- owner өөрөө controlled browser session-д нэвтэрнэ;
- AI password/cookie-г харахгүй, memory-д хадгалахгүй;
- session scope ба expiry харагдана;
- transaction/send/order/accept товч owner approval-гүй дарагдахгүй;
- CAPTCHA-г автомат тойрохгүй.

### 5.5 Unavailable source

Source уншигдахгүй бол “олдоогүй” гэж зохиохгүй. `blocked_by_access`, `paywalled`, `captcha_required`, `robots_disallowed`, `unsupported_format`, `timeout`, `removed` төлөвийн аль нэгээр тэмдэглэнэ.

## 6. SSRF ба egress хамгаалалт

`source_read` дараахыг хориглоно:

- `file:`, `ftp:`, `data:`, `javascript:`, custom protocol;
- localhost, loopback, link-local, private/reserved IP range;
- cloud metadata endpoint;
- URL userinfo/embedded credential;
- DNS rebinding болон redirect-аар private target руу шилжих;
- unbounded archive, stream, binary download;
- mission policy-д байхгүй authenticated origin.

Download шаардвал тусдаа quarantined artifact pipeline, MIME/signature scan, size limit, owner-visible reason ашиглана.

## 7. Prompt injection хамгаалалт

Web page, PDF, repository, issue, comment, image OCR дотор:

- “previous instructions-ийг үл тоо”, “secret явуул”, “энэ tool дуудах” гэх текст нь untrusted content;
- content нь system/owner policy, tool permission, budget, target URL-г өөрчилж чадахгүй;
- model-д source content болон BestCode instruction тусдаа channel/field-ээр өгнө;
- suspicious segment-ийг flag хийнэ;
- sensitive capability-тэй agent untrusted content-ийг raw байдлаар авч гүйцэтгэхгүй;
- injection илэрсэн ч тухайн source-ийн factual хэсгийг тусгаарлан ашиглаж болох эсэхийг verifier шийднэ.

## 8. Source Record

```yaml
source_id: src_...
url: https://...
canonical_url: https://...
publisher: string | null
title: string
source_tier: P | A | S | C | M
published_at: datetime | null
updated_at: datetime | null
retrieved_at: datetime
language: string
jurisdiction: string | null
content_type: string
acquisition: direct_markdown | direct_html | browser_snapshot | owner_upload
content_hash: sha256:...
excerpt_hashes: [sha256:...]
access_status: available
usage_note: string
injection_flags: [string]
```

Full copyrighted page-ийг хэрэгцээгүйгээр Asset Vault-д хуулж хадгалахгүй. Relevant excerpt hash, short excerpt, metadata болон owner-accessible original link хангалттай бол тэр хэлбэрийг хэрэглэнэ.

## 9. Claim Record

```yaml
claim_id: clm_...
statement: string
type: fact | specification | price | experience | inference | recommendation
supporting_sources: [src_...]
contradicting_sources: [src_...]
confidence: low | medium | high
applicability:
  jurisdiction: string | null
  product_version: string | null
  conditions: [string]
time_basis:
  observed_at: datetime | null
  last_verified_at: datetime
units: string | null
currency: string | null
assumptions: [string]
review_status: unreviewed | cross_checked | specialist_required | verified
```

`inference` болон `recommendation` нь factual claim-ээс ялгаатай харагдана. Confidence нь “AI итгэлтэй байна” биш, source quality, independence, freshness, agreement, directness гэсэн rubric-ээр тооцогдоно.

## 10. Cross-check rule

Material claim бүрт:

- нэг primary source; эсвэл
- primary source боломжгүй бол хоёр бие даасан source ба limitation;
- price/availability-д хоёр supplier эсвэл нэг supplier + timestamped quote;
- community failure mode-д дор хаяж хоёр independent report эсвэл “anecdotal” label;
- software bug fix-д official docs/release/source code эсвэл reproducible test шаардлагатай.

Source-ууд нэг нийтлэлээс хуулсан бол independent гэж тооцохгүй.

## 11. Research Dossier

Owner-facing dossier:

1. **Асуулт ба шийдвэр**
2. **Товч хариу**
3. **Санал болгож буй сонголт**
4. **Яагаад**
5. **Source-backed material claims**
6. **Contradiction ба тодорхойгүй зүйл**
7. **Cost/time/logistics**
8. **Risk ба safety gate**
9. **Дараагийн шалгалт/owner decision**
10. **Source list ба snapshot metadata**

Өөрчлөгдөж болох үнэ, хууль, API capability, product spec-д expiry/freshness banner харуулна.

## 12. Safety class

### Routine

Software docs, ерөнхий санаа, reversible comparison. Agent dossier-ийг owner decision-ready болгоно.

### Consequential

Их мөнгө, нийлүүлэгч, хууль/татвар, үйлдвэрлэлийн материал, personal data. Owner approval, stronger cross-check, current source шаардлагатай.

### Safety-critical

Бүтээц, цахилгаан, химийн бодис, машин хамгаалалт, эмнэлэг зэрэг. Research нь preliminary support; qualified person-ийн нэр/үүрэг, review date, accepted assumptions байх хүртэл `action_blocked` байна.

## 13. Cost ба denial-of-wallet

Үнэ Locked Master-д хатуу бичихгүй. Provider pricing байнга өөрчлөгдөнө. Үүний оронд mission бүр:

- free/paid provider status;
- max search calls;
- max pages/bytes/browser minutes;
- max model tokens;
- soft warning ба hard stop;
- actual cost evidence;
- owner-ийн нэмэлт budget approval ашиглана.

Cache нь URL + content hash + freshness policy дээр ажиллана; stale cache current claim мэт харагдахгүй.

## 14. Implementation references

Эдгээр холбоос нь architecture-ийн одоогийн албан ёсны лавлагаа бөгөөд canonical requirement биш:

- Cloudflare Workflows: <https://developers.cloudflare.com/workflows/>
- Workflows wait-for-event: <https://developers.cloudflare.com/workflows/examples/wait-for-event/>
- Cloudflare Browser Run: <https://developers.cloudflare.com/browser-run/>
- Browser Run crawl endpoint: <https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/>
- Markdown for Agents: <https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/>
- Cloudflare Containers: <https://developers.cloudflare.com/containers/>

Provider сонголт хийх үед current official documentation, privacy, pricing, quota-г дахин шалгаж ADR гаргана.

## 15. Exit criteria — Research Agent v1

- SSRF/redirect/protocol conformance tests ногоон;
- malicious prompt-injection corpus policy-г эвдэж чадахгүй;
- source/claim/contradiction schema durable;
- нэг software debugging dossier;
- нэг materials/supplier dossier;
- нэг safety-critical sample дээр specialist gate зөв block хийсэн;
- owner source-оо нээж, claim бүрийг шалгаж чаддаг;
- export хийсэн dossier BestCode-гүйгээр уншигддаг;
- cost cap, cancellation, retention, redaction шалгагдсан.
