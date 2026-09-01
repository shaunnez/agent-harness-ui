import path from "node:path";
import { build } from "vite";

const requestedTop = Number.parseInt(
  process.argv.find((argument) => argument.startsWith("--top="))?.slice(6) ?? "15",
  10,
);
const top = Number.isFinite(requestedTop) && requestedTop > 0 ? requestedTop : 15;
const result = await build({ logLevel: "silent", build: { write: false } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap((buildResult) => buildResult.output);
const chunks = outputs.filter((output) => output.type === "chunk");

console.log("JavaScript chunks (uncompressed bytes):");
for (const chunk of [...chunks].sort((left, right) => right.code.length - left.code.length)) {
  const role = chunk.isEntry ? "entry" : chunk.isDynamicEntry ? "dynamic" : "shared";
  console.log(`${String(chunk.code.length).padStart(9)}  ${role.padEnd(7)}  ${chunk.fileName}`);
}

const modules = chunks
  .flatMap((chunk) =>
    Object.entries(chunk.modules).map(([id, details]) => ({
      bytes: details.renderedLength,
      chunk: chunk.fileName,
      module: path.relative(process.cwd(), id),
    })),
  )
  .sort((left, right) => right.bytes - left.bytes)
  .slice(0, top);

console.log(`\nTop ${modules.length} modules by Rollup rendered bytes:`);
for (const module of modules) {
  console.log(`${String(module.bytes).padStart(9)}  ${module.module}  (${module.chunk})`);
}
