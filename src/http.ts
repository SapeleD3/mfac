export let fetchImpl: typeof fetch = (...a) => fetch(...a);
export function setFetch(f: typeof fetch) {
  fetchImpl = f;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  get auth() {
    return this.status === 401 || this.status === 403;
  }
}

export async function json<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new HttpError(res.status, `${res.status} from ${new URL(url).host}: ${body?.message ?? body?.error ?? text.slice(0, 200)}`);
  return body as T;
}
