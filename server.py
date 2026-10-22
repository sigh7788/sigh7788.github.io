#!/usr/bin/env python3
"""
投资日课 · 本地服务
- 托管静态页面（手机同一 WiFi 访问）
- 接收并保存学习进度到 data_store/progress.json
- 同步生成人类可读的 学习报告.md
"""
import json
import os
import socket
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STORE = ROOT / "data_store"
PROGRESS_FILE = STORE / "progress.json"
REPORT_FILE = ROOT / "学习报告.md"

MIME_EXTRA = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # -- helpers ---------------------------------------------------------
    def _send_json(self, obj, code: int = 200) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def guess_type(self, path):
        ext = Path(path).suffix.lower()
        if ext in MIME_EXTRA:
            return MIME_EXTRA[ext]
        return super().guess_type(path)

    # -- routes ----------------------------------------------------------
    def do_GET(self) -> None:
        route = self.path.split("?")[0]
        if route == "/api/progress":
            if PROGRESS_FILE.exists():
                try:
                    payload = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    payload = {}
            else:
                payload = {}
            return self._send_json(payload)
        if route == "/api/health":
            return self._send_json({"ok": True, "ts": int(time.time())})
        return super().do_GET()

    def do_POST(self) -> None:
        route = self.path.split("?")[0]
        if route != "/api/progress":
            return self.send_error(404, "Not found")

        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._send_json({"ok": False, "error": "bad json"}, 400)

        progress = payload.get("progress")
        report = payload.get("report") or ""
        if not isinstance(progress, dict):
            return self._send_json({"ok": False, "error": "missing progress"}, 400)

        record = {"progress": progress, "savedAt": time.strftime("%Y-%m-%d %H:%M:%S")}
        try:
            atomic_write(PROGRESS_FILE, json.dumps(record, ensure_ascii=False, indent=2))
            if report.strip():
                atomic_write(REPORT_FILE, report.rstrip() + "\n")
        except OSError as exc:
            return self._send_json({"ok": False, "error": str(exc)}, 500)

        return self._send_json({"ok": True})

    # -- logging ---------------------------------------------------------
    def log_message(self, fmt: str, *args) -> None:
        if "/api/progress" in (args[0] if args else ""):
            return
        sys.stderr.write("%s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


def build_server(start_port: int):
    for port in range(start_port, start_port + 20):
        try:
            httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
            return httpd, port
        except OSError:
            continue
    raise SystemExit("端口都被占用了，试试 PORT=9000 python3 server.py")


def main() -> None:
    start_port = int(os.environ.get("PORT", "8765"))
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        start_port = int(sys.argv[1])

    STORE.mkdir(parents=True, exist_ok=True)
    httpd, port = build_server(start_port)
    ip = lan_ip()

    print()
    print("  投资日课 已启动")
    print("  " + "-" * 46)
    print("  电脑：  http://127.0.0.1:%d" % port)
    print("  手机：  http://%s:%d" % (ip, port))
    print("  " + "-" * 46)
    print("  手机与电脑连同一个 WiFi，用浏览器打开上面的「手机」地址。")
    print("  进度会自动存到 data_store/progress.json 和 学习报告.md")
    print("  按 Ctrl+C 停止")
    print()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
