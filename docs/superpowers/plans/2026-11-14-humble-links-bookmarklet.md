# Humble Download-Links Bookmarklet Implementation Plan

> **Executed; kept as the record of the first build.** Later changes are not
> reflected here: `build.mjs` and `bookmarklet.txt` were replaced by
> `site/index.html`, which builds the bookmark in the browser with
> `site/bookmarklet.mjs`; alerts were replaced by a modal; the saved library
> pages were replaced by the made-up `test/fixtures/bundle-page.html.txt`.
> The current design is `docs/2026-11-14-humble-links-bookmarklet-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bookmarklet that, on a Humble library bundle page, fetches a signed URL for every download and saves them as a one-URL-per-line `.txt` for curl.

**Architecture:** One source file `humble-links.js` holds pure parsing functions plus `main(g)`, which does all browser I/O through the injected global `g`. Under Node (no `document`) it exports its functions for `node --test`; in the browser it runs `main()`. `build.mjs` wraps the source in an IIFE and URL-encodes it into `bookmarklet.txt`.

**Tech Stack:** Plain JavaScript, Node v26.12.1 (`node:test`, `node:assert/strict`, `node:vm`), biome 2.6.3 (global install). No dependencies, no `package.json`.

**Spec:** `docs/2026-11-14-humble-links-bookmarklet-design.md`

## Global Constraints

- Node v26.12.1. No `package.json`, no dependencies. No `package.json` exists in any parent directory (verified), so `humble-links.js` loads as CommonJS.
- No commit steps: the folder is not a git repository, and the user's rules forbid `git commit` without explicit instruction.
- No `.editorconfig` in the tree. Formatting = biome defaults. Lint gate per task: `biome check --write <files>` (autofix), then `biome check <files>` exits 0 with no diagnostics.
- `node --test` (no args, run from the project root) executes every `.js`/`.mjs` under `test/`. Fixtures therefore use the `.txt` extension.
- Action function name: `getSignedUrlsForEntitlements`. Hash regex: `/"([0-9a-f]{40,})",[^"]*"getSignedUrlsForEntitlements"/`.
- Entitlement regex: `/"id":"([0-9a-f-]{36})","title":"((?:[^"\\]|\\.)*)","type":"download_drm_free"/g`. Titles are JSON-unescaped.
- Action request: `POST g.location.href`, headers `Next-Action: <hash>`, `Accept: text/x-component`, `Content-Type: text/plain;charset=UTF-8`, body `JSON.stringify([[entitlementId]])`. One entitlement per request, sequential.
- Output text: `urls.join("\n") + "\n"`. Filename: `` `${slugify(originalTitle)}.txt` ``, where `originalTitle` is `g.document.title` read before any progress update.
- Exact alert copy (all start with `Humble links: `):
  - no `__next_f`: `Humble links: open a bundle page in your Humble library first.`
  - zero entitlements: `Humble links: no downloads found in this page's data. Reload the page and click the bookmarklet again.`
  - no hash: `Humble links: could not find getSignedUrlsForEntitlements in the page scripts. Humble may have changed the site.`
  - success: `` `Humble links: saved ${urls.length} URLs from ${okCount} of ${total} titles to ${filename}.` ``
  - zero URLs overall (no file saved): `Humble links: no download URLs received.`
  - either of the last two, when any title failed, gets `` `\nFailed: ${failedTitles.join(", ")}` `` appended.
  - unexpected exception: `` `Humble links: ${err.message}` ``

## Review Focus

1. Clicked on a page that is not a bundle page (no `self.__next_f`) → the guard alert fires and no requests are made. Test: Task 3 "guard", Task 4 "vm guard".
2. Bundle page reached by in-app navigation (stale `__next_f` without download entitlements) → the reload alert fires and no requests are made. Test: Task 3 "stale page".
3. Humble redeploy moves or renames the action → the hash alert fires, no POSTs, no empty file. Test: Task 3 "hash missing".
4. One title's request fails mid-run → the remaining titles finish, the failed title is named, and the file is saved. All titles fail → no empty file. Tests: Task 3 "e2e", "all failed".
5. The bookmarklet is clicked twice, or its `javascript:` URL evaluates to a value, which would replace the page → the IIFE returns `undefined` and a second run causes no redeclaration error. Test: Task 4 "vm twice".

---

### Task 1: Page-data parsing

**Files:**
- Create: `humble-links.js`
- Test: `test/humble-links.test.mjs`

**Interfaces:**
- Produces (exported from `humble-links.js` when `typeof document === "undefined"`, via `module.exports`; otherwise the file calls `main()`):
  - `rscTextFrom(nextF: unknown): string`: joins `c[1]` for every element `c` that is an array with `c[0] === 1` and a string `c[1]`. Returns `""` when `nextF` is not an array.
  - `extractEntitlements(rscText: string): {id: string, title: string}[]`: matches in document order, deduped by `id` (first wins), title unescaped with `JSON.parse('"' + raw + '"')`.
  - `slugify(title: string): string`: lowercase; runs of non-`[a-z0-9]` become `-`; leading and trailing `-` trimmed; empty result → `"humble-links"`.
  - Test helper (local to the test file): `rscFromHtml(html)`: JSON-parses each `/self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g` capture and joins the results.

- [ ] **Step 1: Write the failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import lib from "../humble-links.js";
const { rscTextFrom, extractEntitlements, slugify } = lib;
const page = (n) =>
	readFileSync(new URL(`../${n}.html`, import.meta.url), "utf8");

const COUNTS = {
	ai: 26,
	"big-data": 26,
	cybersecurity: 15,
	devops: 26,
	"diy-electronics": 14,
	"dystopian-worlds": 23,
	"essential-knowledge": 24,
	"judge-dredd": 34,
};
test("extractEntitlements counts on saved pages", () => {
	for (const [n, c] of Object.entries(COUNTS))
		assert.equal(extractEntitlements(rscFromHtml(page(n))).length, c, n);
});
test("extractEntitlements first and apostrophe title", () => {
	assert.deepEqual(
		extractEntitlements(rscFromHtml(page("essential-knowledge")))[0],
		{ id: "<first entitlement id>", title: "Gender(s)" },
	);
	assert.ok(
		extractEntitlements(rscFromHtml(page("big-data"))).some(
			(e) => e.title === "Big Data Architect's Handbook",
		),
	);
});
test("extractEntitlements unescapes and dedupes", () => {
	const one = String.raw`{"id":"00000000-0000-0000-0000-000000000000","title":"A \"B\" & C","type":"download_drm_free"}`;
	assert.deepEqual(extractEntitlements(one + one), [
		{ id: "00000000-0000-0000-0000-000000000000", title: 'A "B" & C' },
	]);
});
test("extractEntitlements stale page → []", () =>
	assert.deepEqual(extractEntitlements('1:{"foo":1}\n'), []));
test("rscTextFrom", () => {
	assert.equal(
		rscTextFrom([[0], [1, "a"], [2, "x"], [1, "b"], [3, "zz"]]),
		"ab",
	);
	assert.equal(rscTextFrom(undefined), "");
});
test("slugify", () => {
	assert.equal(
		slugify("Humble Book Bundle: A.I. by Packt"),
		"humble-book-bundle-a-i-by-packt",
	);
	assert.equal(
		slugify("Humble Comics Bundle: Judge Dredd by IDW & 2000AD"),
		"humble-comics-bundle-judge-dredd-by-idw-2000ad",
	);
	assert.equal(slugify(""), "humble-links");
	assert.equal(slugify("***"), "humble-links");
});
```

- [ ] **Step 2: Run to verify failure.** `node --test` → FAIL (`Cannot find module '../humble-links.js'`).
- [ ] **Step 3: Implement** the three functions and the export/dispatch tail in `humble-links.js`. Declare `async function main(g = globalThis) {}` as an empty stub for now, so the dispatch tail resolves.
- [ ] **Step 4: Run to verify pass.** `node --test` → all pass, 0 fail, no warnings.
- [ ] **Step 5: Lint.** `biome check --write humble-links.js test/`, then `biome check humble-links.js test/` → exit 0.

### Task 2: Script and response parsing

**Files:**
- Create: `test/fixtures/actions-chunk.js.txt`
- Modify: `humble-links.js`
- Test: `test/humble-links.test.mjs`

**Interfaces:**
- Produces (added to the exports):
  - `chunkUrls(scriptSrcs: string[], resourceNames: string[]): string[]`: keeps entries matching `/\/_next\/static\/chunks\/[^?#]+\.js(?:[?#]|$)/`, scripts first, deduped, order preserved.
  - `findActionHash(chunkText: string): string | null`
  - `parseActionResponse(text: string): {ok: boolean, urls: string[]}`: splits on `\n`, matches each line with `/^[0-9a-f]+:(.*)$/`, `JSON.parse`s the content (skips lines that fail), walks objects and arrays depth-first and collects strings starting with `https://`, deduped in order. `ok = urls.length > 0 || some parsed row is an object with ok === true`.

- [ ] **Step 1: Copy the fixture.** Download `https://www.humblebundle.com/_next/static/chunks/35-4ue7z-wpe7.js` to `test/fixtures/actions-chunk.js.txt`.
- [ ] **Step 2: Write the failing tests**

```js
const { chunkUrls, findActionHash, parseActionResponse } = lib;
const CHUNK = readFileSync(
	new URL("./fixtures/actions-chunk.js.txt", import.meta.url),
	"utf8",
);
const C = "https://www.humblebundle.com/_next/static/chunks/";
const PDF =
	"https://cdn.humble.com/humblebundle/floatingworlds.pdf?t=st=1~exp=2~hmac=a";
const EPUB =
	"https://cdn.humble.com/humblebundle/floatingworlds.epub?t=st=1~exp=2~hmac=b";
const row0 = '0:{"a":"$@1","f":"","b":"t"}\n';
test("findActionHash", () => {
	assert.equal(
		findActionHash(CHUNK),
		"70b00827d4b26565187ffb00c9f0fb9626be55416a",
	);
	assert.equal(
		findActionHash(
			'createServerReference)("403a0e9b0bd056bcca1f70e90f41a061270b6f617b",x.callServer,void 0,x.findSourceMapURL,"recordDownload")',
		),
		null,
	);
});
test("chunkUrls", () => {
	assert.deepEqual(
		chunkUrls(
			[`${C}a.js`, "https://cdn.ziffstatic.com/jst/zdconsent.js", ""],
			[
				`${C}a.js`,
				`${C}b.js?v=1`,
				"https://www.humblebundle.com/_next/static/media/x.woff2",
			],
		),
		[`${C}a.js`, `${C}b.js?v=1`],
	);
});
test("parseActionResponse urls in order, deduped", () => {
	const body = {
		ok: true,
		data: {
			signedUrls: { m: { k: { "a.pdf": PDF, "a.epub": EPUB, dup: PDF } } },
			expiresAt: "2026-11-15T00:00:00.000Z",
		},
	};
	assert.deepEqual(parseActionResponse(`${row0}1:${JSON.stringify(body)}\n`), {
		ok: true,
		urls: [PDF, EPUB],
	});
});
test("parseActionResponse empty success / failure / garbage", () => {
	assert.deepEqual(
		parseActionResponse(
			`${row0}1:{"ok":true,"data":{"signedUrls":{"m":{}}}}\n`,
		),
		{ ok: true, urls: [] },
	);
	assert.deepEqual(parseActionResponse(`${row0}1:{"ok":false}\n`), {
		ok: false,
		urls: [],
	});
	assert.deepEqual(parseActionResponse("<html>error</html>"), {
		ok: false,
		urls: [],
	});
});
```

- [ ] **Step 3: Run to verify failure.** `node --test` → the new tests FAIL (`chunkUrls is not a function`).
- [ ] **Step 4: Implement** the three functions and export them.
- [ ] **Step 5: Run to verify pass.** `node --test` → all pass.
- [ ] **Step 6: Lint.** Same commands as Task 1 → exit 0.

### Task 3: `main(g)` orchestration

**Files:**
- Modify: `humble-links.js`
- Test: `test/humble-links.test.mjs`

**Interfaces:**
- Consumes: every function from Tasks 1–2.
- Produces: `main(g = globalThis): Promise<void>`, added to the exports. It touches only these members of `g`: `__next_f`; `document.title` (read and write); `document.querySelectorAll("script[src]")` (uses `.src`); `document.createElement("a")`; `document.body.append`; `performance.getEntriesByType("resource")` (uses `.name`); `location.href`; `fetch`; `alert`; `URL.createObjectURL`; `Blob`; `console.log`.
- Flow:
  1. `Array.isArray(g.__next_f)`, else the guard alert.
  2. Extract entitlements; if there are none, the reload alert.
  3. Fetch the `chunkUrls` candidates in order, skipping rejections and non-ok responses, until `findActionHash` returns a hash; if none does, the hash alert.
  4. For each entitlement `i`: set the title to `` `${i + 1}/${total} ${originalTitle}` ``, then POST. A non-ok HTTP response, a rejection, or `parseActionResponse(...).ok === false` marks the title failed.
  5. Save when `urls.length > 0`: an `<a>` with `href = g.URL.createObjectURL(new g.Blob([text], { type: "text/plain" }))` and `download = filename`, appended to the body, clicked, then removed. Also `g.console.log(text)`.
  6. Show the summary alert.
  7. A `finally` block restores the original title. Any exception produces the exception alert.

- [ ] **Step 1: Write the test env helper and the failing tests.** `makeEnv({ nextF, chunkText, post })` returns `{ g, alerts, fetches, posts, saved }`, where `fetches` records the URL of every `g.fetch` call:
  - `g.document.title` starts as `"Humble Book Bundle: Essential Knowledge: Learn Something New by MIT Press"`.
  - `g.document.querySelectorAll` returns two scripts, `${C}missing.js` (its fetch rejects) and `${C}35-4ue7z-wpe7.js` (its fetch resolves `chunkText`).
  - `g.performance.getEntriesByType` returns `[]`.
  - `g.location.href` is `"https://www.humblebundle.com/library/x"`.
  - `g.fetch(url, opts)`: when `opts?.method === "POST"`, records `{ url, opts, title: g.document.title }` into `posts` and returns `post(JSON.parse(opts.body)[0][0], posts.length)`.
  - `g.URL.createObjectURL(b)` stores the blob.
  - `createElement` returns an anchor whose `click()` pushes `{ download, blob }` into `saved`.
  - `g.Blob = Blob`, `g.alert = (m) => alerts.push(m)`, `g.console = { log() {} }`.

  Tests:
  - **e2e** (`rsc = rscFromHtml(page("essential-knowledge"))`, `nextF = [[1, rsc]]`, `titles = extractEntitlements(rsc).map((e) => e.title)`; `post` returns `{ ok: false, status: 500, text: async () => "" }` for the 5th call, otherwise `{ ok: true, status: 200, text: async () => row0 + "1:" + JSON.stringify({ ok: true, data: { signedUrls: { m: { k: { f: url(id) } } } } }) }` with ``url = (id) => `https://cdn.humble.com/humblebundle/${id}.epub?t=x` ``):
    - `posts.length === 24`
    - `posts[0].url === g.location.href`
    - `posts[0].opts.headers["Next-Action"] === "70b00827d4b26565187ffb00c9f0fb9626be55416a"`
    - `posts[0].opts.headers.Accept === "text/x-component"`
    - `posts[0].opts.body === JSON.stringify([["<first entitlement id>"]])`
    - `posts[0].title === "1/24 Humble Book Bundle: Essential Knowledge: Learn Something New by MIT Press"`
    - `saved[0].download === "humble-book-bundle-essential-knowledge-learn-something-new-by-mit-press.txt"`
    - `(await saved[0].blob.text())` has 23 lines plus a trailing `\n`
    - `alerts` deep-equals `["Humble links: saved 23 URLs from 23 of 24 titles to humble-book-bundle-essential-knowledge-learn-something-new-by-mit-press.txt.\nFailed: " + titles[4]]`
    - the title is restored afterwards
  - **all failed**: every POST returns 500 → `saved.length === 0` and `alerts[0].startsWith("Humble links: no download URLs received.\nFailed: Gender(s), ")`.
  - **guard**: `nextF = undefined` → `alerts` deep-equals the guard copy and `posts.length === 0`.
  - **stale page**: `nextF = [[1, '1:{"foo":1}\n']]` → the reload copy, and `fetches.length === 0`.
  - **hash missing**: `chunkText = "nothing here"` → the hash copy, and `posts.length === 0`.
- [ ] **Step 2: Run to verify failure.** `node --test` → the five new tests FAIL (the stub `main` does nothing).
- [ ] **Step 3: Implement `main`** per the flow above.
- [ ] **Step 4: Run to verify pass.** `node --test` → all pass.
- [ ] **Step 5: Lint.** Same commands → exit 0.

### Task 4: Build, bookmarklet and README

**Files:**
- Create: `build.mjs`, `README.md`, `bookmarklet.txt` (generated)
- Test: `test/build.test.mjs`

**Interfaces:**
- Consumes: the `humble-links.js` source text.
- Produces: `export function buildBookmarklet(source: string): string`, returning `"javascript:" + encodeURIComponent("(()=>{" + source + "\n})()")`. When run directly (`import.meta.main`), it reads `humble-links.js` next to itself and writes `bookmarklet.txt`.

- [ ] **Step 1: Write the failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { buildBookmarklet } from "../build.mjs";
const decode = (b) => decodeURIComponent(b.slice("javascript:".length));
const GUARD = "Humble links: open a bundle page in your Humble library first.";
test("wrapper shape", () => {
	const b = buildBookmarklet("x");
	assert.ok(b.startsWith("javascript:"));
	assert.equal(decode(b), "(()=>{x\n})()");
});
test("vm guard + vm twice", async () => {
	const code = decode(
		buildBookmarklet(
			readFileSync(new URL("../humble-links.js", import.meta.url), "utf8"),
		),
	);
	const alerts = [];
	const ctx = vm.createContext({
		alert: (m) => alerts.push(m),
		document: { title: "" },
		console,
	});
	assert.equal(vm.runInContext(code, ctx), undefined);
	assert.equal(vm.runInContext(code, ctx), undefined);
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(alerts, [GUARD, GUARD]);
});
```

- [ ] **Step 2: Run to verify failure.** `node --test` → FAIL (`Cannot find module '../build.mjs'`).
- [ ] **Step 3: Implement `build.mjs`.**
- [ ] **Step 4: Run to verify pass.** `node --test` → all pass.
- [ ] **Step 5: Generate.** `node build.mjs` → `bookmarklet.txt` exists and starts with `javascript:%28%28%29%3D%3E%7B`.
- [ ] **Step 6: Write `README.md`** with:
  - **Install**: create a bookmark and paste the contents of `bookmarklet.txt` as its URL.
  - **Use**: load the bundle page fresh, click the bookmark, and the `.txt` downloads.
  - **Download**: `xargs -n 1 curl -fLO -C - < <file>.txt`. The links expire 24 h after the click.
  - **Rebuild**: `node build.mjs` after editing `humble-links.js`.
  - **Test**: `node --test`.
- [ ] **Step 7: Lint.** `biome check --write humble-links.js build.mjs test/`, then `biome check humble-links.js build.mjs test/` → exit 0. Then `node --test` → all pass, 0 warnings.

### Task 5: Live verification

No offline test can cover this task. It runs in a logged-in browser: the user clicks the bookmark, or I drive the user's Chrome if they allow it.

- [ ] **Step 1:** Install `bookmarklet.txt` as a bookmark. On a freshly loaded bundle page, check in DevTools that `self.__next_f.length === 0` and that `[...document.scripts].filter((s) => s.textContent.includes("self.__next_f.push([1,")).length >= 1`. This confirms that the data is read from the inline scripts (final-review finding C1).
- [ ] **Step 2:** Freshly load the Essential Knowledge bundle page and click the bookmark. Expected: a `.txt` with 24 URLs, and a success alert with no `Failed:` line.
  - If every title fails, read the response in DevTools → Network. If the server rejects the call for lack of `Next-Router-State-Tree`, add that header (spec, "Left to the builder"), add a test pinning it in Task 3's e2e, and rebuild.
- [ ] **Step 3:** Run `curl -fLO "$(head -1 <file>.txt)"` → exit 0, and an `.epub` lands with its real filename.
- [ ] **Step 4:** Repeat Step 2 on Dystopian Worlds (expect 59 URLs) and Judge Dredd (expect 102 URLs).
