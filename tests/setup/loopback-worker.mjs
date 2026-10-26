// Loopback HTTP server for child-process e2e tests. Runs inside a
// node:worker_threads Worker — never on the test thread — so a test can
// block in spawnSync on a CLI child while this server keeps answering it.
// (Serving from the test thread would deadlock: the thread blocked in
// spawnSync cannot run the server's event loop.)
import { createServer } from "node:http";
import { parentPort, workerData } from "node:worker_threads";

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = undefined;
    }
    parentPort.postMessage({
      type: "request",
      request: {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body,
      },
    });
    res.setHeader("content-type", "application/json");
    if (workerData.mode === "fail-500") {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, hint: `bad ${workerData.token}` }));
    } else {
      res.statusCode = 202;
      res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  parentPort.postMessage({ type: "listening", port: server.address().port });
});
