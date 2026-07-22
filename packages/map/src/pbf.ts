/**
 * A tiny protobuf wire-format reader — just the slice a Mapbox Vector Tile
 * needs. Zero dependencies; the API mirrors the well-known `pbf` library so an
 * MVT decoder reads naturally, but the implementation is our own.
 *
 * Wire types (the low 3 bits of a field tag):
 *   0 varint · 1 64-bit · 2 length-delimited · 5 32-bit
 */

const textDecoder = /* @__PURE__ */ new TextDecoder("utf-8");

export type ReadField<T> = (tag: number, result: T, pbf: Pbf) => void;

export class Pbf {
  pos = 0;
  private end: number;
  private view: DataView;

  constructor(readonly buf: Uint8Array) {
    this.end = buf.length;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Iterate every field in the current message, dispatching to `readField`. */
  readFields<T>(readField: ReadField<T>, result: T, end = this.end): T {
    const savedEnd = this.end;
    this.end = end;
    while (this.pos < end) {
      const val = this.readVarint();
      const tag = val >> 3;
      const start = this.pos;
      readField(tag, result, this);
      if (this.pos === start) this.skip(val & 0x7); // field ignored → skip its value
    }
    this.end = savedEnd;
    return result;
  }

  /** Read a length-delimited sub-message and iterate its fields. */
  readMessage<T>(readField: ReadField<T>, result: T): T {
    return this.readFields(readField, result, this.readVarint() + this.pos);
  }

  /** Unsigned base-128 varint. Uses float math past 28 bits to stay exact to 2^53. */
  readVarint(): number {
    const buf = this.buf;
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = buf[this.pos++]!;
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return result;
  }

  /** Zig-zag encoded signed varint (`sint32`/`sint64`). */
  readSVarint(): number {
    const n = this.readVarint();
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  }

  readString(): string {
    const len = this.readVarint();
    const str = textDecoder.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return str;
  }

  readFloat(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readDouble(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  readBoolean(): boolean {
    return this.readVarint() !== 0;
  }

  /** Raw bytes of a length-delimited field, as a subarray view (no copy). */
  readBytes(): Uint8Array {
    const len = this.readVarint();
    const bytes = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return bytes;
  }

  /** Append a packed repeated varint field into `out`. */
  readPackedVarint(out: number[] = []): number[] {
    const end = this.readVarint() + this.pos;
    while (this.pos < end) out.push(this.readVarint());
    return out;
  }

  /** Skip a field of the given wire type without decoding it. */
  skip(wireType: number): void {
    switch (wireType) {
      case 0:
        this.readVarint();
        break;
      case 1:
        this.pos += 8;
        break;
      case 2:
        this.pos += this.readVarint();
        break;
      case 5:
        this.pos += 4;
        break;
      default:
        throw new Error(`Unknown protobuf wire type ${wireType}`);
    }
  }
}
