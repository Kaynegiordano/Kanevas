"""Contrôle des hooks sur modèles simulés, sans GPU ni modèles téléchargés."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('animation_runtime', Path(__file__).resolve().parents[1] / 'animation-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
events = []
wetools = SimpleNamespace(_cache={'lama': object(), 'vm': object()})
torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, empty_cache=lambda: events.append('empty')))


def rebuild(*a, **kw):
    assert not wetools._cache
    assert forge._checkpoint() is None
    events.append('diffusion')
    return 'fond'


forge = SimpleNamespace(rebouche=rebuild, assure_forge=lambda: events.append('ready'), _checkpoint=lambda: 'ancien', FORGE='http://127.0.0.1:7862',
                        _json=lambda *a, **kw: events.append('unload'))


def execute(*a, **kw):
    forge.assure_forge()
    assert forge.rebouche() == 'fond'


original_argv, original_path = sys.argv[:], sys.path[:]
try:
    with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, torch=torch), patch.object(runtime.runpy, 'run_path', execute):
        runtime.worker('C:/fixture/auto_anim.py', [])
        assert events == ['empty', 'ready', 'empty', 'diffusion', 'unload']
    events.clear()
    forge.rebouche = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('GPU simulé'))
    with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, torch=torch), patch.object(runtime.runpy, 'run_path', lambda *a, **kw: forge.rebouche()):
        try:
            runtime.worker('C:/fixture/auto_anim.py', [])
        except RuntimeError:
            pass
        else:
            raise AssertionError('Erreur attendue')
        assert events == ['empty', 'unload']
finally:
    sys.argv[:], sys.path[:] = original_argv, original_path
print('OK LaMa et ViTMatte libérés avant diffusion, checkpoint Studio conservé, décharge même après erreur')

# Le serveur conserve ses routes et passe les workers par le même adaptateur.
import threading
context = {'_sam': {'m': object()}, '_sam_verrou': threading.Lock()}
exec('def lance(): pass\ndef sam(): return "mask"', context)
commands = []

def serve_forever():
    assert context['sam']() == 'mask'
    assert not context['_sam']
    runtime.subprocess.Popen(['python', '-u', 'C:/tools/auto_anim.py', '--titre', 'Test'])
    assert commands[-1][2:5] == [str(Path(runtime.__file__).resolve()), '--worker', 'C:/tools/auto_anim.py']
    runtime.subprocess.Popen(['python', '-u', 'C:/tools/depth.py'])
    assert commands[-1] == ['python', '-u', 'C:/tools/depth.py']

context['serveur'] = lambda port: SimpleNamespace(serve_forever=serve_forever)
with patch.dict(sys.modules, torch=torch), patch.object(runtime.runpy, 'run_path', lambda *a, **kw: context), patch.object(runtime.subprocess, 'Popen', lambda command, *a, **kw: commands.append(command)):
    runtime.server('C:/tools/peintre.py', ['--port', '18780'])
print('OK Serveur : SAM libéré après segmentation, workers Animation adaptés, autres scripts conservés')
