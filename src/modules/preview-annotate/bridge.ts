import type { RectPx } from "./resolve";

const RESOLVE_TYPE = "agni:annotate-resolve";
const RESULT_TYPE = "agni:annotate-result";
const PING_TYPE = "agni:annotate-ping";
const PONG_TYPE = "agni:annotate-pong";

/**
 * Injected into the sandboxed HTML-preview iframe (allow-scripts, no
 * allow-same-origin). On a host resolve request it runs elementFromPoint over
 * sample points of the rect, builds a selector, and postMessages the result
 * back. It only ever reads the iframe's own DOM and reports selectors/text —
 * it cannot reach Tauri IPC or the host's DOM.
 */
export const BRIDGE_SCRIPT_SOURCE = `(() => {
  const RESOLVE = "${RESOLVE_TYPE}";
  const RESULT = "${RESULT_TYPE}";
  const PING = "${PING_TYPE}";
  const PONG = "${PONG_TYPE}";

  function escId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
  }
  function escClass(name) {
    return String(name).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
  }
  function selOf(el) {
    if (!el) return "";
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "html" || tag === "body") return "";
    const id = el.id || (el.getAttribute && el.getAttribute("id"));
    if (id) return "#" + escId(id);
    const classes = (el.className || "").toString().split(/\\s+/).filter(Boolean);
    const cls = classes.slice(0, 2).map(escClass);
    if (cls.length) return tag + cls.map((c) => "." + c).join("");
    return tag;
  }
  function report(rect) {
    const pts = [
      [rect.x + rect.width / 2, rect.y + rect.height / 2],
      [rect.x + rect.width * 0.25, rect.y + rect.height * 0.25],
      [rect.x + rect.width * 0.75, rect.y + rect.height * 0.75],
    ];
    let pick = null;
    for (const [px, py] of pts) {
      const el = document.elementFromPoint(px, py);
      if (el && el.tagName && el.tagName.toLowerCase() !== "html") {
        pick = el;
        break;
      }
    }
    if (!pick) pick = document.body || document.documentElement;
    const selector = selOf(pick);
    const text = (pick.textContent || "").trim().slice(0, 120);
    parent.postMessage(
      { type: RESULT, selector, tagName: pick.tagName || "", text },
      "*",
    );
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === PING) {
      parent.postMessage({ type: PONG }, "*");
      return;
    }
    if (data.type === RESOLVE && data.rect) {
      report(data.rect);
    }
  });
})();`;

export type BridgeResult = {
  selector: string;
  tagName: string;
  text: string;
};

const RESOLVE_TIMEOUT_MS = 800;

/**
 * Ask an iframe's injected bridge to resolve a pixel rect to a selector.
 * Resolves the BridgeResult on success, or null on timeout / script-blocked
 * (strict CSP) / wrong-source message.
 */
export function requestResolve(
  iframe: HTMLIFrameElement | null,
  rect: RectPx,
): Promise<BridgeResult | null> {
  const window_ = iframe?.contentWindow;
  if (!iframe || !window_) return Promise.resolve(null);

  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window_) return;
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        data.type === RESULT_TYPE &&
        typeof data.selector === "string"
      ) {
        cleanup();
        resolve({
          selector: data.selector,
          tagName: typeof data.tagName === "string" ? data.tagName : "",
          text: typeof data.text === "string" ? data.text : "",
        });
      }
    };
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, RESOLVE_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
    window_?.postMessage({ type: RESOLVE_TYPE, rect }, "*");
  });
}

/** True when the iframe's injected bridge is present and reachable. */
export function isBridgeAlive(
  iframe: HTMLIFrameElement | null,
): Promise<boolean> {
  const window_ = iframe?.contentWindow;
  if (!iframe || !window_) return Promise.resolve(false);

  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window_) return;
      const data = event.data;
      if (data && typeof data === "object" && data.type === PONG_TYPE) {
        cleanup();
        resolve(true);
      }
    };
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, RESOLVE_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
    window_?.postMessage({ type: PING_TYPE }, "*");
  });
}
