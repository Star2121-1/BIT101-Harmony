/**
 * 开屏（启动窗）配置栅栏
 *
 * 起因：2026-10-27 用户反馈「开屏应该全屏橙色 + 中间一个鸽子」，实际是
 * **半透明白底铺满全屏 + 中间一个橙色方块**。两个原因叠在一起：
 *   1. `start_window_background` 是 `#FFFFFF`（暗色档还是 `#000000`），不是品牌橙；
 *   2. `startIcon.png` 是一张**不透明**的「橙底 + 鸟」合成图（color type 2，无 alpha），
 *      系统把它当方块贴上去，橙底就成了一个明显的方框。
 *
 * 这类错误编译不报、运行不崩、单测不红，只能靠人眼看 —— 所以固化成判据：
 *   A. 启动窗底色必须等于**应用图标底色**（从 AppScope/background.png 中心像素取，
 *      不硬编码品牌色；改图标配色时这条自动跟着走）；
 *   B. `startIcon.png` 必须是**带 alpha 的 PNG**（color type 4/6）且四角全透明
 *      —— 不透明就等于把方块贴上去；
 *   C. 中间必须有内容（中心区域存在非透明像素），否则是个空图；
 *   D. 边长 ≥ 64（与 CI 图标守卫同口径，防占位图）。
 *
 * 跑法：node --experimental-transform-types tools/test-splash.mjs
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('PASS ' + msg); }
  else { failed++; console.log('FAIL ' + msg); }
}

/**
 * 极简 PNG 解码：只支持 8bit / 非隔行 / color type 2(RGB) 与 6(RGBA)。
 * 仓库里的图标就是这两种；遇到别的直接报错，不静默返回错误像素。
 */
function decodePng(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(path + ' 不是 PNG');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`${path} 不支持的 PNG 格式（bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}）`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);

  // 逐行反滤波（PNG spec 9.2）
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  const pixel = (x, y) => {
    const base = y * stride + x * bpp;
    return { r: out[base], g: out[base + 1], b: out[base + 2], a: bpp === 4 ? out[base + 3] : 255 };
  };
  return { width, height, colorType, hasAlpha: colorType === 6, pixel };
}

const hex = (p) => '#' + [p.r, p.g, p.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

// ── A. 启动窗底色 == 图标底色 ───────────────────────────────────────────
const iconBgPath = join(ROOT, 'AppScope/resources/base/media/background.png');
const iconBg = decodePng(iconBgPath);
const brand = hex(iconBg.pixel(iconBg.width >> 1, iconBg.height >> 1));
console.log(`图标底色（background.png 中心）= ${brand}`);

for (const p of ['entry/src/main/resources/base/element/color.json',
                 'entry/src/main/resources/dark/element/color.json']) {
  const cfg = JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
  const item = (cfg.color || []).find((c) => c.name === 'start_window_background');
  ok(item !== undefined, `${p} 有 start_window_background`);
  if (item !== undefined) {
    ok(item.value.toUpperCase() === brand,
      `${p} 的启动窗底色 = ${item.value} 与图标底色 ${brand} 一致`);
  }
}

// ── B/C/D. startIcon 必须是透明底的一只真鸽子 ────────────────────────────
const startIconPath = join(ROOT, 'entry/src/main/resources/base/media/startIcon.png');
const icon = decodePng(startIconPath);
ok(icon.width >= 64 && icon.height >= 64, `startIcon 边长 ${icon.width}x${icon.height} ≥ 64`);
ok(icon.hasAlpha, `startIcon 是带 alpha 的 PNG（colorType=${icon.colorType}）—— 不透明就会在橙底上留一个方块`);

if (icon.hasAlpha) {
  const corners = [
    icon.pixel(1, 1),
    icon.pixel(icon.width - 2, 1),
    icon.pixel(1, icon.height - 2),
    icon.pixel(icon.width - 2, icon.height - 2),
  ];
  const maxCornerAlpha = Math.max(...corners.map((c) => c.a));
  ok(maxCornerAlpha === 0, `startIcon 四角全透明（最大 alpha=${maxCornerAlpha}）`);

  // 中心 1/3 区域必须真有内容，防止「全透明空图」蒙过上面几条
  let opaque = 0;
  const x0 = Math.floor(icon.width / 3);
  const x1 = Math.floor(icon.width * 2 / 3);
  const y0 = Math.floor(icon.height / 3);
  const y1 = Math.floor(icon.height * 2 / 3);
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      if (icon.pixel(x, y).a > 200) opaque++;
    }
  }
  ok(opaque > 50, `startIcon 中心区域有实体内容（采样到 ${opaque} 个不透明点）`);
}

// ── module.json5 必须真的引用这两个资源名 ───────────────────────────────
const moduleJson = readFileSync(join(ROOT, 'entry/src/main/module.json5'), 'utf8');
ok(/"startWindowIcon"\s*:\s*"\$media:startIcon"/.test(moduleJson), 'module.json5 的 startWindowIcon 指向 $media:startIcon');
ok(/"startWindowBackground"\s*:\s*"\$color:start_window_background"/.test(moduleJson),
  'module.json5 的 startWindowBackground 指向 $color:start_window_background');

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passed + ' fail=' + failed);
process.exit(failed === 0 ? 0 : 1);
