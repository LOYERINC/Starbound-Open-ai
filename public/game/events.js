// The one gameplay event channel used by solo play and the room network bridge.
class GameEvents extends EventTarget {
  emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

export const gameEvents = new GameEvents();
