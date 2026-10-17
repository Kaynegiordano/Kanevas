import importlib.util
from pathlib import Path
import json
import tempfile

spec = importlib.util.spec_from_file_location('migration', Path(__file__).resolve().parents[1] / 'runtime-migrate.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='kanevas-copy-') as temporary:
    root = Path(temporary); source = root / 'source'; target = root / 'managed'
    for name in module.COMPONENTS.values():
        directory = source / name; directory.mkdir(parents=True)
        (directory / 'data.bin').write_bytes(bytes(range(256)))
        (directory / 'settings.json').write_text(json.dumps({'path': str(source / 'sd-webui-forge-classic' / 'input')}), encoding='utf-8')
    (source / 'models').mkdir()
    before = (source / 'ComfyUI' / 'settings.json').read_bytes()
    migration = module.Migration(source, target); migration.media = lambda: None; migration.plan(); migration.copy(); migration.verify()
    assert (source / 'ComfyUI' / 'settings.json').read_bytes() == before
    copied = json.loads((target / 'runtimes' / 'ComfyUI' / 'settings.json').read_text(encoding='utf-8'))
    assert str(target / 'runtimes' / 'studio') in copied['path']
    assert migration.report['deletionAllowed'] is False
    with module.exclusive(target):
        try:
            with module.exclusive(target): pass
        except RuntimeError: pass
        else: raise AssertionError('Copie concurrente acceptée')
    assert not (target / 'migration.lock').exists()
    (target / 'runtimes' / 'ComfyUI' / 'data.bin').write_bytes(b'corrupted')
    try: migration.verify()
    except RuntimeError: pass
    else: raise AssertionError('Corruption non détectée')
    try: module.Migration(source, source / 'ComfyUI' / 'managed')
    except ValueError: pass
    else: raise AssertionError('Destination imbriquée acceptée')
print('OK Copie réelle, chemins réparés uniquement dans les copies, SHA256, corruption détectée et sources intactes')
