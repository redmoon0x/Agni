const DEFAULT_BYTE_CAP = 256 * 1024;
const MERGE_TARGET_BYTES = 16 * 1024;

const OVERFLOW_NOTICE = new TextEncoder().encode(
  "\r\n\x1b[2m[agni: older output dropped during hibernation]\x1b[0m\r\n",
);

export class DormantRing {
  private chunks: (Uint8Array | null)[] = [];
  private head = 0;
  private size = 0;
  private total = 0;
  private overflowed = false;

  constructor(private readonly byteCap = DEFAULT_BYTE_CAP) {}

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    if (bytes.length >= this.byteCap) {
      this.chunks = [bytes.subarray(bytes.length - this.byteCap)];
      this.head = 0;
      this.size = 1;
      this.total = this.byteCap;
      this.overflowed = true;
      return;
    }

    const tailIndex = this.head + this.size - 1;
    const tail = tailIndex >= this.head ? this.chunks[tailIndex] : null;
    if (tail && tail.length + bytes.length <= MERGE_TARGET_BYTES) {
      const merged = new Uint8Array(tail.length + bytes.length);
      merged.set(tail);
      merged.set(bytes, tail.length);
      this.chunks[tailIndex] = merged;
    } else {
      this.chunks.push(bytes);
      this.size++;
    }
    this.total += bytes.length;

    while (this.total > this.byteCap && this.size > 0) {
      const first = this.chunks[this.head];
      if (!first) {
        this.head++;
        this.size--;
        continue;
      }
      const excess = this.total - this.byteCap;
      if (first.length > excess) {
        this.chunks[this.head] = first.subarray(excess);
        this.total -= excess;
        this.overflowed = true;
        break;
      }
      this.chunks[this.head] = null;
      this.head++;
      this.size--;
      this.total -= first.length;
      this.overflowed = true;
    }
    if (this.head > 1024 && this.head > this.chunks.length / 2) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  drain(write: (bytes: Uint8Array) => void): void {
    if (this.overflowed) write(OVERFLOW_NOTICE);
    const end = this.head + this.size;
    for (let i = this.head; i < end; i++) {
      const c = this.chunks[i];
      if (c) write(c);
    }
    this.chunks = [];
    this.head = 0;
    this.size = 0;
    this.total = 0;
    this.overflowed = false;
  }

  byteLength(): number {
    return this.total;
  }
}
