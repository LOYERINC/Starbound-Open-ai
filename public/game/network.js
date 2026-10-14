/** A small request/reply WebSocket client. Game events stay on gameEvents. */
export class RoomClient extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.pending = new Map();
    this.serial = 0;
    this.closedByUser = false;
    this.lastJoin = null;
    this.reconnectDelay = 700;
  }

  async connect(code, hello) {
    this.code = String(code).toUpperCase();
    this.lastJoin = { ...hello };
    this.closedByUser = false;
    return this.openSocket(true);
  }

  openSocket(initial = false) {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws/rooms/${encodeURIComponent(this.code)}`);
      this.socket = socket;
      let initialDone = false;
      const finishInitial = (value, error) => {
        if (initialDone) return;
        initialDone = true;
        error ? reject(error) : resolve(value);
      };
      socket.addEventListener("open", () => socket.send(JSON.stringify(this.lastJoin)), { once: true });
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (["connected", "joined"].includes(message.type)) {
          if (message.type === "joined" && message.resumeToken) this.lastJoin.resumeToken = message.resumeToken;
          this.dispatchEvent(new CustomEvent("connected", { detail: message }));
          finishInitial(message);
        } else if (message.type === "error" && !initialDone) {
          finishInitial(null, new Error(message.message || "Could not join the room."));
        }
        const pending = message.requestId && this.pending.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer); this.pending.delete(message.requestId);
          if (message.type === "error" || message.ok === false) pending.reject(new Error(message.message));
          else pending.resolve(message);
        }
        this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
      });
      socket.addEventListener("close", () => {
        if (!initialDone) finishInitial(null, new Error("Connection closed."));
        if (!this.closedByUser && this.lastJoin) {
          this.dispatchEvent(new Event("reconnecting"));
          window.setTimeout(() => this.openSocket(false).catch(() => {}), this.reconnectDelay);
          this.reconnectDelay = Math.min(8000, this.reconnectDelay * 1.7);
        }
      });
      socket.addEventListener("error", () => {
        if (!initialDone && initial) finishInitial(null, new Error("Could not connect to this room. Check the code and network."));
      });
    });
  }

  request(type, data = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Room connection is offline."));
    const requestId = `r${++this.serial}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(requestId); reject(new Error("Room server did not respond.")); }, 10000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ ...data, type, requestId }));
    });
  }

  send(type, data = {}) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ ...data, type }));
  }

  bindGameEvents(events) {
    if (this.gameEventBindings) return;
    const bindings = {
      gateReached: (event) => this.send("gate_reached", { gateId: String(event.detail?.gateId || "") }),
      damageTaken: (event) => this.send("damage_taken", { reason: String(event.detail?.reason || "unknown") }),
      checkpointReached: (event) => this.send("checkpoint", { x: event.detail?.x }),
      died: () => this.request("died").catch((error) => this.dispatchEvent(new CustomEvent("networkerror", { detail: error }))),
      progress: (event) => {
        const now = performance.now();
        if (!event.detail?.force && now - (this.lastProgressAt || 0) < 500) return;
        this.lastProgressAt = now; this.send("progress", { x: event.detail?.x });
      },
      finished: (event) => this.request("finished", { x: event.detail?.x }).catch((error) => this.dispatchEvent(new CustomEvent("networkerror", { detail: error }))),
    };
    Object.entries(bindings).forEach(([name, handler]) => events.addEventListener(name, handler));
    this.gameEventBindings = { events, bindings };
  }

  close() {
    this.closedByUser = true;
    this.lastJoin = null;
    this.socket?.close();
    this.pending.forEach((request) => { clearTimeout(request.timer); request.reject(new Error("Room closed.")); });
    this.pending.clear();
    if (this.gameEventBindings) {
      Object.entries(this.gameEventBindings.bindings).forEach(([name, handler]) => this.gameEventBindings.events.removeEventListener(name, handler));
      this.gameEventBindings = null;
    }
  }
}
