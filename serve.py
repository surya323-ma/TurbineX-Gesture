"""Tiny static server with correct MIME types for .mjs / .wasm. Run: python serve.py"""
import http.server, socketserver
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm'}
with socketserver.TCPServer(('', 8000), H) as s:
    print('Open http://localhost:8000'); s.serve_forever()
