import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = fileURLToPath(new URL("../hb.sh", import.meta.url));

// Source files are served as file:// URLs, which curl fetches like https://.
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "hb-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const src = join(root, "src");
	const work = join(root, "work");
	mkdirSync(src);
	mkdirSync(work);
	writeFileSync(join(src, "a.epub"), "A");
	writeFileSync(join(src, "b.pdf"), "B");
	return { src, work, url: (name) => pathToFileURL(join(src, name)).href };
}

// The list sits outside the working directory, so the folder has to come from
// the list's base name and land in the working directory.
function download({ src, work }, urls) {
	const list = join(src, "my-bundle.txt");
	writeFileSync(list, `${urls.join("\n")}\n`);
	return spawnSync("bash", [SCRIPT, list], { cwd: work, encoding: "utf8" });
}

test("downloads every URL into a folder named after the list", (t) => {
	const f = fixture(t);
	const result = download(f, [f.url("a.epub"), f.url("b.pdf")]);
	assert.equal(result.status, 0, result.stderr);
	const dir = join(f.work, "my-bundle");
	assert.deepEqual(readdirSync(dir).sort(), ["a.epub", "b.pdf"]);
	assert.equal(readFileSync(join(dir, "a.epub"), "utf8"), "A");
	assert.equal(readFileSync(join(dir, "b.pdf"), "utf8"), "B");
});

test("a failed URL fails the run after the rest download", (t) => {
	const f = fixture(t);
	const result = download(f, [f.url("missing.epub"), f.url("b.pdf")]);
	assert.notEqual(result.status, 0);
	assert.deepEqual(readdirSync(join(f.work, "my-bundle")), ["b.pdf"]);
});
