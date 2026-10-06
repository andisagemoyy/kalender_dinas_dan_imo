'use strict';

// ZIP with stored entries. JPEG files are already compressed; no dependency,
// CDN, or network request is needed. UTF-8 names and CRC32 are supported.
class PhotoZip {
  constructor() { this.entries = []; this.offset = 0; }
  static crc32(bytes) {
    if (!this.table) {
      this.table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        this.table[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (const byte of bytes) crc = this.table[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  async add(name, blob, date = new Date()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const filename = new TextEncoder().encode(name);
    if (filename.length > 65535 || bytes.length >= 0xffffffff || this.offset + bytes.length >= 0xffffffff) throw new Error('ZIP terlalu besar.');
    const crc = PhotoZip.crc32(bytes);
    const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
    const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
    const local = new Uint8Array(30 + filename.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(10, dosTime, true); view.setUint16(12, dosDate, true); view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, filename.length, true);
    local.set(filename, 30);
    this.entries.push({ local, bytes, filename, crc, dosDate, dosTime, offset: this.offset });
    this.offset += local.length + bytes.length;
  }
  blob() {
    if (this.entries.length > 65535) throw new Error('Terlalu banyak file.');
    const parts = this.entries.flatMap(entry => [entry.local, entry.bytes]);
    let centralSize = 0;
    this.entries.forEach(entry => {
      const central = new Uint8Array(46 + entry.filename.length), view = new DataView(central.buffer);
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint16(8, 0x0800, true);
      view.setUint16(12, entry.dosTime, true); view.setUint16(14, entry.dosDate, true); view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.bytes.length, true); view.setUint32(24, entry.bytes.length, true); view.setUint16(28, entry.filename.length, true);
      view.setUint32(42, entry.offset, true); central.set(entry.filename, 46);
      parts.push(central); centralSize += central.length;
    });
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, this.entries.length, true); view.setUint16(10, this.entries.length, true);
    view.setUint32(12, centralSize, true); view.setUint32(16, this.offset, true); parts.push(end);
    return new Blob(parts, { type: 'application/zip' });
  }
}
