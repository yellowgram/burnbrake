import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isEntryPoint } from "../src/cli.ts";

// npm installs the bin as a symlink, and the CLI used to
// compare import.meta.url with argv[1] directly, so `burnbrake --help` printed nothing and
// `burnbrake serve` exited at once. These tests run the CLI through a symlink.
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function linked(): { dir: string; bin: string } {
  const dir = mkdtempSync(join(tmpdir(), "bb-bin-"));
  const bin = join(dir, "burnbrake.ts");
  symlinkSync(cli, bin);
  return { dir, bin };
}

describe("the CLI runs when started through a symlink (installed bin)", () => {
  it("isEntryPoint resolves a symlinked argv[1] to the module file", () => {
    const { dir, bin } = linked();
    try {
      assert.equal(isEntryPoint(bin, pathToFileURL(cli).href), true);
      assert.equal(isEntryPoint(undefined, pathToFileURL(cli).href), false);
      assert.equal(isEntryPoint(join(dir, "missing.js"), pathToFileURL(cli).href), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--help through a symlink prints usage", () => {
    const { dir, bin } = linked();
    try {
      const r = spawnSync(process.execPath, ["--import", "tsx", bin, "--help"], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /BurnBrake — request-path spend governor/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serve through a symlink keeps running and listens", async () => {
    const { dir, bin } = linked();
    const child = spawn(process.execPath, ["--import", "tsx", bin, "serve"], {
      env: { ...process.env, BURNBRAKE_KEY: "bb_test_local_only_0000000000000000", BURNBRAKE_MOCK_UPSTREAM: "1", BURNBRAKE_PORT: "0", BURNBRAKE_LEDGER_PATH: join(dir, "l.sqlite") },
    });
    try {
      let out = "";
      const listening = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 8000);
        child.stdout.on("data", (d) => { out += d; if (/listening on http/.test(out)) { clearTimeout(t); resolve(true); } });
        child.on("exit", () => { clearTimeout(t); resolve(false); });
      });
      assert.equal(listening, true, `serve did not stay up: ${out}`);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(child.exitCode, null, "serve exited after starting");
    } finally {
      child.kill("SIGTERM");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
