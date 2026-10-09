#!/usr/bin/env python3
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
class Handler(SimpleHTTPRequestHandler):
 def translate_path(self,path):
  if path.startswith('/ArcFlow/'):path=path[len('/ArcFlow'):]
  return super().translate_path(path)
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(Path(__file__).resolve().parents[1]/'dist'),**kwargs)
ThreadingHTTPServer(('127.0.0.1',8787),Handler).serve_forever()
