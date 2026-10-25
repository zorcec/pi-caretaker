import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigurationError,
  readCaretakerConfig,
} from "../src/config.js";

/**
 * Pins the provisional operator contract (ticket e443e5b4).
 *
 * Env names, requiredness, and defaults are chosen defaults pending the
 * owner's operator-contract decision — the tests pin exactly what the code reads today so a
 * rename breaks loudly in one place. Values never appear in errors.
 */
describe("caretaker configuration", () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
    for (const key of [
      "PI_CARETAKER_TOKEN",
      "PI_CARETAKER_HOST",
      "PI_CARETAKER_PORT",
      "PI_CARETAKER_QUEUE_CAPACITY",
    ]) {
      delete process.env[key];
    }
    const merged: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    return merged;
  }

  it("requires a non-empty bearer token and never leaks it", () => {
    for (const overrides of [{}, { PI_CARETAKER_TOKEN: undefined }]) {
      try {
        readCaretakerConfig(env(overrides));
        expect.unreachable("must throw without a token");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).code).toBe(
          "MISSING_WEBHOOK_TOKEN",
        );
        expect((error as Error).message).not.toContain("s3cr3t");
      }
    }
    const secret = "s3cr3t-token-value";
    const config = readCaretakerConfig(env({ PI_CARETAKER_TOKEN: secret }));
    expect(config.token).toBe(secret);
  });

  it("applies documented defaults", () => {
    const config = readCaretakerConfig(env({ PI_CARETAKER_TOKEN: "t" }));

    expect(config).toEqual({
      token: "t",
      host: "127.0.0.1",
      port: 8787,
      queueCapacity: 100,
    });
  });

  it("accepts explicit host, port 0 (OS-assigned, tests), and capacity", () => {
    const config = readCaretakerConfig(
      env({
        PI_CARETAKER_TOKEN: "t",
        PI_CARETAKER_HOST: "0.0.0.0",
        PI_CARETAKER_PORT: "0",
        PI_CARETAKER_QUEUE_CAPACITY: "5",
      }),
    );

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(0);
    expect(config.queueCapacity).toBe(5);
  });

  it.each(["abc", "-1", "65536", "3.5", "NaN"])(
    "rejects port %j with INVALID_PORT",
    (port) => {
      try {
        readCaretakerConfig(env({ PI_CARETAKER_TOKEN: "t", PI_CARETAKER_PORT: port }));
        expect.unreachable("must throw for a bad port");
      } catch (error) {
        expect((error as ConfigurationError).code).toBe("INVALID_PORT");
      }
    },
  );

  it.each(["0", "-3", "2.5", "lots", "NaN"])(
    "rejects capacity %j with INVALID_QUEUE_CAPACITY",
    (capacity) => {
      try {
        readCaretakerConfig(
          env({ PI_CARETAKER_TOKEN: "t", PI_CARETAKER_QUEUE_CAPACITY: capacity }),
        );
        expect.unreachable("must throw for a bad capacity");
      } catch (error) {
        expect((error as ConfigurationError).code).toBe(
          "INVALID_QUEUE_CAPACITY",
        );
      }
    },
  );

  it("ignores unrelated environment keys", () => {
    const config = readCaretakerConfig(
      env({ PI_CARETAKER_TOKEN: "t", PATH: "/usr/bin", HOME: "/root" }),
    );

    expect(config.token).toBe("t");
  });
});
