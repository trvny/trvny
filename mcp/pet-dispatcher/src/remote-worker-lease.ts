import { createHash } from "node:crypto";
import { once } from "node:events";
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
  const endpoint = ["\\\\", ".", "\\pipe\\pet-dispatcher-", digest].join("");
  const server = createServer((socket) => socket.destroy());

  try {
    server.listen(endpoint);
    await once(server, "listening");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      throw new Error("another Pet Dispatcher remote worker is already running");
    }
    throw error;
  }
  server.unref();

  let closed = false;
  return {    endpoint,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
