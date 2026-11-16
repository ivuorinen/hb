import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import lib from "../site/humble-links.js";

const { rscTextFromScripts, extractEntitlements, slugify } = lib;

// A made-up bundle page in the live page's shape: 4 downloads and a key, one
// title cut across two scripts, one entitlement repeated.
const PAGE = readFileSync(
	new URL("./fixtures/bundle-page.html.txt", import.meta.url),
	"utf8",
);

const rscFromHtml = (html) => rscTextFromScripts([html]);

test("extractEntitlements reads each DRM-free download once", () => {
	assert.deepEqual(extractEntitlements(rscFromHtml(PAGE)), [
		{ id: "e0000000-0000-4000-8000-000000000001", title: "Gender(s)" },
		{ id: "e0000000-0000-4000-8000-000000000002", title: "Post-Truth" },
		{
			id: "e0000000-0000-4000-8000-000000000003",
			title: 'An Author\'s "Handbook" & Notes',
		},
		{ id: "e0000000-0000-4000-8000-000000000004", title: "Macroeconomics" },
	]);
});

test("extractEntitlements unescapes and dedupes", () => {
	const one = String.raw`{"id":"00000000-0000-0000-0000-000000000000","title":"A \"B\" & C","type":"download_drm_free"}`;
	assert.deepEqual(extractEntitlements(one + one), [
		{ id: "00000000-0000-0000-0000-000000000000", title: 'A "B" & C' },
	]);
});

test("extractEntitlements stale page returns []", () => {
	assert.deepEqual(extractEntitlements('1:{"foo":1}\n'), []);
});

test("rscTextFromScripts joins type-1 push literals only", () => {
	assert.equal(
		rscTextFromScripts([
			String.raw`self.__next_f.push([1,"a\"b"])`,
			"(self.__next_f = self.__next_f || []).push([0])",
			"requestAnimationFrame(f)",
			String.raw`self.__next_f.push([1, "c\n"])self.__next_f.push([1,"d"])`,
		]),
		'a"bc\nd',
	);
	assert.equal(rscTextFromScripts([]), "");
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

test("chunkUrls keeps Next.js chunk scripts, deduped, scripts first", () => {
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

test("parseActionResponse empty success, failure, garbage", () => {
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

// The site's client reads only t.data.signedUrls of an ok result and treats
// an empty signedUrls object as "No signed URLs returned".
test("parseActionResponse reads only data.signedUrls of an ok result", () => {
	const withPageTree = `0:{"a":"$@1","f":[["https://support.humblebundle.com/x"]],"b":"t"}\n1:${JSON.stringify({ ok: true, data: { signedUrls: { m: { k: { "a.pdf": PDF } } } } })}\n`;
	assert.deepEqual(parseActionResponse(withPageTree), {
		ok: true,
		urls: [PDF],
	});
	assert.deepEqual(
		parseActionResponse(
			`${row0}1:{"ok":false,"error":"https://www.humblebundle.com/login"}\n`,
		),
		{ ok: false, urls: [] },
	);
	assert.deepEqual(
		parseActionResponse(`${row0}1:{"ok":true,"data":{"signedUrls":{}}}\n`),
		{ ok: false, urls: [] },
	);
});

const { main } = lib;

const ORIGINAL_TITLE = "Humble Book Bundle: Synthetic Test Bundle";
const FILENAME = "humble-book-bundle-synthetic-test-bundle.txt";
const GUARD = "Open a bundle page in your Humble library first.";
const RELOAD =
	"No downloads found in this page's data. Reload the page and click the bookmarklet again.";
const NO_HASH =
	"Could not find getSignedUrlsForEntitlements in the page scripts. Humble may have changed the site.";

const okResponse = (text) => ({
	ok: true,
	status: 200,
	text: async () => text,
});
const httpError = () => ({ ok: false, status: 500, text: async () => "" });
const signed = (id) => `https://cdn.humble.com/humblebundle/${id}.epub?t=x`;
const signedResponse = (id) =>
	okResponse(
		`${row0}1:${JSON.stringify({ ok: true, data: { signedUrls: { m: { k: { f: signed(id) } } } } })}\n`,
	);

// A fake browser window and modal: records every fetch, POST, saved file and
// modal update. The window has no alert(), so a leftover alert throws.
// The first chunk script fails to load; the second serves chunkText.
const BUNDLE_ID = "b0000000-0000-4000-8000-000000000000";

function makeEnv({
	nextF,
	inlineScripts = [],
	pathname = `/home/library/${BUNDLE_ID}`,
	chunkText = CHUNK,
	post = signedResponse,
}) {
	const shown = [];
	const ui = {
		progress: (done, total, links) =>
			shown.push(["progress", done, total, links]),
		end: (message, failed = []) => shown.push(["end", message, failed]),
	};
	const fetches = [];
	const posts = [];
	const saved = [];
	const blobs = new Map();
	const g = {
		__next_f: nextF,
		document: {
			title: ORIGINAL_TITLE,
			querySelectorAll: (selector) => {
				if (selector === "script[src]")
					return [{ src: `${C}missing.js` }, { src: `${C}35-4ue7z-wpe7.js` }];
				if (selector === "script:not([src])") return inlineScripts;
				return [];
			},
			createElement: () => {
				const a = {
					href: "",
					download: "",
					click: () =>
						saved.push({ download: a.download, blob: blobs.get(a.href) }),
					remove() {},
				};
				return a;
			},
			body: { append() {} },
		},
		performance: { getEntriesByType: () => [] },
		location: { href: `https://www.humblebundle.com${pathname}`, pathname },
		fetch: async (url, opts) => {
			fetches.push(url);
			if (opts?.method === "POST") {
				posts.push({ url, opts, title: g.document.title });
				return post(JSON.parse(opts.body)[0][0], posts.length);
			}
			if (url === `${C}missing.js`) throw new TypeError("Failed to fetch");
			return okResponse(chunkText);
		},
		URL: {
			createObjectURL: (blob) => {
				const url = `blob:${blobs.size}`;
				blobs.set(url, blob);
				return url;
			},
		},
		Blob,
		console: { log() {} },
	};
	return { g, ui, shown, fetches, posts, saved };
}

// The inline <script> elements of a saved page, shaped like DOM nodes.
const inlineScriptsOf = (html) =>
	[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
		(m) => ({ textContent: m[1] }),
	);

// Next.js's runtime drains self.__next_f on load (L.forEach(O),L.length=0,
// L.push=O), so on the live page the data is only in the inline scripts.
const bundlePage = () => ({
	nextF: [],
	inlineScripts: inlineScriptsOf(PAGE),
});

test("main reads page data from inline scripts when __next_f is drained", async () => {
	const env = makeEnv(bundlePage());
	await main(env.g, env.ui);
	assert.equal(env.posts.length, 4);
	assert.equal(env.saved.length, 1);
	assert.deepEqual(env.shown.at(-1), [
		"end",
		`Saved 4 links from 4 of 4 titles to ${FILENAME}.`,
		[],
	]);
});

test("main e2e: one title fails, the rest are saved", async () => {
	const env = makeEnv({
		...bundlePage(),
		post: (id, n) => (n === 4 ? httpError() : signedResponse(id)),
	});
	await main(env.g, env.ui);

	assert.equal(env.posts.length, 4);
	const [first] = env.posts;
	assert.equal(
		first.url,
		"https://www.humblebundle.com/home/library/b0000000-0000-4000-8000-000000000000",
	);
	assert.equal(first.opts.method, "POST");
	assert.equal(
		first.opts.headers["Next-Action"],
		"70b00827d4b26565187ffb00c9f0fb9626be55416a",
	);
	assert.equal(first.opts.headers.Accept, "text/x-component");
	assert.equal(
		first.opts.body,
		JSON.stringify([["e0000000-0000-4000-8000-000000000001"]]),
	);
	assert.equal(first.title, `1/4 ${ORIGINAL_TITLE}`);

	assert.equal(env.saved.length, 1);
	assert.equal(env.saved[0].download, FILENAME);
	const text = await env.saved[0].blob.text();
	assert.equal(
		text,
		[
			signed("e0000000-0000-4000-8000-000000000001"),
			signed("e0000000-0000-4000-8000-000000000002"),
			signed("e0000000-0000-4000-8000-000000000003"),
			"",
		].join("\n"),
	);

	// The count is of links collected so far, not of titles done: the failed
	// 4th title moves the bar but adds no link.
	assert.deepEqual(env.shown, [
		["progress", 0, 4, 0],
		["progress", 1, 4, 1],
		["progress", 2, 4, 2],
		["progress", 3, 4, 3],
		["progress", 4, 4, 3],
		[
			"end",
			`Saved 3 links from 3 of 4 titles to ${FILENAME}.`,
			["Macroeconomics"],
		],
	]);
	assert.equal(env.g.document.title, ORIGINAL_TITLE);
});

test("main all failed: no file, failures named", async () => {
	const env = makeEnv({ ...bundlePage(), post: httpError });
	await main(env.g, env.ui);
	assert.equal(env.saved.length, 0);
	assert.deepEqual(env.shown.at(-1), [
		"end",
		"No download links received.",
		[
			"Gender(s)",
			"Post-Truth",
			'An Author\'s "Handbook" & Notes',
			"Macroeconomics",
		],
	]);
	assert.equal(env.g.document.title, ORIGINAL_TITLE);
});

test("main guard: not a bundle page", async () => {
	const env = makeEnv({ nextF: undefined });
	await main(env.g, env.ui);
	assert.deepEqual(env.shown, [["end", GUARD, []]]);
	assert.equal(env.fetches.length, 0);
});

test("main stale page: no entitlements in __next_f", async () => {
	const env = makeEnv({
		nextF: [],
		inlineScripts: [
			{ textContent: String.raw`self.__next_f.push([1,"1:{\"foo\":1}\n"])` },
		],
	});
	await main(env.g, env.ui);
	assert.deepEqual(env.shown, [["end", RELOAD, []]]);
	assert.equal(env.fetches.length, 0);
});

test("main hash missing: no POSTs, no file", async () => {
	const env = makeEnv({ ...bundlePage(), chunkText: "nothing here" });
	await main(env.g, env.ui);
	assert.deepEqual(env.shown, [["end", NO_HASH, []]]);
	assert.equal(env.posts.length, 0);
	assert.equal(env.saved.length, 0);
});

const { pageId } = lib;

test("pageId reads the bundle id from row 0's canonical path", () => {
	assert.equal(pageId(rscFromHtml(PAGE)), BUNDLE_ID);
	assert.equal(
		pageId('0:{"P":null,"c":["","home","library","other-bundle"]}\n'),
		"other-bundle",
	);
	assert.equal(pageId('1:{"foo":1}\n'), null);
});

// In-app navigation from bundle A to bundle B leaves A's inline scripts in
// the DOM; saving A's links under B's name would be a wrong file.
test("main refuses page data from another bundle", async () => {
	const env = makeEnv({
		...bundlePage(),
		pathname: "/home/library/b0000000-0000-4000-8000-0000000000ff",
	});
	await main(env.g, env.ui);
	assert.deepEqual(env.shown, [["end", RELOAD, []]]);
	assert.equal(env.fetches.length, 0);
});
