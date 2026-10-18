import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

const source = await readFile(new URL("../src/posthog-init.js", import.meta.url), "utf8");
async function browserSetup(config, hostname = "localhost", fail = false) {
  const scripts = [], warnings = [], window = {};
  await runInNewContext("(async () => {" + source + "})()", {
    window, location: { hostname },
    document: { createElement: () => ({}), head: { append: (script) => scripts.push(script) } },
    fetch: async (path) => {
      assert.equal(path, "/posthog-config.json");
      if (fail) throw new Error("Offline");
      return { ok: true, json: async () => config };
    },
    console: { warn: (message) => warnings.push(message) },
  });
  return { scripts, warnings, posthog: window.posthog };
}

test("PostHog loads the correct regional SDK and queues game events until it arrives", async () => {
  for (const region of ["us", "eu"]) {
    const host = `https://${region}.i.posthog.com`;
    const ui = await browserSetup({ projectToken: "phc_test", host });
    assert.equal(ui.scripts.length, 1);
    assert.equal(ui.scripts[0].src, `https://${region}-assets.i.posthog.com/static/array.js`);
    assert.equal(ui.posthog.__SV, 1);
    assert.equal(ui.posthog._i[0][0], "phc_test");
    assert.equal(ui.posthog._i[0][1].api_host, host);
    assert.equal(ui.posthog._i[0][1].logs.environment, "development");
    ui.posthog.capture("projectile_attack_fired", { force: 1 });
    assert.deepEqual(JSON.parse(JSON.stringify(ui.posthog[0])), ["capture", "projectile_attack_fired", { force: 1 }]);
    assert.equal(ui.warnings.length, 0);
  }
});

test("missing or unavailable PostHog configuration never prevents gameplay", async () => {
  for (const [config, fail] of [[{}, false], [{ projectToken: "phc_test" }, false], [{}, true]]) {
    const ui = await browserSetup(config, "localhost", fail);
    assert.equal(ui.scripts.length, 0);
    assert.equal(ui.warnings.length, 1);
    assert.doesNotThrow(() => ui.posthog.capture("character_created", { ink_used: 1 }));
  }
});

test("the multiplayer server exposes only public analytics configuration and exports its startup log", { timeout: 12000 }, async (t) => {
  const requests = [];
  const collector = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ path: request.url, authorization: request.headers.authorization, body });
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  collector.listen(0, "127.0.0.1");
  await once(collector, "listening");
  t.after(() => new Promise((resolve) => collector.close(resolve)));
  const host = "http://127.0.0.1:" + collector.address().port;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", POSTHOG_PROJECT_TOKEN: "phc_test",
      POSTHOG_HOST: host, POSTHOG_PERSONAL_API_KEY: "private-test-value" },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });
  async function waitFor(check) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const value = check();
      if (value) return value;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("PostHog integration timed out: " + output);
  }
  const address = await waitFor(() => output.match(/Out-Mathed: (http:\/\/[^\s]+)/)?.[1]);
  const response = await fetch(address + "/posthog-config.json");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { projectToken: "phc_test", host });
  assert.equal((await fetch(address + "/.env")).status, 403);
  const log = await waitFor(() => requests.find((request) => request.body.includes("websocket server listening")));
  assert.equal(log.path, "/i/v1/logs");
  assert.equal(log.authorization, "Bearer phc_test");
  assert.ok(log.body.includes("out-mathed-websocket"));
});
