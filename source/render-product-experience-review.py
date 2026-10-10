"""Reuse answer-me-with-html; add the single GitHub feedback client."""
import json, os, re, subprocess, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent
out=root.parent/'product-experience-review.html'
cli=Path(os.environ.get('ANSWER_HTML_CLI',str(Path.home()/'.codex/skills/answer-me-with-html/scripts/am.mjs')))
config=json.loads((root/'owner-control.config.json').read_text(encoding='utf-8'))
assert config['pageId']=='product-experience-review'
assert len({m['moduleId'] for m in config['modules']})==len(config['modules'])
assert all(re.fullmatch(r'[a-z][a-z0-9-]+',m['moduleId']) for m in config['modules'])
assert isinstance(config['pageRevision'],int)
draft=(root/'product-experience-review.md').read_text(encoding='utf-8')
result=subprocess.run(['node',str(cli),'render','-','-o',str(out),'--no-open'],input=draft,encoding='utf-8',capture_output=True,cwd=root)
print(result.stdout,end='');print(result.stderr,end='')
if result.returncode:raise SystemExit(result.returncode)
html=out.read_text(encoding='utf-8')
for panel_id in {m['panelId'] for m in config['modules']}:assert f'id="panel-{panel_id}"' in html
css=(root/'owner-control.css').read_text(encoding='utf-8');js=(root/'owner-control.js').read_text(encoding='utf-8')
assert '</style' not in css.lower() and '</script' not in js.lower()
payload=json.dumps(config,ensure_ascii=False,separators=(',',':')).replace('<',r'\u003c')
html=html.replace('</head>','<style id="owner-control-style">\n'+css+'</style>\n</head>',1)
html=html.replace('</body>','<script type="application/json" id="owner-control-config">'+payload+'</script>\n<script id="owner-control-client">\n'+js+'</script>\n</body>',1)
assert 'owner-control-sync.js' not in html and 'owner_token' not in html and '/api/owner-control' not in html
out.write_text(html,encoding='utf-8',newline='\n')
print(f'GitHub Owner feedback: {len(config["modules"])} modules, r{config["pageRevision"]}')
