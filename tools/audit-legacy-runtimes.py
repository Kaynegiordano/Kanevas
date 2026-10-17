"""Audit final en lecture seule des sources, avant leur retrait explicitement autorisé."""
import hashlib
import json
from pathlib import Path
import time


def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def audit(report_file):
    report = json.loads(report_file.read_text(encoding='utf-8'))
    results = {}
    for name, component in report['components'].items():
        source, destination = Path(component['source']), Path(component['directory'])
        assert source.resolve().parent == Path(report['source']).resolve()
        assert destination.resolve().is_relative_to(Path(report['destination']).resolve())
        manifest = {item['path']: item for line in Path(component['manifest']).read_text(encoding='utf-8').splitlines() if (item := json.loads(line)) and not item.get('generated')}
        differences = []
        checked = 0
        for file in source.rglob('*'):
            if not file.is_file() or '__pycache__' in file.parts or file.suffix in ('.pyc', '.pyo'):
                continue
            relative = str(file.relative_to(source))
            item = manifest.get(relative)
            if not (destination / relative).is_file():
                differences.append({'path': relative, 'reason': 'missing destination'})
            elif not item or digest(file) != item['source_sha256']:
                # A file added/changed in the source is safe only if the destination already has identical bytes.
                if digest(file) != digest(destination / relative):
                    differences.append({'path': relative, 'reason': 'source changed since copy'})
            checked += 1
        results[name] = {'checked': checked, 'differences': differences}
        print(json.dumps({'component': name, **results[name]}), flush=True)
    result = {'checkedAt': time.time(), 'components': results, 'ok': all(not item['differences'] for item in results.values())}
    target = report_file.parent / 'legacy-audit.json'
    target.write_text(json.dumps(result, indent=2), encoding='utf-8')
    if not result['ok']:
        raise SystemExit('Différences à conserver avant retrait : ' + str(target))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    audit(parser.parse_args().report)
