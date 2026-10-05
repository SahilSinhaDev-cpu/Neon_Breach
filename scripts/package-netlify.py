"""Produce a source-project ZIP with files at its root, never an outer folder."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parent.parent
output = root / 'netlify-ready-game.zip'
excluded_dirs = {'.git', '.netlify', '.vercel', 'node_modules', '__pycache__', '.cache', '.vite', '.codex', '.agents'}
excluded_files = {'netlify-ready-game.zip', 'neon-breach-source.tar.gz', '.DS_Store'}
required = {'netlify.toml', 'render.yaml', 'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'index.html', 'netlify/functions/game.ts', 'netlify/lib/authority.ts', 'client/connection.ts', 'client/realtime-connection.ts', 'client/http-connection.ts', 'server/app.ts', 'server/index.ts', 'public/game-config.json', 'dist/client/index.html', 'dist/functions/game.zip', 'dist/server/index.mjs', 'public/intro/neon-breach-1080p.mp4', 'public/intro/neon-breach-720p.mp4', 'dist/client/intro/neon-breach-1080p.mp4', 'dist/client/intro/neon-breach-720p.mp4', 'client/intro-video.ts', 'docs/INTRO.md'}
required |= {'client/menu-state.ts', 'client/navigation.ts', 'client/ui.ts', 'docs/NAVIGATION.md', 'tests/menu-browser.ts'}
required |= {'server/rejections.ts', 'docs/BUG-SWEEP.md', 'tests/bug-sweep-browser.ts'}
required |= {'client/fps.ts', 'client/render-quality.ts', 'docs/PERFORMANCE.md', 'tests/performance-browser.ts'}
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if not path.is_file() or path.is_symlink() or excluded_dirs.intersection(relative.parts):
            continue
        if path.name in excluded_files or path.name.endswith(('.log', '.tsbuildinfo')) or path.name.startswith('.env'):
            continue
        # Ship relevant acceptance evidence, not historical captures from art work.
        if relative.parts[0] == 'artifacts' and (len(relative.parts) < 3 or relative.parts[1] not in {'netlify', 'realtime', 'intro', 'menu', 'bug-sweep', 'performance'} or 'failure' in path.name):
            continue
        # The MP4s include the finished mix. Keep the uncompressed capture master
        # out of the release ZIP; its sources and reproducible renderer remain.
        if relative.parts[0] == 'artifacts' and path.suffix == '.wav':
            continue
        if relative.parts[0] == 'dist' and relative.parts[1] not in {'client', 'functions', 'server'}:
            continue
        archive.write(path, relative.as_posix())
with ZipFile(output) as archive:
    names = set(archive.namelist())
    assert required <= names, f'Missing required project files: {required - names}'
    assert archive.testzip() is None, 'ZIP integrity failure'
    assert not any(set(Path(name).parts) & excluded_dirs for name in names)
    assert not any(name.endswith('.log') for name in names)
    assert {name for name in names if name.startswith('netlify/functions/')} == {'netlify/functions/game.ts'}
print(json.dumps({'archive': output.name, 'files': len(names), 'bytes': output.stat().st_size,
                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2))
