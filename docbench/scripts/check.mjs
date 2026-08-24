import { access, readFile } from "node:fs/promises";

for (const path of [
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/vendor/js-yaml.min.js",
  "public/portable.html",
]) {
  await access(path);
}

const portable = await readFile("public/portable.html", "utf8");
for (const leaked of ["/vendor/js-yaml.min.js", "/app.js", "/styles.css"]) {
  if (portable.includes(leaked)) throw new Error(`Portable build still references ${leaked}`);
}
if (!portable.includes("jsyaml")) throw new Error("Portable build is missing YAML runtime");
for (const external of ['src="http', "src='http", 'href="http', "href='http"]) {
  if (portable.includes(external)) throw new Error("Portable build must not load third-party resources");
}
console.log("Doc Bench static checks passed.");
