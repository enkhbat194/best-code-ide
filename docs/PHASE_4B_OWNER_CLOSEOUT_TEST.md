# Phase 4B — Owner closeout test

## Зорилго

Installed iOS PWA дээр дараах үлдсэн owner-visible evidence-ийг нэг guided flow-оор бүрдүүлнэ:

1. зураг metadata capture;
2. файл metadata capture;
3. http/https URL normalize болон capture;
4. Decision inbox `accepted`;
5. Decision inbox `rejected`;
6. Decision inbox `superseded`;
7. writer lease cleanup;
8. lifecycle `decision → planned` recovery.

## UI

Mission workspace дотор `4B Test` гэсэн тусдаа owner verification mode нэмэгдсэн.

### Алхам 1 — Capture

Owner:

- Photos-оос нэг зураг сонгоно;
- Files-оос нэг PDF/TXT/MD/JSON/CSV/DOC файл сонгоно;
- нэг http/https URL нэмнэ;
- closeout canary Mission үүсгэнэ.

Binary файл эсвэл зургийн агуулгыг backend рүү upload хийхгүй. Зөвхөн filename, MIME type, хэмжээ болон normalize хийсэн URL-г Goal outcome дотор bounded metadata хэлбэрээр хадгална.

### Алхам 2 — Decision inbox

Canary Mission-д гурван open Decision writer lease болон optimistic context version хамгаалалтаар үүснэ. Owner тус бүр дээр заасан товчийг дарна:

- `Зөвшөөрөх` → `accepted`;
- `Татгалзах` → `rejected`;
- `Хуучирсан` → `superseded`.

### Алхам 3 — Cleanup

Бүх шийдвэр хаагдсаны дараа:

- writer lease `null`;
- lifecycle `planned`;
- capture болон decision бүх мөр `passed`;
- overall `Phase 4B owner closeout амжилттай`.

## Safety boundary

- зөвхөн тусгай canary Mission record өөрчлөгдөнө;
- repository write хийхгүй;
- deploy, rollback, payment, production traffic action хийхгүй;
- file/image binary upload хийхгүй;
- mutation бүр idempotency key, current context version болон active writer lease ашиглана.

## Formal closeout

Owner-ийн амжилттай screenshot болон canary Mission ID/context version/hash-ийг бүртгэсний дараа docs-only PR-аар `PHASE_4B_MISSION_CANVAS_PLAN.md` status-ийг `COMPLETED` болгоно.
