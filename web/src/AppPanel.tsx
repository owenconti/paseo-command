import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const compactQuery = "(max-width: 800px)";
const subscribeCompact = (notify: () => void) => {
  const query = window.matchMedia(compactQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
export const useCompactLayout = () =>
  useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(compactQuery).matches,
  );

/** The operational panel fills the window, including above a mobile keyboard. */
export function AppPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = ref.current!;
    const host =
      panel.closest<HTMLElement>(".command-app") || panel.parentElement!;
    const viewport = window.visualViewport;
    const resize = () => {
      const height =
        viewport && Math.abs(viewport.scale - 1) < 0.01
          ? `${Math.round(viewport.height)}px`
          : "100dvh";
      host.style.setProperty("--app-height", height);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    const reveal = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      const session = target.closest<HTMLElement>(".session");
      const composer = session?.querySelector(
        ".session-footer > .composer-shell",
      );
      if (!session || !composer || composer.contains(target)) return;
      requestAnimationFrame(() => {
        const covered =
          target.getBoundingClientRect().bottom -
          composer.getBoundingClientRect().top;
        if (covered > 0) session.scrollTop += covered + 8;
      });
    };
    panel.addEventListener("focusin", reveal);
    const arrivals = new MutationObserver((records) => {
      const arrived = records.some((record) =>
        [...record.addedNodes].some(
          (node) =>
            node instanceof HTMLElement &&
            (node.matches(".session, .permission") ||
              node.querySelector(".session")),
        ),
      );
      if (arrived) {
        const session = panel.querySelector(".session");
        if (session) session.scrollTop = session.scrollHeight;
      }
    });
    arrivals.observe(panel, { childList: true, subtree: true });
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      panel.removeEventListener("focusin", reveal);
      arrivals.disconnect();
    };
  }, []);
  return (
    <section
      ref={ref}
      id="app-panel"
      className="app-panel"
      aria-label="Fleet and inspector"
    >
      {children}
    </section>
  );
}
