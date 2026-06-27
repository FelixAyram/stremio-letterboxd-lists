class LruCache {
  constructor(maxSize = 300) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  has(key) {
    return this.map.has(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

module.exports = { LruCache };
