#!/usr/bin/python3
"""Bounded host recovery hook for deployments predating the Owner route import."""
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

CONFIG = Path('/etc/astrastaff/caddy/production-candidate.Caddyfile')
FRAGMENT = Path('/etc/astrastaff/caddy/product-control.d/owner-review.caddy')
CADDY = '/opt/astrastaff/vendor/caddy/v2.10.2/caddy'
IMPORT = f'  import {FRAGMENT}\n'
OWNER_ROUTE = 'handle /owner-review-api/* { reverse_proxy 127.0.0.1:4188 }'


def compact(text):
    return re.sub(r'\s+', ' ', text.strip())


def render(config, fragment):
    if compact(fragment) != OWNER_ROUTE:
        raise ValueError('Owner fragment must contain only the reviewed loopback route')
    normalized = compact(config)
    occurrences = config.count('/owner-review-api')
    if IMPORT.strip() in config:
        if config.count(IMPORT.strip()) != 1 or occurrences:
            raise ValueError('duplicate or conflicting Owner route/import')
        return config
    if occurrences:
        if occurrences != 1 or OWNER_ROUTE not in normalized:
            raise ValueError('conflicting Owner route')
        return config  # Preserve the exact known inline route during initial installation.
    anchor = '  encode gzip\n'
    if config.count(anchor) != 1:
        raise ValueError('expected one production site routing anchor')
    return config.replace(anchor, anchor + IMPORT, 1)


def preserve(config_path, fragment_path, validator):
    """Testable operation; production entrypoint supplies fixed paths only."""
    if not fragment_path.exists():
        return False
    original = config_path.read_bytes()
    config = original.decode('utf-8')
    replacement = render(config, fragment_path.read_text(encoding='utf-8'))
    if replacement == config:
        return False
    descriptor, temporary = tempfile.mkstemp(prefix='.owner-review.', dir=config_path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(replacement.encode('utf-8'))
            output.flush()
            os.fsync(output.fileno())
        validator(temporary)
        # Do not overwrite a configuration changed by another writer during validation.
        if config_path.read_bytes() != original:
            raise RuntimeError('production Caddy config changed during validation')
        temporary.chmod(0o644)
        os.replace(temporary, config_path)
        return True
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def trusted(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError(f'untrusted root-owned path: {path}')


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Owner route preservation requires root')
    # Optional gateway installation: no fragment means no route or config change.
    if not FRAGMENT.exists():
        return
    for path in (CONFIG, CONFIG.parent, FRAGMENT, FRAGMENT.parent):
        trusted(path)
    trusted(Path(CADDY))
    preserve(CONFIG, FRAGMENT, lambda candidate: subprocess.run(
        [CADDY, 'validate', '--config', str(candidate), '--adapter', 'caddyfile'],
        check=True, timeout=30,
    ))


if __name__ == '__main__':
    main()
