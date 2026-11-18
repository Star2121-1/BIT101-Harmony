/**
 * Mifare Classic 全扇区**只读** dump（#153）。
 *
 * ## 红线（改代码前先读）
 * 1. 只用**一个**出厂默认密钥 FFFFFFFFFFFF、只作 KeyA 认证。
 *    认证失败就记一行「默认密钥通不过」并跳过该扇区——**绝不试第二个密钥**。
 *    换密钥去撞 = 破密钥，本模块永远不做，也没有那种代码路径。
 * 2. 只调 readSingleBlock。没有 writeSingleBlock / increment / decrement /
 *    transfer / restore / format / NDEF 写入——这些一次都不会发出。
 * 3. 不猜门后内容、不碰 CPU 卡 6982 门、不做卡模拟/支付/闸机。
 *
 * Android 基线（BIT101-seat/docs/nfc-card-probe.md §2）已证实：这张校园卡
 * Classic 层 16 扇区默认密钥全通、除 UID 块外全零，是出厂没动过的空壳。
 * 本模块把同一结论搬到鸿蒙真机复验，预期就是「一个制造商块 + 全零」。
 *
 * ## 无 @kit
 * sectorCount / blocksPerSector / authenticate / readBlock 全部注入，
 * 本模块可在 Node 单测里跑，不含任何 @kit.ConnectivityKit import。
 */

/** 出厂默认密钥（唯一允许使用的密钥）。 */
export const DEFAULT_KEY_A: number[] = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

/** 一条 Classic dump 流水。 */
export interface ClassicLine {
  /** 扇区号（0-based）。 */
  sector: number;
  /** 块号（0-based，全局）。 */
  block: number;
  /** 操作：AUTH KeyA / READ BLOCK / SKIP。 */
  op: string;
  /** 状态：ok / auth-fail / read-fail / skipped。 */
  status: string;
  /** 读出的 16 字节（hex，空格分隔）；非读取行为空串。 */
  data: string;
  /** 是否全零（制造商块/值块除外）。 */
  allZero: boolean;
  /** 简短备注。 */
  note: string;
}

/** Classic 只读扫描配置（注入）。 */
export interface ClassicConfig {
  sectorCount: number;
  blocksPerSector: (sector: number) => number;
  /** 用默认 KeyA 认证某扇区；失败抛错或返回 false。 */
  authenticate: (sector: number, key: number[], isKeyA: boolean) => Promise<boolean>;
  /** 读一个块，返回 16 字节。 */
  readBlock: (block: number) => Promise<number[]>;
  /** 每条流水回调（边收边显示；掉卡保留已得）。 */
  onLine?: (line: ClassicLine) => void;
}

/** 默认块数：Mifare Classic 1K = 每扇区 4 块。 */
export function defaultBlocksPerSector(): number {
  return 4;
}

function toHex(bytes: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b: number = bytes[i] & 0xff;
    out.push((b < 16 ? '0' : '') + b.toString(16).toUpperCase());
  }
  return out.join(' ');
}

function isAllZero(bytes: number[]): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if ((bytes[i] & 0xff) !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * 逐扇区、逐块只读 dump。
 * 只用默认密钥 KeyA；任何扇区认证失败都跳过、不换密钥。
 * 掉卡（readBlock/auth 抛错）保留已得流水，继续下一个扇区（贴卡成本低，尽量多拿）。
 */
export async function runClassicScan(config: ClassicConfig): Promise<ClassicLine[]> {
  const out: ClassicLine[] = [];
  const push = (l: ClassicLine): void => {
    out.push(l);
    if (config.onLine !== undefined) {
      config.onLine(l);
    }
  };
  for (let sector = 0; sector < config.sectorCount; sector++) {
    const blocks: number = config.blocksPerSector(sector);
    // ① 默认 KeyA 认证；失败跳过，绝不试第二个密钥
    let authed: boolean = false;
    try {
      authed = await config.authenticate(sector, DEFAULT_KEY_A, true);
    } catch (e) {
      authed = false;
    }
    if (!authed) {
      push({ sector: sector, block: -1, op: 'AUTH KeyA', status: 'auth-fail',
        data: '', allZero: false, note: '默认密钥 FFFFFFFFFFFF 通不过，跳过（不试其他密钥）' });
      continue;
    }
    push({ sector: sector, block: -1, op: 'AUTH KeyA', status: 'ok',
      data: '', allZero: false, note: '出厂默认密钥通过' });
    // ② 逐块只读
    const first: number = sector * blocks;
    for (let b = 0; b < blocks; b++) {
      const block: number = first + b;
      try {
        const data: number[] = await config.readBlock(block);
        push({ sector: sector, block: block, op: 'READ BLOCK', status: 'ok',
          data: toHex(data), allZero: isAllZero(data),
          note: (b === 0 && sector === 0) ? '制造商块（UID/BCC/SAK/ATQA）'
            : (isAllZero(data) ? '全零' : '非零数据') });
      } catch (e) {
        push({ sector: sector, block: block, op: 'READ BLOCK', status: 'read-fail',
          data: '', allZero: false, note: '读块失败（可能掉卡）：' + (e as Error).message });
      }
    }
  }
  return out;
}
