#!/usr/bin/env python3
"""Build the static bilingual website with Python's standard library only."""
from pathlib import Path
from html import escape as e
import json, shutil, hashlib
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'
BASE='https://jamescube.github.io/ArcFlow/'
REPO='https://github.com/JamesCube/ArcFlow'
SHA='71910bfc2ac1b9d58e0f7f1b85e6bbb206321ec1'
DOC=REPO+'/blob/'+SHA+'/'
ARROW='<span aria-hidden="true">↗</span>'
def icon(path):
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>'
SYMBOLS={
    '↗':icon('M5 19 19 5M5 5h14v14'),
    '↓':icon('M12 4v16m-6-6 6 6 6-6'),
    '✓':icon('m5 12 4 4L19 6'),
    '✕':icon('m6 6 12 12M6 18 18 6'),
    '⌘':icon('M8 8h8v8H8zM8 8H5a3 3 0 1 1 3-3v3Zm8 0h3a3 3 0 1 0-3-3v3Zm0 8h3a3 3 0 1 1-3 3v-3Zm-8 0H5a3 3 0 1 0 3 3v-3Z'),
    '◈':icon('m12 2 10 10-10 10L2 12Zm0 6 4 4-4 4-4-4Z'),
    '▦':icon('M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18')
}

STAR='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>'
COMMAND='git clone https://github.com/JamesCube/ArcFlow.git\ncd ArcFlow\ngit checkout '+SHA+'\npython3 scripts/tryout.py --check\npython3 scripts/tryout.py'
content=json.loads((ROOT/'content.json').read_text())
dimensions={Path(i['website_path']).name:i for i in json.loads((ROOT/'assets/provenance.json').read_text())['images']}
if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir(); shutil.copytree(ROOT/'assets',OUT/'assets')
CSS='style.'+hashlib.sha256((ROOT/'style.css').read_bytes()).hexdigest()[:12]+'.css'
JS='app.'+hashlib.sha256((ROOT/'app.js').read_bytes()).hexdigest()[:12]+'.js'
shutil.copy2(ROOT/'style.css',OUT/CSS); shutil.copy2(ROOT/'app.js',OUT/JS)
for locale,c in content.items():
    prefix='../' if locale=='en' else './'
    canonical=BASE+('en/' if locale=='en' else '')
    language_link='../' if locale=='en' else './en/'
    links=['#designer','#scenarios','#capabilities','#start']
    nav=''.join(f'<a href="{href}">{e(label)}</a>' for label,href in zip(c['nav'],links))
    proof=''.join(f'<li><span class="step-number">{a}</span><div><h3>{b}</h3><p>{d}</p></div></li>' for a,b,d in c['proof'])
    features=''.join(f'<li><span class="small-check" aria-hidden="true">↗</span><div><h3>{a}</h3><p>{b}</p></div></li>' for a,b in c['designerFeatures'])
    tabs=''.join(f'<button type="button" role="tab" id="tab-{s["id"]}" aria-controls="panel-{s["id"]}" aria-selected="{str(i==0).lower()}" tabindex="{0 if i==0 else -1}">{s["tab"]}</button>' for i,s in enumerate(c['scenarios']))
    panels=''
    for i,s in enumerate(c['scenarios']):
        points=''.join(f'<li>{p}</li>' for p in s['points'])
        panels+=f'''<section class="scenario-panel" role="tabpanel" id="panel-{s['id']}" aria-labelledby="tab-{s['id']}" tabindex="0" {'hidden' if i else ''}>
        <div class="scenario-copy"><span class="eyebrow dark">{s['tag']}</span><h3>{s['title']}</h3><p>{s['body']}</p><ul class="check-list">{points}</ul><p class="boundary">{s['boundary']}</p><a class="text-link" href="{DOC+s['doc']}">{c['scenarioLink']} {ARROW}</a></div>
        <figure class="scenario-screen"><a class="zoom-link" href="{prefix}assets/{s['image']}" data-zoom aria-label="{e(c['expand']+' · '+s['tab'])}"><img src="{prefix}assets/{s['image']}" alt="{e(s['alt'])}" width="1440" height="{dimensions[s['image']]['height']}" loading="lazy" decoding="async"><span class="expand-label">{c['expand']} ↗</span></a></figure></section>'''
    layer_icons=['⌘','◈','▦']
    layers=''.join(f'<article class="layer"><div class="layer-top"><span>{a}</span><span class="layer-icon" aria-hidden="true">{layer_icons[i]}</span></div><h3>{b}</h3><p>{d}</p><p class="layer-note">{f}</p></article>' for i,(a,b,d,f) in enumerate(c['layers']))
    caps=''.join(f'<li><span class="badge {a}"><span aria-hidden="true">{["●","◐","○"][i]}</span> {b}</span><h3>{d}</h3><p>{f}</p></li>' for i,(a,b,d,f) in enumerate(c['caps']))
    version_urls=[REPO+'/commit/'+SHA,REPO+'/releases/tag/v0.1.0-alpha.3',REPO+'/pull/39']
    versions=''.join(f'<li><span>{a}</span><a href="{version_urls[i]}">{b} {ARROW}</a><p>{d}</p></li>' for i,(a,b,d) in enumerate(c['versions']))
    foot_urls=[REPO,REPO+'/issues',DOC+'docs/CAPABILITIES.md',DOC+'docs/ROADMAP.md']
    foot=''.join(f'<a href="{url}">{txt}</a>' for url,txt in zip(foot_urls,c['footerLinks']))
    flow=c['flowLabels']; heroimg=f'designer-02-insert-all-{locale}.png'
    structured={'@context':'https://schema.org','@type':'SoftwareSourceCode','name':'ArcFlow','description':c['description'],'codeRepository':REPO,'programmingLanguage':['Java','JavaScript'],'license':'https://www.apache.org/licenses/LICENSE-2.0','url':canonical}
    html=f'''<!doctype html>
<html lang="{c['lang']}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111e19"><title>{c['title']}</title><meta name="description" content="{e(c['description'])}"><link rel="canonical" href="{canonical}"><link rel="alternate" hreflang="zh-CN" href="{BASE}"><link rel="alternate" hreflang="en" href="{BASE}en/"><link rel="alternate" hreflang="x-default" href="{BASE}"><meta property="og:type" content="website"><meta property="og:site_name" content="ArcFlow"><meta property="og:title" content="{c['title']}"><meta property="og:description" content="{e(c['description'])}"><meta property="og:url" content="{canonical}"><meta property="og:image" content="{BASE}assets/social-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="ArcFlow. Your business. Your workflow."><meta property="og:locale" content="{'zh_CN' if locale=='zh' else 'en_US'}"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="{prefix}assets/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="{prefix}{CSS}"><script defer src="{prefix}{JS}"></script><script type="application/ld+json">{json.dumps(structured,ensure_ascii=False)}</script></head>
<body data-lang="{locale}"><a class="skip-link" href="#main">{c['skip']}</a>
<div class="hero-shell"><header class="site-header container"><a class="brand" href="{prefix}" aria-label="ArcFlow"><img src="{prefix}assets/logo.svg" width="36" height="36" alt=""><span>ArcFlow</span></a><nav aria-label="{'主导航' if locale=='zh' else 'Main navigation'}">{nav}</nav><div class="header-actions"><a class="language" href="{language_link}" lang="{'en' if locale=='zh' else 'zh-CN'}" hreflang="{'en' if locale=='zh' else 'zh-CN'}">{c['switch']}</a><a class="github-top" href="{REPO}">{STAR} GitHub {ARROW}</a></div></header></div>
<main id="main"><div class="hero-shell"><section class="hero container" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow"><span class="live-dot"></span>{c['eyebrow']}</p><h1 id="hero-title">{c['hero']}</h1><p class="hero-intro">{c['intro']}</p><div class="hero-actions"><a class="button button-lime" href="#start">{c['primary']} <span aria-hidden="true">↗</span></a><a class="button button-ghost" href="#product">{c['secondary']} <span aria-hidden="true">↓</span></a></div><p class="hero-note">{c['heroNote']}</p></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="route-line"></div><div class="floating-label label-one"><span class="tiny-square">01</span> DEFINE</div><div class="floating-label label-two"><span class="tiny-square">02</span> REVIEW <span class="mini-dot"></span></div><div class="floating-label label-three"><span class="tiny-square">03</span> APPROVE <span>✓</span></div><span class="art-axis">BUSINESS → PROCESS → DECISION</span></div></section>
<section id="product" class="product-stage container" aria-labelledby="product-title"><div class="product-heading"><div><p class="eyebrow">{c['screenLabel']}</p><h2 id="product-title">{c['screenTitle']}</h2></div><p>{c['screenSub']}</p></div><figure class="hero-screen"><div class="window-bar"><div class="window-dots" aria-hidden="true"><i></i><i></i><i></i></div><span>ArcFlow / Process designer</span><span class="window-status">● LOCAL DEMO</span></div><a class="zoom-link" href="{prefix}assets/{heroimg}" data-zoom aria-label="{c['expand']}"><img src="{prefix}assets/{heroimg}" alt="{'ArcFlow 真实流程设计器：顺序节点、ALL 会签人员和节点配置面板' if locale=='zh' else 'ArcFlow process designer showing sequential nodes, ALL approval participants, and node settings'}" width="1440" height="{dimensions[heroimg]['height']}" fetchpriority="high"><span class="expand-label">{c['expand']} ↗</span></a></figure><div class="screen-caption"><span>{c['screenNote']}</span><a href="{prefix}assets/provenance.json">{c['provenance']} ↗</a></div></section></div>
<section class="proof-strip"><ol class="container">{proof}</ol></section>
<section id="designer" class="section container split-section"><div><p class="eyebrow dark">{c['designerKicker']}</p><h2>{c['designerTitle']}</h2><p class="section-intro">{c['designerIntro']}</p><ul class="designer-features">{features}</ul><a class="text-link" href="{DOC}docs/DESIGNER_GALLERY.md">{c['designerLink']} {ARROW}</a></div><div class="flow-card"><div class="flow-meta"><span>WORKFLOW / 001</span><span class="badge ready">v2</span></div><div class="flow-start"><span></span>{flow[0]}</div><div class="flow-connector"></div><div class="flow-node"><span class="flow-num">01</span><div><strong>{flow[1]}</strong><small>{c['flowPerson']}</small></div><span class="mode">SINGLE</span></div><div class="flow-connector"></div><div class="flow-node node-active"><span class="flow-num">02</span><div><strong>{flow[2]}</strong><small>{c['flowAll']}</small><div class="avatars"><span>B</span><span>C</span><b>✓</b></div></div><span class="mode">ALL</span></div><div class="flow-connector"></div><div class="flow-node"><span class="flow-num">03</span><div><strong>{flow[3]}</strong><small>{c['flowFinal']}</small></div><span class="mode">SINGLE</span></div><div class="flow-connector"></div><div class="flow-start"><span class="complete-dot">✓</span>{flow[4]}</div><p class="flow-foot">{c['flowNote']}</p></div></section>
<section id="scenarios" class="scenario-section"><div class="container"><div class="section-heading"><div><p class="eyebrow dark">{c['scenariosKicker']}</p><h2>{c['scenariosTitle']}</h2></div><p class="section-intro">{c['scenariosIntro']}</p></div><div class="scenario-tabs" role="tablist" aria-label="{c['tabLabel']}">{tabs}</div><div class="scenario-panels">{panels}</div></div></section>
<section class="section container architecture"><div class="section-heading"><div><p class="eyebrow dark">{c['architectureKicker']}</p><h2>{c['architectureTitle']}</h2></div><p class="section-intro">{c['architectureIntro']}</p></div><div class="layers">{layers}</div></section>
<section id="capabilities" class="cap-section"><div class="container"><div class="section-heading"><div><p class="eyebrow">{c['capKicker']}</p><h2>{c['capTitle']}</h2></div><div><p class="section-intro">{c['capIntro']}</p><a class="text-link light" href="{DOC}docs/CAPABILITIES.md">{c['capLink']} {ARROW}</a></div></div><ul class="cap-list">{caps}</ul></div></section>
<section id="start" class="section container start-section"><div class="section-heading"><div><p class="eyebrow dark">{c['startKicker']}</p><h2>{c['startTitle']}</h2></div><p class="section-intro">{c['startIntro']}</p></div><div class="start-grid"><div><p class="requirements">{c['requirements']}</p><div class="terminal"><div class="terminal-bar"><span>{c['terminalLabel']}</span><button type="button" id="copy-command" data-copied="{c['copied']}" data-failed="{c['copyFail']}">{c['copy']}</button></div><pre tabindex="0"><code id="command">{e(COMMAND)}</code></pre><span id="copy-status" role="status" class="sr-only"></span></div><p class="run-note">{c['runNote']}</p><a class="text-link" href="{DOC}docs/TRYOUT.md">{c['startLink']} {ARROW}</a></div><aside class="versions"><h3>{c['versionsTitle']}</h3><ul>{versions}</ul></aside></div></section>
<section class="closing-section container"><div><h2>{c['closing']}</h2><p>{c['closingBody']}</p></div><a class="button button-dark" href="{REPO}">{STAR} {c['star']} {ARROW}</a></section>
</main><footer class="container"><div class="footer-top"><a class="brand" href="{prefix}"><img src="{prefix}assets/logo.svg" width="34" height="34" alt=""><span>ArcFlow</span></a><nav aria-label="{'页尾导航' if locale=='zh' else 'Footer navigation'}">{foot}</nav></div><div class="footer-bottom"><span>{c['footerNote']}</span><p>{c['footerDisclosure']}</p></div></footer>
<dialog id="image-dialog" aria-label="{c['expand']}"><form method="dialog"><button class="dialog-close" aria-label="{c['close']}">✕ <span>{c['close']}</span></button></form><img id="dialog-image" alt=""><p id="dialog-caption"></p></dialog><noscript><div class="noscript">{c['noJS']}</div><style>.scenario-tabs{{display:none}}.scenario-panel[hidden]{{display:grid;margin-top:28px}}</style></noscript></body></html>'''
    for symbol,svg in SYMBOLS.items(): html=html.replace(symbol,svg)
    dest=OUT/('en/index.html' if locale=='en' else 'index.html'); dest.parent.mkdir(exist_ok=True); dest.write_text(html)
(OUT/'.nojekyll').write_text('')
(OUT/'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: '+BASE+'sitemap.xml\n')
(OUT/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+BASE+'</loc></url><url><loc>'+BASE+'en/</loc></url></urlset>\n')
(OUT/'404.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · ArcFlow</title><body style="font:18px system-ui;background:#f6f7f0;color:#14201b;max-width:600px;margin:15vh auto;padding:30px"><p>ArcFlow / 404</p><h1>This step doesn’t exist.</h1><p>这个页面不存在。回到首页，重新开始。</p><a style="color:#254d35" href="/ArcFlow/">Back to ArcFlow →</a></body></html>')
print('Built 2 languages →',OUT)
