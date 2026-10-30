// Compiles the pure-logic modules to CommonJS and runs tests/unit/*.test.cjs with Node's built-in test runner.
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

rmSync(".test-build", { recursive: true, force: true });
const extra = process.env.TSC_FLAGS ?? "";
execSync(`npx tsc -p tsconfig.unit.json ${extra}`, { stdio: "inherit" });
mkdirSync(".test-build", { recursive: true });
writeFileSync(".test-build/package.json", JSON.stringify({ type: "commonjs" })); // the repo itself is "type": "module"
const files = readdirSync("tests/unit").filter((f) => f.endsWith(".test.cjs")).map((f) => `tests/unit/${f}`);
execSync(`node --test ${files.join(" ")}`, { stdio: "inherit" });
