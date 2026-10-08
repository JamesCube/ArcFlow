import type { Api, InboxBox, InboxFilters } from "./types";
import { parseRequestJson, parseRequestsJson, parseInboxJson } from "./business";
export { InvalidPayloadError } from "./business";
export class ApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}
export function inboxPath(box: InboxBox, filters: InboxFilters = {}, cursor?: string) {
  const query = new URLSearchParams({ box, limit: "25" });
  if (filters.status) query.set("status", filters.status);
  if (filters.processVersion !== undefined)
    query.set("processVersion", String(filters.processVersion));
  if (cursor !== undefined) query.set("cursor", cursor);
  return `/requests/inbox?${query}`;
}
function allowedEndpoint(path: string) {
  if (/^\/(me|people|requests(?:\/[A-Za-z0-9_-]+\/decisions)?)$/.test(path))
    return true;
  if (!/^\/requests\/inbox(?:\?[^#]*)?$/.test(path)) return false;
  const query = new URLSearchParams(path.split("?")[1] || "");
  const keys: string[] = [];
  query.forEach((_, key) => keys.push(key));
  if (new Set(keys).size !== keys.length) return false;
  return keys.every((key) => {
    const value = query.get(key)!;
    if (key === "box") return ["PENDING", "HANDLED"].includes(value);
    if (key === "status") return ["PENDING", "APPROVED", "REJECTED"].includes(value);
    if (key === "limit") return /^[1-9]\d*$/.test(value) && Number(value) <= 100;
    if (key === "processVersion")
      return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
    return key === "cursor" && value.length > 0;
  });
}
export function createApi(
  fetcher: typeof fetch = (...args) => fetch(...args),
): Api {
  let authorization = "";
  return {
    login(username, password) {
      authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`;
    },
    logout() {
      authorization = "";
    },
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const method = (options.method || "GET").toUpperCase();
      const decision = /^\/requests\/[A-Za-z0-9_-]+\/decisions$/.test(path);
      if (!allowedEndpoint(path) || method !== (decision ? "POST" : "GET"))
        throw new Error("Unsupported endpoint or method");
      const response = await fetcher(`/api${path}`, {
        ...options,
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Arcflow-Client": "approval-demo",
          ...options.headers,
          Authorization: authorization,
        },
      });
      if (!response.ok) throw new ApiError(response.status);
      if (path === "/requests")
        return parseRequestsJson(await response.text()) as T;
      if (/^\/requests\/inbox(?:\?|$)/.test(path))
        return parseInboxJson(await response.text()) as T;
      if (path.startsWith("/requests/"))
        return parseRequestJson(await response.text()) as T;
      return response.json();
    },
  };
}
