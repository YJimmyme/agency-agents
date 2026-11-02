#!/usr/bin/env python3
"""Serve the employee portal and forward chat requests to a self-hosted model.

Runs on Python 3.8+ with the standard library only.

    python3 portal/scripts/serve_local.py                      # Ollama on this machine
    python3 portal/scripts/serve_local.py --upstream http://localhost:1234/v1 --model qwen3-8b   # LM Studio
    python3 portal/scripts/serve_local.py --upstream http://gpu-box:8000/v1 --host 0.0.0.0       # vLLM, shared on the LAN

Then open http://localhost:8000. The page sees /llm/ on its own origin, so the
model server needs no CORS settings, and the page switches itself to local mode.

/llm/<path> is forwarded to <upstream>/<path> (an OpenAI-compatible API, e.g.
/llm/chat/completions -> http://localhost:11434/v1/chat/completions), streaming.
If the model server needs a key, set LLM_API_KEY; it is added on the server side
and never reaches the browser.
"""
import argparse
import http.client
import json
import os
import sys
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORTAL_DIR = Path(__file__).resolve().parent.parent
HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer",
               "upgrade", "proxy-authorization", "proxy-authenticate", "host",
               "content-length", "origin", "referer", "cookie"}


class Handler(SimpleHTTPRequestHandler):
    upstream = None   # urllib.parse.SplitResult
    config = {}
    api_key = ""

    def log_message(self, fmt, *args):
        if self.path.startswith("/llm/"):
            sys.stderr.write("%s %s\n" % (self.command, fmt % args))

    def end_headers(self):
        # Data files change when the catalog is rebuilt; don't let the browser keep stale copies.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path == "/llm/__portal":
            return self.send_json(200, self.config)
        if self.path.startswith("/llm/"):
            return self.forward()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/llm/"):
            return self.forward()
        self.send_json(404, {"error": {"message": "not found"}})

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def forward(self):
        up = self.upstream
        path = up.path.rstrip("/") + "/" + self.path[len("/llm/"):]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_HEADERS}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        conn_cls = http.client.HTTPSConnection if up.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(up.hostname, up.port, timeout=600)
        try:
            conn.request(self.command, path, body=body, headers=headers)
            res = conn.getresponse()
        except OSError as e:
            conn.close()
            return self.send_json(502, {"error": {"message":
                "連不到模型伺服器 %s：%s。請確認它已經啟動，或用 --upstream 指定正確網址。" % (up.geturl(), e)}})
        try:
            self.send_response(res.status)
            for k, v in res.getheaders():
                if k.lower() not in HOP_HEADERS:
                    self.send_header(k, v)
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            while True:
                chunk = res.read1(65536) if hasattr(res, "read1") else res.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass   # the browser pressed 停止
        finally:
            conn.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--upstream", default=os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1"),
                    help="OpenAI-compatible base URL of your model server (default: Ollama, %(default)s)")
    ap.add_argument("--model", default=os.environ.get("LLM_MODEL", ""),
                    help="default model name shown in the page, e.g. qwen3:8b (the page can change it)")
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to let other computers on the LAN use it")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    up = urllib.parse.urlsplit(args.upstream)
    if up.scheme not in ("http", "https") or not up.hostname:
        ap.error("--upstream must look like http://host:port/v1")
    Handler.upstream = up
    Handler.api_key = os.environ.get("LLM_API_KEY", "")
    Handler.config = {"proxy": True, "model": args.model}

    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(PORTAL_DIR)))
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    print("員工入口（自架模型版）：http://%s:%d" % (shown, args.port))
    print("模型伺服器：%s%s" % (args.upstream, "（預設模型 %s）" % args.model if args.model else ""))
    if args.host == "0.0.0.0":
        print("已開放給區網其他電腦，用這台電腦的 IP 連線，例如 http://192.168.x.x:%d" % args.port)
    print("按 Ctrl+C 結束")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
