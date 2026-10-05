import type { Api } from "./types";
export class ApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
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
      if (
        !/^\/(me|people|requests(?:\/[A-Za-z0-9_-]+\/decisions)?)$/.test(path)
      )
        throw new Error("Unsupported endpoint");
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
      return response.json();
    },
  };
}
