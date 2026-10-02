// Bridge adapter contract (UI <-> ChatGPT/Claude development bridge).
//
// An adapter turns a validated command envelope into a stream of events:
//   {type:"status",  taskId, status, label?, owner?, approval?, at?}
//   {type:"progress",taskId, text}
//   {type:"agent",   taskId, agent:{id,label,owner,active}}
//   {type:"result",  taskId, summary, simulated}
//   {type:"failure", taskId, summary, simulated}
//
// Adapters never hold credentials. They are untrusted-by-default boundaries.

export class BridgeNotConnectedError extends Error {
  constructor(message = "No live bridge is connected.") {
    super(message);
    this.name = "BridgeNotConnectedError";
    this.code = "BRIDGE_NOT_CONNECTED";
  }
}

/** Documented interface; concrete adapters extend this. */
export class BridgeAdapter {
  /** @returns {{kind:string, live:boolean, connected:boolean, description:string}} */
  describe() {
    throw new Error("not implemented");
  }

  /** @param {object} _envelope validated command envelope @returns {Promise<{accepted:boolean, reason?:string}>} */
  async submit(_envelope) {
    throw new Error("not implemented");
  }

  /** @returns {Promise<void>} */
  async cancel(_taskId) {
    throw new Error("not implemented");
  }

  /** @param {(event:object)=>void} _listener @returns {() => void} unsubscribe */
  subscribe(_listener) {
    throw new Error("not implemented");
  }
}

export const REQUIRED_ADAPTER_METHODS = ["describe", "submit", "cancel", "subscribe"];

export function assertAdapter(adapter) {
  for (const m of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter?.[m] !== "function") throw new TypeError(`adapter missing method ${m}`);
  }
  return adapter;
}
