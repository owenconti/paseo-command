import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type PropsWithChildren,
} from "react";
import { motion, useIsPresent } from "framer-motion";

/** A departing rail page stays visible for its fade, but cannot cover or keep
 * keyboard focus over the incoming session's controls. popLayout needs its DOM ref. */
export const RailView = forwardRef<HTMLDivElement, PropsWithChildren>(
  function RailView({ children }, forwardedRef) {
    const present = useIsPresent();
    const local = useRef<HTMLDivElement | null>(null);
    const ref = useCallback(
      (node: HTMLDivElement | null) => {
        local.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );
    useLayoutEffect(() => {
      if (!present && local.current?.contains(document.activeElement)) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }, [present]);
    return (
      <motion.div
        ref={ref}
        className="rail-view"
        inert={!present}
        aria-hidden={!present || undefined}
        style={!present ? { pointerEvents: "none" } : undefined}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.16 }}
      >
        {children}
      </motion.div>
    );
  },
);
