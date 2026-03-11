export type CipherAlgorithm = 'caesar' | 'rot13' | 'atbash' | 'vigenere' | 'affine' | 'base64';

export type CipherDirection = 'encode' | 'decode';

export interface Base64Options {
  alphabet64: string;
  paddingEnabled: boolean;
  paddingChar: string;
}

export interface CipherRequest {
  algorithm: CipherAlgorithm;
  direction: CipherDirection;
  input: string;
  caesarShift?: number;
  vigenereKey?: string;
  affineA?: number;
  affineB?: number;
  base64Options?: Base64Options;
}

export interface CipherExecutionResult {
  output: string;
  error: string | null;
}

export const BASE64_STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const BASE64_URLSAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const AFFINE_VALID_A_VALUES = [1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23, 25] as const;

const ALPHABET_MODULO = 26;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

interface ParsedBase64Options {
  alphabetChars: string[];
  alphabetMap: Map<string, number>;
  paddingEnabled: boolean;
  paddingChar: string;
}

export function executeCipher(request: CipherRequest): CipherExecutionResult {
  try {
    const output = runCipher(request);
    return { output, error: null };
  } catch (error) {
    if (error instanceof Error) {
      return { output: '', error: error.message };
    }
    return { output: '', error: '执行失败。' };
  }
}

function runCipher(request: CipherRequest): string {
  switch (request.algorithm) {
    case 'caesar':
      return runCaesar(request);
    case 'rot13':
      return shiftByCaesar(request.input, 13);
    case 'atbash':
      return runAtbash(request.input);
    case 'vigenere':
      return runVigenere(request);
    case 'affine':
      return runAffine(request);
    case 'base64':
      return runBase64(request);
    default:
      throw new Error('不支持的算法。');
  }
}

function runCaesar(request: CipherRequest): string {
  const shift = request.caesarShift ?? 0;
  if (!Number.isInteger(shift) || shift < 0 || shift > 25) {
    throw new Error('凯撒位移需为 0-25 的整数。');
  }

  const effectiveShift = request.direction === 'decode' ? -shift : shift;
  return shiftByCaesar(request.input, effectiveShift);
}

function runAtbash(input: string): string {
  return Array.from(input)
    .map((char) => {
      const code = char.codePointAt(0);
      if (code === undefined) {
        return char;
      }

      if (isUppercaseAscii(code)) {
        return String.fromCodePoint(90 - (code - 65));
      }

      if (isLowercaseAscii(code)) {
        return String.fromCodePoint(122 - (code - 97));
      }

      return char;
    })
    .join('');
}

function runVigenere(request: CipherRequest): string {
  const rawKey = request.vigenereKey ?? '';
  if (!rawKey) {
    throw new Error('维吉尼亚密钥不能为空。');
  }
  if (!/^[A-Za-z]+$/.test(rawKey)) {
    throw new Error('维吉尼亚密钥仅支持字母。');
  }

  const keyShifts = Array.from(rawKey.toUpperCase()).map((char) => char.charCodeAt(0) - 65);
  let keyIndex = 0;

  return Array.from(request.input)
    .map((char) => {
      const code = char.codePointAt(0);
      if (code === undefined) {
        return char;
      }

      const baseCode = getAsciiBaseCode(code);
      if (baseCode === null) {
        return char;
      }

      const offset = code - baseCode;
      const shift = keyShifts[keyIndex % keyShifts.length];
      keyIndex += 1;

      const appliedShift = request.direction === 'decode' ? -shift : shift;
      const nextOffset = positiveMod(offset + appliedShift, ALPHABET_MODULO);
      return String.fromCodePoint(baseCode + nextOffset);
    })
    .join('');
}

function runAffine(request: CipherRequest): string {
  const a = request.affineA ?? 5;
  const b = request.affineB ?? 8;

  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    throw new Error('仿射参数 a 和 b 必须为整数。');
  }
  if (!isValidAffineA(a)) {
    throw new Error('仿射参数 a 必须与 26 互素。');
  }
  if (b < 0 || b > 25) {
    throw new Error('仿射参数 b 需在 0-25 之间。');
  }

  const inverseA = modInverse(a, ALPHABET_MODULO);
  if (inverseA === null) {
    throw new Error('仿射参数 a 必须与 26 互素。');
  }

  return Array.from(request.input)
    .map((char) => {
      const code = char.codePointAt(0);
      if (code === undefined) {
        return char;
      }

      const baseCode = getAsciiBaseCode(code);
      if (baseCode === null) {
        return char;
      }

      const x = code - baseCode;
      const y =
        request.direction === 'encode'
          ? positiveMod(a * x + b, ALPHABET_MODULO)
          : positiveMod(inverseA * (x - b), ALPHABET_MODULO);

      return String.fromCodePoint(baseCode + y);
    })
    .join('');
}

function runBase64(request: CipherRequest): string {
  const options = parseBase64Options(
    request.base64Options ?? {
      alphabet64: BASE64_STANDARD_ALPHABET,
      paddingEnabled: true,
      paddingChar: '=',
    },
  );

  if (request.direction === 'encode') {
    return encodeBase64WithAlphabet(request.input, options);
  }

  return decodeBase64WithAlphabet(request.input, options);
}

function shiftByCaesar(input: string, shift: number): string {
  return Array.from(input)
    .map((char) => {
      const code = char.codePointAt(0);
      if (code === undefined) {
        return char;
      }

      const baseCode = getAsciiBaseCode(code);
      if (baseCode === null) {
        return char;
      }

      const offset = code - baseCode;
      const nextOffset = positiveMod(offset + shift, ALPHABET_MODULO);
      return String.fromCodePoint(baseCode + nextOffset);
    })
    .join('');
}

function parseBase64Options(options: Base64Options): ParsedBase64Options {
  const alphabetChars = Array.from(options.alphabet64);
  if (alphabetChars.length !== 64) {
    throw new Error('Base64 字符表必须为 64 个字符。');
  }

  const alphabetSet = new Set(alphabetChars);
  if (alphabetSet.size !== 64) {
    throw new Error('Base64 字符表必须为 64 个唯一字符。');
  }

  const paddingChars = Array.from(options.paddingChar);
  if (options.paddingEnabled) {
    if (paddingChars.length !== 1) {
      throw new Error('Base64 填充字符必须是 1 个字符。');
    }
    if (alphabetSet.has(paddingChars[0])) {
      throw new Error('Base64 填充字符不能出现在字符表中。');
    }
  } else if (paddingChars.length > 1) {
    throw new Error('Base64 填充字符最多 1 个字符。');
  }

  const alphabetMap = new Map<string, number>();
  for (let index = 0; index < alphabetChars.length; index += 1) {
    alphabetMap.set(alphabetChars[index], index);
  }

  return {
    alphabetChars,
    alphabetMap,
    paddingEnabled: options.paddingEnabled,
    paddingChar: paddingChars[0] ?? '=',
  };
}

function encodeBase64WithAlphabet(input: string, options: ParsedBase64Options): string {
  const bytes = UTF8_ENCODER.encode(input);
  const out: string[] = [];

  for (let index = 0; index < bytes.length; index += 3) {
    const b1 = bytes[index] ?? 0;
    const b2 = bytes[index + 1] ?? 0;
    const b3 = bytes[index + 2] ?? 0;

    const triple = (b1 << 16) | (b2 << 8) | b3;
    const c1 = options.alphabetChars[(triple >> 18) & 0b11_1111];
    const c2 = options.alphabetChars[(triple >> 12) & 0b11_1111];
    const c3 = options.alphabetChars[(triple >> 6) & 0b11_1111];
    const c4 = options.alphabetChars[triple & 0b11_1111];

    const remaining = bytes.length - index;
    if (remaining >= 3) {
      out.push(c1, c2, c3, c4);
    } else if (remaining === 2) {
      out.push(c1, c2, c3);
      if (options.paddingEnabled) {
        out.push(options.paddingChar);
      }
    } else {
      out.push(c1, c2);
      if (options.paddingEnabled) {
        out.push(options.paddingChar, options.paddingChar);
      }
    }
  }

  return out.join('');
}

function decodeBase64WithAlphabet(input: string, options: ParsedBase64Options): string {
  const symbols = Array.from(input).filter((char) => !isBase64Whitespace(char));

  if (symbols.length === 0) {
    return '';
  }

  const bytes = options.paddingEnabled
    ? decodeSymbolsWithPadding(symbols, options)
    : decodeSymbolsWithoutPadding(symbols, options);

  try {
    return UTF8_DECODER.decode(new Uint8Array(bytes));
  } catch {
    throw new Error('Base64 解码结果不是有效 UTF-8 文本。');
  }
}

function decodeSymbolsWithPadding(symbols: string[], options: ParsedBase64Options): number[] {
  if (symbols.length % 4 !== 0) {
    throw new Error('Base64 输入长度不合法（启用填充时长度需为 4 的倍数）。');
  }

  const output: number[] = [];
  const totalGroups = symbols.length / 4;

  for (let group = 0; group < totalGroups; group += 1) {
    const offset = group * 4;
    const c1 = symbols[offset];
    const c2 = symbols[offset + 1];
    const c3 = symbols[offset + 2];
    const c4 = symbols[offset + 3];

    const i1 = options.alphabetMap.get(c1);
    const i2 = options.alphabetMap.get(c2);

    if (i1 === undefined || i2 === undefined) {
      throw new Error(`Base64 存在非法字符：${i1 === undefined ? c1 : c2}`);
    }

    const isPad3 = c3 === options.paddingChar;
    const isPad4 = c4 === options.paddingChar;

    if (c1 === options.paddingChar || c2 === options.paddingChar) {
      throw new Error('Base64 填充字符位置无效。');
    }

    if (isPad3 && !isPad4) {
      throw new Error('Base64 填充字符位置无效。');
    }

    if ((isPad3 || isPad4) && group !== totalGroups - 1) {
      throw new Error('Base64 填充字符只能出现在末尾。');
    }

    if (isPad3) {
      output.push((i1 << 2) | (i2 >> 4));
      continue;
    }

    const i3 = options.alphabetMap.get(c3);
    if (i3 === undefined) {
      throw new Error(`Base64 存在非法字符：${c3}`);
    }

    if (isPad4) {
      output.push((i1 << 2) | (i2 >> 4), ((i2 & 0b1111) << 4) | (i3 >> 2));
      continue;
    }

    const i4 = options.alphabetMap.get(c4);
    if (i4 === undefined) {
      throw new Error(`Base64 存在非法字符：${c4}`);
    }

    output.push(
      (i1 << 2) | (i2 >> 4),
      ((i2 & 0b1111) << 4) | (i3 >> 2),
      ((i3 & 0b11) << 6) | i4,
    );
  }

  return output;
}

function decodeSymbolsWithoutPadding(symbols: string[], options: ParsedBase64Options): number[] {
  if (symbols.length % 4 === 1) {
    throw new Error('Base64 输入长度不合法（禁用填充时余数不能为 1）。');
  }

  const output: number[] = [];
  const fullGroupCount = Math.floor(symbols.length / 4);
  const remainder = symbols.length % 4;

  for (let group = 0; group < fullGroupCount; group += 1) {
    const offset = group * 4;
    const c1 = symbols[offset];
    const c2 = symbols[offset + 1];
    const c3 = symbols[offset + 2];
    const c4 = symbols[offset + 3];

    const i1 = options.alphabetMap.get(c1);
    const i2 = options.alphabetMap.get(c2);
    const i3 = options.alphabetMap.get(c3);
    const i4 = options.alphabetMap.get(c4);

    if (i1 === undefined || i2 === undefined || i3 === undefined || i4 === undefined) {
      const invalidChar = [c1, c2, c3, c4].find((char) => !options.alphabetMap.has(char)) ?? '?';
      throw new Error(`Base64 存在非法字符：${invalidChar}`);
    }

    output.push(
      (i1 << 2) | (i2 >> 4),
      ((i2 & 0b1111) << 4) | (i3 >> 2),
      ((i3 & 0b11) << 6) | i4,
    );
  }

  if (remainder === 2) {
    const c1 = symbols[fullGroupCount * 4];
    const c2 = symbols[fullGroupCount * 4 + 1];
    const i1 = options.alphabetMap.get(c1);
    const i2 = options.alphabetMap.get(c2);
    if (i1 === undefined || i2 === undefined) {
      throw new Error(`Base64 存在非法字符：${i1 === undefined ? c1 : c2}`);
    }
    output.push((i1 << 2) | (i2 >> 4));
  }

  if (remainder === 3) {
    const c1 = symbols[fullGroupCount * 4];
    const c2 = symbols[fullGroupCount * 4 + 1];
    const c3 = symbols[fullGroupCount * 4 + 2];
    const i1 = options.alphabetMap.get(c1);
    const i2 = options.alphabetMap.get(c2);
    const i3 = options.alphabetMap.get(c3);
    if (i1 === undefined || i2 === undefined || i3 === undefined) {
      const invalidChar = [c1, c2, c3].find((char) => !options.alphabetMap.has(char)) ?? '?';
      throw new Error(`Base64 存在非法字符：${invalidChar}`);
    }
    output.push((i1 << 2) | (i2 >> 4), ((i2 & 0b1111) << 4) | (i3 >> 2));
  }

  return output;
}

function isValidAffineA(a: number): boolean {
  return AFFINE_VALID_A_VALUES.includes(a as (typeof AFFINE_VALID_A_VALUES)[number]);
}

function getAsciiBaseCode(code: number): number | null {
  if (isUppercaseAscii(code)) {
    return 65;
  }
  if (isLowercaseAscii(code)) {
    return 97;
  }
  return null;
}

function isUppercaseAscii(code: number): boolean {
  return code >= 65 && code <= 90;
}

function isLowercaseAscii(code: number): boolean {
  return code >= 97 && code <= 122;
}

function positiveMod(value: number, mod: number): number {
  const remainder = value % mod;
  return remainder >= 0 ? remainder : remainder + mod;
}

function modInverse(value: number, mod: number): number | null {
  const normalized = positiveMod(value, mod);
  for (let candidate = 1; candidate < mod; candidate += 1) {
    if ((normalized * candidate) % mod === 1) {
      return candidate;
    }
  }
  return null;
}

function isBase64Whitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}
