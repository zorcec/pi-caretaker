import { Worker } from "node:worker_threads";

export interface RecordedRequest {
  method?: string;
  url?: string;
  auth?: string | undefined;
  body?: unknown;
}

export interface LoopbackServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/**
 * Start the loopback worker-thread HTTP server. The server records every
 * request it receives and answers per `mode`: `ok-202` acknowledges with
 * `{ok:true}`, `fail-500` answers 500 echoing the token (for redaction
 * proofs). `close()` terminates the worker — no keep-alive drain to hang
 * on, by construction.
 */
export function startLoopbackServer(
  workerData: { token: string; mode: "ok-202" | "fail-500" },
  timeoutMs = 5000,
): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    const requests: RecordedRequest[] = [];
    const worker = new Worker(
      new URL("./loopback-worker.mjs", import.meta.url),
      { workerData },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("loopback server did not start in time"));
    }, timeoutMs);
    worker.on(
      "message",
      (message: {
        type: string;
        port?: number;
        request?: RecordedRequest;
      }) => {
        if (message.type === "listening" && typeof message.port === "number") {
          clearTimeout(timer);
          resolve({
            url: `http://127.0.0.1:${message.port}`,
            requests,
            close: () => worker.terminate().then(() => undefined),
          });
        } else if (
          message.type === "request" &&
          message.request !== undefined
        ) {
          requests.push(message.request);
        }
      },
    );
    worker.on("error", (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
