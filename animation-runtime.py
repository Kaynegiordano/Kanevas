"""Adaptateur du backend Animation installé dans KaneOS, sans modifier ses fichiers."""
import gc
import os
import runpy
import subprocess
import sys


def release_local(module):
    cache = getattr(module, '_cache', None)
    if isinstance(cache, dict):
        cache.clear()
    gc.collect()
    torch = sys.modules.get('torch')
    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()


def worker(script, args):
    sys.path.insert(0, os.path.dirname(script))
    if os.path.basename(script) == 'auto_anim.py':
        import wetools
        import forge_rebouche as forge
        original = forge.rebouche
        original_ready = forge.assure_forge

        def ready(*a, **kw):
            release_local(wetools)
            return original_ready(*a, **kw)

        forge.assure_forge = ready

        def rebuild(*a, **kw):
            # LaMa, SAM et ViTMatte ont terminé leurs découpes avant la diffusion.
            release_local(wetools)
            try:
                return original(*a, **kw)
            finally:
                try:
                    forge._json(forge.FORGE + '/sdapi/v1/unload-checkpoint', {}, timeout=60)
                except Exception as exc:
                    print('>> Libération du Studio : ' + str(exc), flush=True)

        forge.rebouche = rebuild
        # Le checkpoint du Studio reste la référence ; pas de substitution INPAINT_Kane.
        forge._checkpoint = lambda: None
    sys.argv = [script, *args]
    runpy.run_path(script, run_name='__main__')


def server(script, args):
    sys.path.insert(0, os.path.dirname(script))
    module = runpy.run_path(script, run_name='kane_animation')
    context = module['lance'].__globals__
    real_popen = subprocess.Popen

    # asyncio.windows_utils hérite de Popen au premier chargement de torch/SAM.
    # Une fonction de remplacement casse cet import ; conserver une vraie classe.
    class AnimationPopen(real_popen):
        def __init__(self, command, *a, **kw):
            if isinstance(command, list):
                for i, part in enumerate(command[1:], 1):
                    if os.path.basename(str(part)) in ('auto_anim.py', 'super_magique.py'):
                        command = command[:i] + [os.path.abspath(__file__), '--worker', part] + command[i + 1:]
                        break
            super().__init__(command, *a, **kw)

    subprocess.Popen = AnimationPopen
    original_sam = context['sam']

    def sam(*a, **kw):
        try:
            return original_sam(*a, **kw)
        finally:
            with context['_sam_verrou']:
                context['_sam'].clear()
                release_local(None)

    context['sam'] = sam
    port = int(args[args.index('--port') + 1]) if '--port' in args else 8780
    module['serveur'](port).serve_forever()


if __name__ == '__main__':
    mode, script, *args = sys.argv[1:]
    (worker if mode == '--worker' else server)(os.path.abspath(script), args)
