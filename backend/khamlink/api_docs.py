"""Offline, CSP-compatible first-party API reference. No CDN or script dependency."""

import html
import json

STYLES = """
body{font:16px/1.7 system-ui,Tahoma,sans-serif;margin:0;background:#f6f5ef;color:#203e34}
main{max-width:980px;margin:auto;padding:24px}a{color:#245c47}h1{line-height:1.3}
details{margin:12px 0;padding:14px;border:1px solid #bdcbbd;border-radius:8px;background:#fff}
summary{cursor:pointer;overflow-wrap:anywhere}pre{overflow:auto;max-width:100%;font-size:14px}
a:focus-visible,summary:focus-visible{outline:3px solid #1c7355;outline-offset:4px}
code{font-family:ui-monospace,monospace}footer{margin-top:30px}
"""


def render(schema: dict) -> str:
    entries = []
    for path, methods in schema.get("paths", {}).items():
        for method, operation in methods.items():
            if method not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                continue
            access = (
                "Server-side bearer authentication and RBAC required"
                if "/admin/" in path
                else "Anonymous first-party route"
            )
            entries.append(
                f"<details><summary><strong>{html.escape(method.upper())}</strong> "
                f"{html.escape(path)} — {html.escape(operation.get('summary', ''))}</summary>"
                f"<p>{access}</p><pre>{html.escape(json.dumps(operation, ensure_ascii=False, indent=2))}</pre></details>"
            )
    models = html.escape(json.dumps(schema.get("components", {}), ensure_ascii=False, indent=2))
    return (
        '<!doctype html><html lang="th"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>KhamLink — API reference</title><link rel="stylesheet" href="/api/docs/styles.css">'
        '</head><body><main><a href="/">← กลับไป KhamLink</a><h1>KhamLink API</h1>'
        "<p>เอกสารสำหรับ API ภายใน · อ่านได้โดยไม่โหลดสคริปต์จากภายนอก</p>"
        '<p><a href="/api/openapi.json">OpenAPI JSON schema</a></p>'
        "<p>Application JSON responses use <code>data</code>, <code>meta.correlation_id</code>, "
        "and <code>error</code>. Error envelopes contain a stable code and safe Thai message. "
        "Source, curated, generated and user content retain separate provenance fields. "
        "The API schema/reference itself is not wrapped in this application envelope.</p>"
        "<p>Administrative POST calls with no body still require "
        "<code>Content-Type: application/json</code>. Never place bearer tokens in URLs.</p>"
        "<h2>Routes</h2>"
        + "".join(entries)
        + "<h2>Request models</h2><details><summary>Models and validation constraints</summary>"
        f"<pre>{models}</pre></details><footer>This reference is disabled in production.</footer>"
        "</main></body></html>"
    )
