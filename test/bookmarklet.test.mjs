import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildBookmarklet } from "../site/bookmarklet.mjs";

const decode = (bookmarklet) =>
	decodeURIComponent(bookmarklet.slice("javascript:".length));

test("wrapper shape", () => {
	const bookmarklet = buildBookmarklet("x");
	assert.ok(bookmarklet.startsWith("javascript:"));
	assert.equal(decode(bookmarklet), "(()=>{x\n})()");
});

// A second click runs the code again in the same page, so top-level
// declarations must stay inside the wrapper; a non-undefined result would
// replace the page. Without a document the source exports instead of
// running main(), so no DOM is needed.
test("built bookmarklet returns undefined and survives a second click", () => {
	const source = readFileSync(
		new URL("../site/humble-links.js", import.meta.url),
		"utf8",
	);
	const code = decode(buildBookmarklet(source));
	const context = vm.createContext({ module: {} });
	assert.equal(vm.runInContext(code, context), undefined);
	assert.equal(vm.runInContext(code, context), undefined);
	assert.equal(typeof context.module.exports.main, "function");
});
