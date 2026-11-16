// Turns humble-links.js into a bookmark URL. index.html calls this in the
// browser, so the install link always matches the source next to it.

// The IIFE keeps top-level declarations out of the page's global scope (so a
// second click does not throw "already declared") and evaluates to undefined
// (so the browser does not replace the page with the result). The newline
// keeps a trailing // comment in the source from swallowing "})()".
export function buildBookmarklet(source) {
	return `javascript:${encodeURIComponent(`(()=>{${source}\n})()`)}`;
}
