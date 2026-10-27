import { nativeAvailable, nativeEvents, postNative } from "./worldBridge";

let sequence = 0;
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function nativeRequest(
  action: string,
  values: Record<string, unknown> = {},
) {
  if (!nativeAvailable())
    return Promise.reject(new Error("Native host unavailable."));
  const id = `platform-${++sequence}`;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The native action did not answer. Try again."));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    postNative({ type: "platform", action, id, ...values });
  });
}
if (typeof window !== "undefined")
  nativeEvents((event) => {
    if (event.type !== "platformResult" || !event.id) return;
    const request = pending.get(event.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(event.id);
    if (event.error) request.reject(new Error(event.error));
    else request.resolve(event.value);
  });
export function copyText(value: string) {
  return nativeAvailable()
    ? nativeRequest("clipboardWrite", { text: value }).then((copied) => {
        if (copied !== true)
          throw new Error("The text could not be copied. Try again.");
      })
    : navigator.clipboard.writeText(value);
}
export function installNativeLinks() {
  if (!nativeAvailable()) return;
  void nativeRequest("notificationStatus")
    .then((value) => {
      nativePermission =
        value === "granted"
          ? "granted"
          : value === "denied"
            ? "denied"
            : "default";
      window.dispatchEvent(new Event("paseo:notification-permission"));
    })
    .catch(() => {});
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element)?.closest?.(
      "a[href]",
    ) as HTMLAnchorElement | null;
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.origin === location.origin && !anchor.target) return;
    event.preventDefault();
    void nativeRequest("externalLink", { url: url.href }).catch(() => {});
  });
}

let nativePermission: NotificationPermission = "default";
const notificationClicks = new Map<string, () => void>();
export const notificationsSupported = () =>
  nativeAvailable() || typeof Notification !== "undefined";
export const notificationPermission = (): NotificationPermission =>
  nativeAvailable()
    ? nativePermission
    : typeof Notification !== "undefined"
      ? Notification.permission
      : "denied";
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!nativeAvailable()) return Notification.requestPermission();
  const value = await nativeRequest("notificationPermission");
  nativePermission =
    value === "granted" ? "granted" : value === "denied" ? "denied" : "default";
  return nativePermission;
}
export function showNotification(
  title: string,
  body: string,
  tag: string,
  activate: () => void,
  agentId?: string,
) {
  if (nativeAvailable()) {
    notificationClicks.set(tag, activate);
    if (notificationClicks.size > 200)
      notificationClicks.delete(notificationClicks.keys().next().value!);
    postNative({
      type: "platform",
      action: "notify",
      id: tag,
      title,
      body,
      tag,
      agentId,
    });
    return;
  }
  const shown = new Notification(title, { body, tag });
  shown.onclick = () => {
    window.focus();
    activate();
    shown.close();
  };
}
if (typeof window !== "undefined")
  nativeEvents((event) => {
    if (event.type === "notification" && event.id && !event.agentId)
      notificationClicks.get(event.id)?.();
  });
