import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseSecretsEnv,
  resolveStartConfig,
} from "../../scripts/start.mjs";
import {
  buildAlertPayload,
  DEFAULT_ALERT_MESSAGE,
  formatAlertOutcome,
  parseAlertMessage,
  resolveAlertConfig,
} from "../../scripts/send-alert.mjs";
import {
  createRepoFixture,
  type RepoFixture,
} from "../setup/repo-fixture.js";
import { REPO_ROOT } from "../setup/repo-fixture.js";
import { startLoopbackServer } from "../setup/loopback-server.js";

/**
 * Operator CLIs (`pnpm start`, `pnpm send:alert`) are executables, so each
 * behavior is proven twice, like the other guard scripts: unit tests pin
 * the pure decision functions in-process, and child-process runs against
 * scratch fixtures prove exit codes and the human-readable messages.
 *
 * Fixture copies (not the real repo scripts) run as children, so the real
 * repo-root secrets.env can never leak into a case or flip one. The
 * loopback HTTP server runs on a worker thread: serving from the test
 * thread would deadlock against spawnSync, which blocks the event loop
 * while the CLI child waits for a response.
 */

let active: RepoFixture | undefined;

afterEach(() => {
  active?.dispose();
  active = undefined;
});

function scriptFixture(): RepoFixture {
  const fixture = createRepoFixture();
  active = fixture;
  for (const name of ["start.mjs", "send-alert.mjs"]) {
    fixture.write(
      `scripts/${name}`,
      readFileSync(join(REPO_ROOT, "scripts", name), "utf8"),
    );
  }
  return fixture;
}

/** Env with the caretaker token provably absent (empty beats any ambient value). */
function noTokenEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...extra, PI_CARETAKER_TOKEN: "" };
}

describe("parseSecretsEnv", () => {
  it("parses KEY=VALUE lines and skips blanks, comments, and malformed lines", () => {
    expect(
      parseSecretsEnv(
        "# comment\n\nA=1\nB = spaced \nMALFORMED\n=novalue\nC=a=b\n",
      ),
    ).toEqual({ A: "1", B: "spaced", C: "a=b" });
  });

  it("parses empty input to no variables", () => {
    expect(parseSecretsEnv("")).toEqual({});
  });
});

describe("resolveStartConfig", () => {
  it("refuses to boot without a token, naming generation, exit 2", () => {
    const plan = resolveStartConfig({
      env: noTokenEnv(),
      secretsText: "",
      hasDist: true,
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.exitCode).toBe(2);
      expect(plan.message).toContain("PI_CARETAKER_TOKEN");
      expect(plan.message).toContain("openssl rand -hex 24");
    }
  });

  it("reads the token from the secrets file when the env is silent", () => {
    const plan = resolveStartConfig({
      env: {},
      secretsText: "PI_CARETAKER_TOKEN=file-token\n",
      hasDist: true,
    });

    expect(plan).toEqual({
      ok: true,
      command: "pi",
      args: ["--extension", "./dist/index.js"],
    });
  });

  it("treats an omitted secrets file as empty", () => {
    const plan = resolveStartConfig({
      env: { PI_CARETAKER_TOKEN: "t" },
      hasDist: true,
    });

    expect(plan.ok).toBe(true);
  });

  it("prefers the operator environment over the secrets file", () => {
    const plan = resolveStartConfig({
      env: { PI_CARETAKER_TOKEN: "env-token" },
      secretsText: "PI_CARETAKER_TOKEN=file-token\n",
      hasDist: true,
    });

    expect(plan.ok).toBe(true);
  });

  it("refuses to boot without a bundle, naming the build", () => {
    const plan = resolveStartConfig({
      env: { PI_CARETAKER_TOKEN: "t" },
      secretsText: "",
      hasDist: false,
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.exitCode).toBe(1);
      expect(plan.message).toContain("pnpm build");
    }
  });
});

describe("send-alert pure functions", () => {
  it("defaults the message when no text is given, joins argv otherwise", () => {
    expect(parseAlertMessage([])).toBe(DEFAULT_ALERT_MESSAGE);
    expect(parseAlertMessage(["  "])).toBe(DEFAULT_ALERT_MESSAGE);
    expect(parseAlertMessage(["host", "dark"])).toBe("host dark");
  });

  it("builds the fixed drill envelope around the message", () => {
    expect(buildAlertPayload("drill text")).toEqual({
      source: "drill",
      host: "server-b",
      event: "host_dark",
      message: "drill text",
    });
  });

  it("requires the token and defaults host and port", () => {
    const missing = resolveAlertConfig({ env: noTokenEnv(), secretsText: "" });
    expect(missing.ok).toBe(false);

    const config = resolveAlertConfig({
      env: { PI_CARETAKER_TOKEN: "t" },
      secretsText: "",
    });
    expect(config).toEqual({
      ok: true,
      host: "127.0.0.1",
      port: "8787",
      token: "t",
    });
    expect(
      resolveAlertConfig({
        env: {
          PI_CARETAKER_TOKEN: "t",
          PI_CARETAKER_HOST: "example.test",
          PI_CARETAKER_PORT: "1234",
        },
        secretsText: "",
      }),
    ).toEqual({
      ok: true,
      host: "example.test",
      port: "1234",
      token: "t",
    });
  });

  it("celebrates 202 and redacts the token from failure bodies", () => {
    expect(formatAlertOutcome(202, "{}", "tok")).toEqual({
      ok: true,
      exitCode: 0,
      log: "HTTP 202: queued; phone buzz = escape hatch live.",
    });

    const bad = formatAlertOutcome(500, `denied for tok\nretry`, "tok");
    expect(bad.ok).toBe(false);
    expect(bad.exitCode).toBe(1);
    expect(bad.error).toContain("[REDACTED]");
    expect(bad.error).not.toContain("tok");
  });
});

describe("operator CLIs as child processes", () => {
  it("start.mjs exits 2 with instructions when no token exists", () => {
    const fixture = scriptFixture();
    const result = fixture.runScript("scripts/start.mjs", {
      env: noTokenEnv(),
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("PI_CARETAKER_TOKEN");
    expect(result.stderr).toContain("openssl rand -hex 24");
  });

  it("send-alert.mjs refuses without a token and never touches the network", () => {
    const fixture = scriptFixture();
    const result = fixture.runScript("scripts/send-alert.mjs", {
      env: noTokenEnv(),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PI_CARETAKER_TOKEN");
  });

  it("send-alert.mjs POSTs the drill envelope with a bearer token", async () => {
    const server = await startLoopbackServer({
      token: "test-token-1",
      mode: "ok-202",
    });
    try {
      const fixture = scriptFixture();
      const result = fixture.runScript("scripts/send-alert.mjs", {
        args: ["custom drill text"],
        env: {
          PI_CARETAKER_TOKEN: "test-token-1",
          PI_CARETAKER_HOST: "127.0.0.1",
          PI_CARETAKER_PORT: new URL(server.url).port,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("HTTP 202");
      // Worker messages arrive on the event loop, which spawnSync blocked:
      // yield before asserting on what the server saw.
      const start = Date.now();
      while (server.requests.length < 1 && Date.now() - start < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toEqual({
        method: "POST",
        url: "/events",
        auth: "Bearer test-token-1",
        body: {
          source: "drill",
          host: "server-b",
          event: "host_dark",
          message: "custom drill text",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("send-alert.mjs redacts the token from a failure body", async () => {
    const server = await startLoopbackServer({
      token: "test-token-2",
      mode: "fail-500",
    });
    try {
      const fixture = scriptFixture();
      const result = fixture.runScript("scripts/send-alert.mjs", {
        env: {
          PI_CARETAKER_TOKEN: "test-token-2",
          PI_CARETAKER_HOST: "127.0.0.1",
          PI_CARETAKER_PORT: new URL(server.url).port,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("[REDACTED]");
      expect(result.stderr).not.toContain("test-token-2");
    } finally {
      await server.close();
    }
  });
});
