#!/usr/bin/env python3
"""Single-use private Codespaces file handoff; remove only after full response."""

import argparse
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import parse_qs, quote, urlsplit

from media import DOWNLOADS


def select_file(filename: str) -> Path:
    if filename != Path(filename).name or filename in {"", ".", ".."}:
        raise ValueError("Use one filename from 'devbox files', not a path")
    if DOWNLOADS.is_symlink():
        raise ValueError("Refusing symlinked download directory")
    file = DOWNLOADS / filename
    if not file.is_file() or file.is_symlink():
        raise ValueError("File not found or not a regular file")
    return file


def handler_for(file: Path, token: str):
    class Handoff(BaseHTTPRequestHandler):
        server_version = "DevboxHandoff/1"

        def log_message(self, *_args):
            pass  # Token never written to request logs.

        def headers(self, status: int, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
            self.end_headers()

        def do_GET(self):
            qs = parse_qs(urlsplit(self.path).query)
            if urlsplit(self.path).path != "/" or qs.get("token") != [token]:
                self.headers(404, "text/plain")
                return
            page = (
                "<!doctype html><meta name='viewport' content='width=device-width'>"
                "<title>Devbox handoff</title><h2>Ready to save</h2><p>"
                + escape(file.name)
                + "</p><form method='POST' action='/download'>"
                + "<input type='hidden' name='token' value='" + token + "'>"
                + "<button type='submit'>Download file</button></form>"
                + "<p>File is removed from Codespaces after full transfer.</p>"
            )
            self.headers(200, "text/html; charset=utf-8")
            self.wfile.write(page.encode("utf-8"))

        def do_POST(self):
            if self.path != "/download":
                self.headers(404, "text/plain")
                return
            try:
                count = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                count = 0
            if not 0 < count <= 2048:
                self.headers(400, "text/plain")
                return
            data = parse_qs(self.rfile.read(count).decode("utf-8", "replace"))
            if data.get("token") != [token]:
                self.headers(403, "text/plain")
                return
            # Claim before opening the source so double taps cannot download twice.
            with self.server.claim_lock:
                if self.server.completed or self.server.active:
                    self.headers(409, "text/plain")
                    return
                self.server.active = True
            try:
                with file.open("rb") as source:
                    before = os.fstat(source.fileno())
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(before.st_size))
                    self.send_header(
                        "Content-Disposition",
                        "attachment; filename=download; filename*=UTF-8''" + quote(file.name),
                    )
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.end_headers()
                    while data := source.read(1024 * 1024):
                        self.wfile.write(data)
                    self.wfile.flush()
                current = file.stat()
                if current.st_ino == before.st_ino and current.st_dev == before.st_dev and current.st_size == before.st_size:
                    file.unlink()
                    with self.server.claim_lock:
                        self.server.completed = True
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                # Partial transfers remain available for another attempt.
                return
            except OSError as exc:
                print(f"Handoff failed, file retained: {exc}", flush=True)
            finally:
                with self.server.claim_lock:
                    self.server.active = False

    return Handoff


def serve(filename: str, port: int, *, duration: int = 1800) -> None:
    file = select_file(filename)
    token = secrets.token_urlsafe(24)
    with ThreadingHTTPServer(("127.0.0.1", port), handler_for(file, token)) as server:
        server.daemon_threads = True
        server.completed = False
        server.active = False
        server.claim_lock = threading.Lock()
        server.timeout = 0.5
        codespace = os.environ.get("CODESPACE_NAME")
        if codespace:
            address = f"https://{codespace}-{server.server_port}.app.github.dev/?token={token}"
            print("Private Codespaces port only. Never set it to public.", flush=True)
        else:
            address = f"http://127.0.0.1:{server.server_port}/?token={token}"
        print(f"Open in your browser: {address}", flush=True)
        print("Click 'Download file'. Full stream => delete source; interrupted => keep.", flush=True)
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline and not server.completed:
            server.handle_request()
        if server.completed:
            print("Transfer stream complete; source file removed.", flush=True)
        else:
            print("Handoff expired; source file retained.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("filename", help="Exact filename from devbox files")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Port must be 1024..65535")
    try:
        serve(args.filename, args.port)
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
