export type Provider =
  "browser" | "feishu-web" | "wecom-web" | "dingtalk-web" | "unknown";
export type Capability = "supported" | "unsupported" | "not-configured";
export type ProviderFailure = {
  ok: false;
  code: "PROVIDER_NOT_CONFIGURED" | "CAPABILITY_UNSUPPORTED";
};
export interface ExternalIdentity {
  provider: Exclude<Provider, "browser" | "unknown">;
  externalTenantId: string;
  applicationId: string;
  externalUserId: string;
}
export const identityKey = (identity: ExternalIdentity) =>
  JSON.stringify([
    identity.provider,
    identity.externalTenantId,
    identity.applicationId,
    identity.externalUserId,
  ]);
export interface HostAdapter {
  provider: Provider;
  capabilities: Readonly<{
    identity: Capability;
    notifications: Capability;
    attachments: Capability;
  }>;
  getAuthGrant(): Promise<ProviderFailure>;
  sendNotification(): Promise<ProviderFailure>;
}
// No SDK, OAuth exchange, credentials or executable callbacks in this bounded slice.
export function createHostAdapter(provider: Provider): HostAdapter {
  const state = provider === "browser" ? "unsupported" : "not-configured";
  const failure: ProviderFailure = {
    ok: false,
    code:
      provider === "browser"
        ? "CAPABILITY_UNSUPPORTED"
        : "PROVIDER_NOT_CONFIGURED",
  };
  return {
    provider,
    capabilities: Object.freeze({
      identity: state,
      notifications: state,
      attachments: "unsupported",
    }),
    getAuthGrant: async () => ({ ...failure }),
    sendNotification: async () => ({ ...failure }),
  };
}
export function requestedProvider(search: string): Provider {
  const value = new URLSearchParams(search).get("host");
  if (value === null || value === "browser") return "browser";
  return ["feishu-web", "wecom-web", "dingtalk-web"].includes(value)
    ? (value as Provider)
    : "unknown";
}
export interface RoutePort {
  read(): string;
  open(id: string): void;
  close(): void;
  subscribe(listener: () => void): () => void;
}
export function browserRoute(win: Window = window): RoutePort {
  const read = () => {
    const id = new URL(win.location.href).searchParams.get("task") || "";
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id) ? id : "";
  };
  const update = (id: string) => {
    const url = new URL(win.location.href);
    if (id) url.searchParams.set("task", id);
    else url.searchParams.delete("task");
    win.history.pushState(null, "", url);
    win.dispatchEvent(new Event("arcflow-route"));
  };
  return {
    read,
    open: update,
    close: () => update(""),
    subscribe(listener) {
      win.addEventListener("popstate", listener);
      win.addEventListener("arcflow-route", listener);
      return () => {
        win.removeEventListener("popstate", listener);
        win.removeEventListener("arcflow-route", listener);
      };
    },
  };
}
