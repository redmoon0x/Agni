import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export type HttpHeader = { name: string; value: string };

export type HttpStreamEvent =
  | {
      kind: "head";
      status: number;
      status_text: string;
      headers: [string, string][];
    }
  | { kind: "body"; chunk: string }
  | { kind: "done"; latency_ms: number }
  | { kind: "error"; message: string };

export type HttpRequestInput = {
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  body: string;
};

export type HttpResponseState = {
  /** null before the response head arrives; "pending" while waiting. */
  status: number | "pending" | null;
  statusText: string;
  latencyMs: number | null;
  headers: [string, string][];
  body: string;
  error: string | null;
  running: boolean;
};

const IDLE: HttpResponseState = {
  status: null,
  statusText: "",
  latencyMs: null,
  headers: [],
  body: "",
  error: null,
  running: false,
};

export function useHttpRequest() {
  const [response, setResponse] = useState<HttpResponseState>(IDLE);

  const send = useCallback(async (input: HttpRequestInput) => {
    const channel = new Channel<HttpStreamEvent>();
    setResponse({ ...IDLE, status: "pending", running: true });

    channel.onmessage = (event) => {
      switch (event.kind) {
        case "head":
          setResponse((prev) => ({
            ...prev,
            status: event.status,
            statusText: event.status_text,
            headers: event.headers,
          }));
          break;
        case "body":
          setResponse((prev) => ({ ...prev, body: prev.body + event.chunk }));
          break;
        case "done":
          setResponse((prev) => ({
            ...prev,
            latencyMs: event.latency_ms,
            running: false,
          }));
          break;
        case "error":
          setResponse((prev) => ({
            ...prev,
            error: event.message,
            running: false,
          }));
          break;
      }
    };

    try {
      await invoke("http_request", {
        method: input.method,
        url: input.url,
        headers: input.headers
          .filter((h) => h.name.trim() && h.value.trim())
          .map((h) => [h.name.trim(), h.value.trim()] as [string, string]),
        body: input.body || null,
        onEvent: channel,
      });
    } catch (e) {
      setResponse((prev) => ({
        ...prev,
        error: String(e),
        running: false,
      }));
    }
  }, []);

  const reset = useCallback(() => setResponse(IDLE), []);

  return { response, send, reset };
}
