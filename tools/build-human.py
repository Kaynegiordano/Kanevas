# Construit le corps 3D de Pose 3D (app/assets/pose3d/human.json + human.bin) à partir de MakeHuman (données CC0).
#   python -I tools/build-human.py [dossier_cache]
# Le cache garde les fichiers téléchargés ; sans argument il va dans tools/.mh-cache (ignoré par git).
# Contenu : maillage du corps + yeux (triangles), squelette par défaut (163 os), poids (4 os max par sommet),
# cibles de morphologie éparses (genre × muscles × poids, taille, proportions, poitrine, origines mélangées).
import json, os, struct, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', '.mh-cache')
OUT = os.path.join(ROOT, 'app', 'assets', 'pose3d')
RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/'
KEEP_GROUPS = {'body', 'helper-l-eye', 'helper-r-eye'}
LEVELS = ['min', 'average', 'max']


def fetch(rel):
    path = os.path.join(CACHE, rel.replace('/', os.sep))
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with urllib.request.urlopen(RAW + rel) as r, open(path + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(path + '.part', path)
    return path


def read_obj(path):
    verts, faces, group = [], [], None
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('v '):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('g '):
                group = line.split(None, 1)[1].strip()
            elif line.startswith('f ') and group in KEEP_GROUPS:
                idx = [int(p.split('/')[0]) - 1 for p in line.split()[1:]]
                for i in range(1, len(idx) - 1):
                    faces.append((idx[0], idx[i], idx[i + 1]))
    return verts, faces


def read_target(rel):
    out = []
    with open(fetch(rel), encoding='utf-8') as f:
        for line in f:
            p = line.split()
            if len(p) == 4 and not line.startswith('#'):
                out.append((int(p[0]), float(p[1]), float(p[2]), float(p[3])))
    return out


def targets():
    t = []
    for g in ('female', 'male'):
        for m in LEVELS:
            for w in LEVELS:
                t.append((f'u:{g}:{m}:{w}', f'targets/macrodetails/universal-{g}-young-{m}muscle-{w}weight.target'))
        for race in ('african', 'asian', 'caucasian'):
            t.append((f'race:{race}:{g}', f'targets/macrodetails/{race}-{g}-young.target'))
        for hh in ('min', 'max'):
            t.append((f'height:{g}:{hh}', f'targets/macrodetails/height/{g}-young-averagemuscle-averageweight-{hh}height.target'))
        t.append((f'prop:{g}', f'targets/macrodetails/proportions/{g}-young-averagemuscle-averageweight-idealproportions.target'))
    for cup in ('min', 'max'):
        t.append((f'cup:{cup}', f'targets/breast/female-young-averagemuscle-averageweight-{cup}cup-averagefirmness.target'))
    return t


def main():
    verts, faces = read_obj(fetch('3dobjs/base.obj'))
    skel = json.load(open(fetch('rigs/default.mhskel'), encoding='utf-8'))
    weights = json.load(open(fetch('rigs/default_weights.mhw'), encoding='utf-8'))['weights']

    # Os dans l'ordre parent avant enfant
    bones, order = skel['bones'], []
    def visit(name):
        if name in order: return
        par = bones[name]['parent']
        if par: visit(par)
        order.append(name)
    for name in sorted(bones): visit(name)
    index = {n: i for i, n in enumerate(order)}

    # 4 influences max par sommet, renormalisées
    per = [[] for _ in verts]
    for bone, lst in weights.items():
        for v, w in lst:
            per[v].append((w, index[bone]))
    skin_i, skin_w = [], []
    for lst in per:
        lst = sorted(lst, reverse=True)[:4] or [(1.0, index['root'])]
        s = sum(w for w, _ in lst) or 1
        lst += [(0.0, 0)] * (4 - len(lst))
        skin_i += [b for _, b in lst]
        skin_w += [w / s for w, _ in lst]

    used = sorted({joint for b in bones.values() for joint in (b['head'], b['tail'])})
    blob = bytearray()
    def put(fmt, data):
        while len(blob) % 4: blob.append(0)
        off = len(blob)
        blob.extend(struct.pack('<%d%s' % (len(data), fmt), *data))
        return off
    meta = {
        'source': 'MakeHuman 1.x (CC0) : base.obj, default.mhskel, default_weights.mhw, macrodetails',
        'vertexCount': len(verts),
        'positions': put('f', [c for v in verts for c in v]),
        'indexCount': len(faces) * 3,
        'indices': put('H', [i for f in faces for i in f]),
        'skinIndex': put('B', skin_i),
        'skinWeight': put('f', skin_w),
        'bones': [{'name': n, 'parent': bones[n]['parent'], 'head': bones[n]['head'], 'tail': bones[n]['tail']} for n in order],
        'joints': {j: skel['joints'][j] for j in used},
        'targets': {},
    }
    q = 1 / 4096  # deltas en unités MakeHuman (dm), quantifiés en int16
    for key, rel in targets():
        d = read_target(rel)
        meta['targets'][key] = {'count': len(d), 'scale': q,
                                'index': put('H', [x[0] for x in d]),
                                'delta': put('h', [max(-32767, min(32767, round(c / q))) for x in d for c in x[1:]])}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'human.bin'), 'wb') as f: f.write(blob)
    with open(os.path.join(OUT, 'human.json'), 'w', encoding='utf-8') as f: json.dump(meta, f, separators=(',', ':'))
    print('verts', len(verts), 'tris', len(faces), 'bones', len(order), 'targets', len(meta['targets']), 'bin', len(blob))


if __name__ == '__main__':
    main()
