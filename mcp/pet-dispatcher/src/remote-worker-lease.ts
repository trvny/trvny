import { createHash } from "node:crypto";
import { createServer } from "node:net";

export interface RemoteWorkerLease {
  endpoint: string;
  close(): Promise<void>;
}

export async function acquireRemoteWorkerLease(key: string): Promise<RemoteWorkerLease> {
  if (process.platform !== "win32") {
    throw new Error("remote worker singleton lease currently requires Windows");
  }
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  const endpoint = String.raw`\\.\pipe\pet-dispatcher-${digest}`;
  const server = createServer((socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      if (error.code === "EADDRINUSE") {
        reject(new Error("another Pet Dispatcher remote worker is already running"));
        return;
      }
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
  server.unref();

  let closed = false;
  return {
    endpoint,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
