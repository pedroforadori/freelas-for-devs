import { describe, expect, it } from 'vitest';
import { sanitizeFileName, sniffContentType } from './content-type.js';

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)]);
const ascii = (text: string) => new Uint8Array([...Buffer.from(text), ...new Array(16).fill(0)]);

describe('sniffContentType', () => {
  it('recognizes the allowed formats by their signatures', () => {
    expect(sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    );
    expect(sniffContentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffContentType(ascii('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
    expect(sniffContentType(ascii('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffContentType(bytes(0x50, 0x4b, 0x03, 0x04))).toBe('application/zip');
  });

  it('rejects anything else, whatever the declared type', () => {
    expect(sniffContentType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffContentType(ascii('<!doctype html><script>'))).toBeNull();
    expect(sniffContentType(bytes(0x4d, 0x5a))).toBeNull(); // executável Windows (MZ)
    expect(sniffContentType(ascii('RIFF\x00\x00\x00\x00WAVE'))).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it('drops paths, control characters and header-breaking quotes', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\fotos\\logo final.png')).toBe('logo final.png');
    expect(sanitizeFileName('a"b\r\nc.pdf')).toBe('abc.pdf');
    expect(sanitizeFileName('...')).toBe('arquivo');
  });
});
