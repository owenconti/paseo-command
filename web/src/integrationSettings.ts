import { useEffect, useSyncExternalStore } from "react";
import { api, errorMessage } from "./api";
import {
  DEFAULT_INTEGRATIONS,
  integrationSettings,
  type Integration,
  type Integrations,
} from "./integrations";

type State = {
  integrations: Integrations;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  pending?: { name: Integration; enabled: boolean };
};
let state: State = {
  integrations: DEFAULT_INTEGRATIONS,
  loaded: false,
  saving: false,
  error: null,
};
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
const update = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};
export async function refreshIntegrations() {
  if (state.saving) return;
  if (loading) return loading;
  loading = api<{ integrations?: unknown; error?: string | null }>("settings")
    .then(
      (answer) =>
        update({
          integrations: integrationSettings(answer.integrations),
          loaded: true,
          error: answer.error ?? null,
        }),
      (error) =>
        update({
          integrations: DEFAULT_INTEGRATIONS,
          loaded: true,
          error: errorMessage(error),
        }),
    )
    .finally(() => {
      loading = undefined;
    });
  return loading;
}
export async function setIntegration(name: Integration, enabled: boolean) {
  if (loading) await loading;
  if (state.saving) return;
  update({ saving: true, pending: { name, enabled }, error: null });
  try {
    const answer = await api<{ integrations?: unknown; error?: string | null }>(
      "settings",
      { integrations: { [name]: enabled } },
    );
    if (answer.error) throw new Error(answer.error);
    update({
      integrations: integrationSettings(answer.integrations),
      saving: false,
      pending: undefined,
    });
  } catch (error) {
    update({ saving: false, pending: undefined, error: errorMessage(error) });
  }
}
export function useIntegrations() {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
  useEffect(() => {
    if (!state.loaded) void refreshIntegrations();
  }, []);
  return value;
}
if (typeof window !== "undefined")
  window.addEventListener("focus", () => void refreshIntegrations());
