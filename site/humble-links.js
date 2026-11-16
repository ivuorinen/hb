// Humble links: collect signed download URLs for every file of the Humble
// library bundle page this runs on, and save them one per line for curl.
// Design: docs/2026-11-14-humble-links-bookmarklet-design.md

const ENTITLEMENT_RE =
	/"id":"([0-9a-f-]{36})","title":"((?:[^"\\]|\\.)*)","type":"download_drm_free"/g;

// The server-rendered page streams its RSC payload as inline scripts:
// self.__next_f.push([1, "<JSON string literal>"]). The array itself cannot
// be read: Next.js's runtime drains it on load (L.forEach(O),L.length=0,
// L.push=O), but the script elements stay in the DOM.
const PUSH_RE = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;

function rscTextFromScripts(scriptTexts) {
	return scriptTexts
		.flatMap((text) => [...text.matchAll(PUSH_RE)])
		.map((m) => JSON.parse(m[1]))
		.join("");
}

// Row 0 of the payload carries the page's canonical path as segments:
// "c":["","home","library","<bundle id>"].
const PATH_RE = /"c":(\[""(?:,"(?:[^"\\]|\\.)*")*\])/;

function pageId(rscText) {
	const m = rscText.match(PATH_RE);
	return (m && JSON.parse(m[1]).at(-1)) || null;
}

function extractEntitlements(rscText) {
	const byId = new Map();
	for (const [, id, rawTitle] of rscText.matchAll(ENTITLEMENT_RE)) {
		if (!byId.has(id)) byId.set(id, JSON.parse(`"${rawTitle}"`));
	}
	return [...byId].map(([id, title]) => ({ id, title }));
}

function slugify(title) {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "humble-links";
}

const CHUNK_RE = /\/_next\/static\/chunks\/[^?#]+\.js(?:[?#]|$)/;
// Minified call site: createServerReference)("<hash>",x.callServer,void 0,
// x.findSourceMapURL,"getSignedUrlsForEntitlements"). The hash changes on
// every Humble deploy; the function name next to it does not.
const ACTION_RE = /"([0-9a-f]{40,})",[^"]*"getSignedUrlsForEntitlements"/;

function chunkUrls(scriptSrcs, resourceNames) {
	return [
		...new Set(
			[...scriptSrcs, ...resourceNames].filter((u) => CHUNK_RE.test(u)),
		),
	];
}

function findActionHash(chunkText) {
	return chunkText.match(ACTION_RE)?.[1] ?? null;
}

function collectHttpsStrings(value, out) {
	if (typeof value === "string") {
		if (value.startsWith("https://")) out.add(value);
	} else if (value && typeof value === "object") {
		for (const v of Object.values(value)) collectHttpsStrings(v, out);
	}
}

// Server Action responses are RSC rows, one per line: "<hex id>:<json>".
// Like the site's own client, read only data.signedUrls of the ok:true
// result ({machineName: {downloadKey: {filename: url}}}). An empty object
// is a failure ("No signed URLs returned"); a machine name without files
// (e.g. a region notice) is a success with no URLs.
function parseActionResponse(text) {
	for (const line of text.split("\n")) {
		const row = line.match(/^[0-9a-f]+:(.*)$/);
		if (!row) continue;
		let value;
		try {
			value = JSON.parse(row[1]);
		} catch {
			continue;
		}
		const signedUrls = value?.ok === true ? value.data?.signedUrls : null;
		if (signedUrls && typeof signedUrls === "object") {
			const urls = new Set();
			collectHttpsStrings(signedUrls, urls);
			return { ok: Object.keys(signedUrls).length > 0, urls: [...urls] };
		}
	}
	return { ok: false, urls: [] };
}

const MSG = {
	guard: "Open a bundle page in your Humble library first.",
	reload:
		"No downloads found in this page's data. Reload the page and click the bookmarklet again.",
	noHash:
		"Could not find getSignedUrlsForEntitlements in the page scripts. Humble may have changed the site.",
	noUrls: "No download links received.",
};

const MODAL_HTML = `<style>
dialog {
	box-sizing: border-box;
	width: min(28rem, calc(100vw - 2rem));
	padding: 1.25rem 1.5rem;
	border: 0;
	border-radius: 0.75rem;
	color-scheme: light dark;
	background: Canvas;
	color: CanvasText;
	font: 15px/1.45 system-ui, sans-serif;
	box-shadow: 0 0.5rem 2.5rem #0006;
}
dialog::backdrop { background: #0008; }
h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
progress { width: 100%; }
p { margin: 0.5rem 0 0; }
form { margin: 1rem 0 0; text-align: right; }
button { font: inherit; padding: 0.3rem 1rem; }
</style><dialog>
<h2>Humble links</h2>
<progress></progress>
<p class="status">Reading the page…</p>
<p class="message" hidden></p>
<p class="failed" hidden></p>
<form method="dialog" hidden><button>Close</button></form>
</dialog>`;

// A <dialog> in a shadow root, so the page's CSS cannot restyle it. Page text
// only ever goes in through textContent. Closing it removes it; end() brings
// it back, so closing it mid-run does not lose the result.
function modal(doc) {
	const host = doc.createElement("div");
	const root = host.attachShadow({ mode: "open" });
	root.innerHTML = MODAL_HTML;
	const $ = (selector) => root.querySelector(selector);
	const dialog = $("dialog");
	const bar = $("progress");
	dialog.addEventListener("close", () => host.remove());
	const open = () => {
		doc.body.append(host);
		dialog.showModal();
	};
	open();
	let started = false;
	return {
		progress(done, total, links) {
			started = true;
			bar.max = total;
			bar.value = done;
			$(".status").textContent =
				`${links} links collected from ${done} of ${total} titles`;
		},
		end(message, failed = []) {
			if (!host.isConnected) open();
			bar.hidden = !started;
			$(".status").hidden = true;
			$(".message").textContent = message;
			$(".message").hidden = false;
			$(".failed").textContent = `Failed: ${failed.join(", ")}`;
			$(".failed").hidden = failed.length === 0;
			$("form").hidden = false;
			$("button").focus();
		},
	};
}

async function fetchText(g, url, init) {
	const res = await g.fetch(url, init);
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
	return res.text();
}

async function findHash(g) {
	const scripts = [...g.document.querySelectorAll("script[src]")].map(
		(s) => s.src,
	);
	const resources = g.performance
		.getEntriesByType("resource")
		.map((e) => e.name);
	for (const url of chunkUrls(scripts, resources)) {
		try {
			const hash = findActionHash(await fetchText(g, url));
			if (hash) return hash;
		} catch {
			// A chunk that fails to load cannot hold the hash; try the next one.
		}
	}
	return null;
}

// The same Server Action call the page's download buttons make, one
// entitlement per request.
async function signedUrlsFor(g, hash, id) {
	const text = await fetchText(g, g.location.href, {
		method: "POST",
		headers: {
			"Next-Action": hash,
			Accept: "text/x-component",
			"Content-Type": "text/plain;charset=UTF-8",
		},
		body: JSON.stringify([[id]]),
	});
	const result = parseActionResponse(text);
	if (!result.ok) throw new Error("the action reported a failure");
	return result.urls;
}

function save(g, text, filename) {
	const a = g.document.createElement("a");
	a.href = g.URL.createObjectURL(new g.Blob([text], { type: "text/plain" }));
	a.download = filename;
	g.document.body.append(a);
	a.click();
	a.remove();
}

// All browser access goes through g (window in the browser, a fake in tests),
// and everything shown to the user through ui (the modal, a fake in tests).
async function main(g = globalThis, ui = modal(g.document)) {
	const originalTitle = g.document.title;
	try {
		if (!Array.isArray(g.__next_f)) {
			ui.end(MSG.guard);
			return;
		}
		const rsc = rscTextFromScripts(
			[...g.document.querySelectorAll("script:not([src])")].map(
				(s) => s.textContent,
			),
		);
		const entitlements = extractEntitlements(rsc);
		// In-app navigation leaves the previous page's scripts in the DOM:
		// only trust data whose canonical path names the bundle in the URL.
		const urlId = g.location.pathname.split("/").filter(Boolean).at(-1);
		if (entitlements.length === 0 || pageId(rsc) !== urlId) {
			ui.end(MSG.reload);
			return;
		}
		const hash = await findHash(g);
		if (!hash) {
			ui.end(MSG.noHash);
			return;
		}

		const total = entitlements.length;
		const urls = new Set();
		const failed = [];
		ui.progress(0, total, 0);
		for (const [i, { id, title }] of entitlements.entries()) {
			g.document.title = `${i + 1}/${total} ${originalTitle}`;
			try {
				for (const url of await signedUrlsFor(g, hash, id)) urls.add(url);
			} catch {
				failed.push(title);
			}
			ui.progress(i + 1, total, urls.size);
		}

		if (urls.size === 0) {
			ui.end(MSG.noUrls, failed);
			return;
		}
		const filename = `${slugify(originalTitle)}.txt`;
		const text = `${[...urls].join("\n")}\n`;
		g.console.log(text);
		save(g, text, filename);
		ui.end(
			`Saved ${urls.size} links from ${total - failed.length} of ${total} titles to ${filename}.`,
			failed,
		);
	} catch (err) {
		ui.end(err.message);
	} finally {
		g.document.title = originalTitle;
	}
}

if (typeof document === "undefined") {
	module.exports = {
		rscTextFromScripts,
		pageId,
		extractEntitlements,
		slugify,
		chunkUrls,
		findActionHash,
		parseActionResponse,
		main,
	};
} else {
	main();
}
