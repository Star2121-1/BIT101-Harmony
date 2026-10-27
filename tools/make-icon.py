#!/usr/bin/env python3
"""按「鸽子占画布宽度的百分比」重新生成鸿蒙桌面图标前景图。

为什么需要它：鸿蒙 adaptive icon 是分层渲染（background + foreground），
launcher 会把 foreground 再放大并裁进蒙版，所以直接拿原版成品图当 foreground
会显著偏小（36.1% 画布 → 屏幕上只有一半）。这个脚本把鸽子从 fixture 重新
等比缩放、居中贴到画布上，**不在上一版产物上二次插值**。

参数口径：`--percent` = 鸽子 alpha 包围盒宽度 / 画布边长（历史定档的度量口径，
不是高度；鸽子是竖长形，高度占比天然比宽度大 3 个点左右）。

用法：
    python tools/make-icon.py --percent 62          # 覆盖 AppScope + entry 两处
    python tools/make-icon.py --percent 62 --dry     # 只写到 --out 指定目录

判据：脚本打印实测 bbox 占比，应与 --percent 相差 < 0.5。
"""
import argparse
import os
import sys

from PIL import Image

CANVAS = 432  # AppScope / entry 的 foreground.png 均为 432x432
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FIXTURE = os.path.join(HERE, 'fixtures', 'icon', 'pigeon.png')
TARGETS = [
    os.path.join(REPO, 'AppScope', 'resources', 'base', 'media', 'foreground.png'),
    os.path.join(REPO, 'entry', 'src', 'main', 'resources', 'base', 'media', 'foreground.png'),
]


def render(percent):
    pigeon = Image.open(FIXTURE).convert('RGBA')
    pw, ph = pigeon.size
    target_w = percent / 100.0 * CANVAS
    scale = target_w / pw
    new_size = (max(1, round(pw * scale)), max(1, round(ph * scale)))
    scaled = pigeon.resize(new_size, Image.LANCZOS)

    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - new_size[0]) // 2
    y = (CANVAS - new_size[1]) // 2
    canvas.paste(scaled, (x, y), scaled)
    return canvas


def measure(img):
    bb = img.getchannel('A').getbbox()
    if not bb:
        return 0.0, 0.0
    return (bb[2] - bb[0]) / img.width * 100, (bb[3] - bb[1]) / img.height * 100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--percent', type=float, required=True, help='鸽子宽度占画布百分比')
    ap.add_argument('--dry', action='store_true', help='不写仓库资源，只写 --out')
    ap.add_argument('--out', default=None, help='额外输出路径（单文件）')
    args = ap.parse_args()

    img = render(args.percent)
    w, h = measure(img)

    outs = [] if args.dry else TARGETS
    if args.out:
        outs = outs + [args.out]
    for p in outs:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        img.save(p, optimize=True)
        print('wrote %s' % os.path.relpath(p, REPO))

    print('percent=%.1f -> bbox w=%.1f%% h=%.1f%% (canvas %d)' % (args.percent, w, h, CANVAS))
    if abs(w - args.percent) > 0.5:
        print('ERROR: 实测宽度占比与目标相差过大', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
