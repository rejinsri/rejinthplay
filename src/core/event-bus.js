/** Minimal synchronous publish/subscribe bus used to decouple the UI from the engines. */
export class EventBus {
  #handlers = new Map();

  on(type, handler) {
    if (typeof handler !== 'function') throw new TypeError('Event handler must be a function');
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(type, handler) {
    const set = this.#handlers.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.#handlers.delete(type);
  }

  emit(type, payload) {
    const set = this.#handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[event-bus] handler for "${type}" failed`, err);
      }
    }
  }

  clear() {
    this.#handlers.clear();
  }
}
