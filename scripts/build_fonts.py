"""Builds the self-hosted UI fonts into public/fonts/ (run once after `npm i`).

Sources are the OFL-1.1 @fontsource-variable packages (devDependencies). Fraunces is pinned to the
logbook display style (opsz 72, SOFT 100, WONK 1) with a variable weight 500-800; all three are
subset to Latin-1 plus typographic punctuation. Usage: python scripts/build_fonts.py
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NM = os.path.join(ROOT, 'node_modules', '@fontsource-variable')
OUT = os.path.join(ROOT, 'public', 'fonts')
UNICODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [
    0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2032, 0x2033, 0x2192, 0x2190, 0x00D7, 0x2715]

JOBS = [
    ('fraunces/files/fraunces-latin-full-normal.woff2', 'fraunces-logbook.woff2', {'opsz': 72, 'SOFT': 100, 'WONK': 1, 'wght': (500, 800)}),
    ('nunito/files/nunito-latin-wght-normal.woff2', 'nunito.woff2', {'wght': (500, 1000)}),
    ('caveat/files/caveat-latin-wght-normal.woff2', 'caveat.woff2', {'wght': (500, 700)}),
]

os.makedirs(OUT, exist_ok=True)
for src, dst, axes in JOBS:
    f = TTFont(os.path.join(NM, src), lazy=False)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga', 'calt', 'tnum', 'lnum', 'pnum', 'case', 'ss01']
    opts.name_IDs = ['*']
    s = subset.Subsetter(opts)
    s.populate(unicodes=UNICODES)
    s.subset(f)
    f = instancer.instantiateVariableFont(f, axes)
    path = os.path.join(OUT, dst)
    f.flavor = 'woff2'
    f.save(path)
    print(dst, os.path.getsize(path) // 1024, 'KB')
