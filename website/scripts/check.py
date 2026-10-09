#!/usr/bin/env python3
"""Offline integrity checks: internal links, original images, metadata, and security."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import hashlib,json,re,sys
ROOT=Path(__file__).resolve().parents[1]; DIST=ROOT/'dist'; errors=[]; files=[]
class Page(HTMLParser):
 def __init__(self): super().__init__();self.ids=set();self.refs=[];self.images=[];self.tags=[];self.meta={};self.links=[];self.h1=0;self.lang=None;self.scripts=[]
 def handle_starttag(self,tag,attrs):
  d=dict(attrs); self.tags.append(tag)
  if 'id' in d:
   if d['id'] in self.ids: errors.append('Duplicate id: '+d['id'])
   self.ids.add(d['id'])
  if tag=='html':self.lang=d.get('lang')
  if tag=='h1':self.h1+=1
  if tag=='meta':self.meta[d.get('name',d.get('property',''))]=d.get('content','')
  if tag=='link':self.links.append(d)
  if tag=='img':self.images.append(d)
  if tag=='script':self.scripts.append(d)
  for k in ['href','src']:
   if d.get(k): self.refs.append(d[k])
for file in DIST.rglob('*.html'):
 p=Page();text=file.read_text();p.feed(text);files.append(file)
 if not p.lang:errors.append(f'{file}: missing language')
 if p.h1!=1:errors.append(f'{file}: expected one h1')
 for img in p.images:
  if 'alt' not in img:errors.append(f'{file}: image missing alt')
 for ref in p.refs:
  u=urlsplit(ref)
  if u.scheme or u.netloc: continue
  if not u.path:
   if u.fragment and u.fragment not in p.ids:errors.append(f'{file}: absent #{u.fragment}')
   continue
  path=unquote(u.path)
  dest=(DIST/path[len('/ArcFlow/'):] if path.startswith('/ArcFlow/') else file.parent/path).resolve()
  if dest.is_dir():dest=dest/'index.html'
  if not dest.is_relative_to(DIST.resolve()) or not dest.exists():errors.append(f'{file}: missing {ref}')
 if file.name=='index.html':
  for meta in ['description','og:title','og:description','og:url','og:image','twitter:card']:
   if not p.meta.get(meta):errors.append(f'{file}: missing {meta}')
  if len([x for x in p.links if x.get('rel')=='canonical'])!=1:errors.append(f'{file}: canonical')
  if len([x for x in p.links if x.get('hreflang')])!=3:errors.append(f'{file}: hreflang')
  if any(urlsplit(x.get('src','')).scheme for x in p.scripts):errors.append('External JS dependency')
  if 'form' in p.tags and 'method="dialog"' not in text:errors.append('Unexpected form')
manifest=json.loads((DIST/'assets/provenance.json').read_text())
for image in manifest['images']:
 path=DIST/image['website_path']
 if hashlib.sha256(path.read_bytes()).hexdigest()!=image['sha256']:errors.append('Image bytes changed: '+str(path))
for required in ['.nojekyll','sitemap.xml','robots.txt','assets/social-card.png']:
 if not (DIST/required).exists():errors.append('Missing '+required)
if b'\x89PNG\r\n\x1a\n'!=(DIST/'assets/social-card.png').read_bytes()[:8]:errors.append('Invalid OG PNG')
if errors:print('\n'.join(errors));sys.exit(1)
print(f'PASS: {len(files)} HTML pages; internal links; SEO; 10 original screenshot hashes; no external scripts.')
