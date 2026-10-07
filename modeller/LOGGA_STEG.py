#!/usr/bin/env python3
"""Skriver en rad med tidsstampel i modeller/<mapp>/status.txt (visas som tidslinje under
fliken Skrivare > Modellering live).

Anvandning:  python LOGGA_STEG.py <mapp> "Text om steget"
Exempel:     python LOGGA_STEG.py skinkkorg-v2 "Renderar jamforelsebilder"
Format:      2026-10-07 20:15:03 | Text om steget
"""
import os
import re
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    mapp, text = sys.argv[1], ' '.join(sys.argv[2:]).replace('\r', ' ').replace('\n', ' ').strip()
    if not re.fullmatch(r'[A-Za-z0-9._-]+', mapp) or mapp in ('.', '..'):
        print('Ogiltigt mappnamn:', mapp)
        return 2
    d = os.path.join(HERE, mapp)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'status.txt'), 'a', encoding='utf-8') as fh:
        fh.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} | {text}\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
