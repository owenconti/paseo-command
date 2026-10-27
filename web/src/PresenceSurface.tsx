import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ForwardedRef,
} from "react";
import { motion, useIsPresent, type HTMLMotionProps } from "framer-motion";

function usePresenceRef<T extends HTMLElement>(forwarded: ForwardedRef<T>) {
  const present = useIsPresent();
  const local = useRef<T | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      local.current = node;
      if (typeof forwarded === "function") forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [forwarded],
  );
  useLayoutEffect(() => {
    if (!present && local.current?.contains(document.activeElement))
      (document.activeElement as HTMLElement | null)?.blur();
  }, [present]);
  return { present, ref };
}

// Exit animations retain DOM after logical close. Release its input and
// accessibility ownership immediately, even when a hidden window pauses motion.
export const PresenceDiv = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function PresenceDiv(props, forwarded) {
    const { present, ref } = usePresenceRef(forwarded);
    return (
      <motion.div
        {...props}
        ref={ref}
        inert={!present || props.inert}
        aria-hidden={!present ? true : props["aria-hidden"]}
        style={{
          ...props.style,
          ...(!present ? { pointerEvents: "none" } : {}),
        }}
      />
    );
  },
);

export const PresenceList = forwardRef<HTMLUListElement, HTMLMotionProps<"ul">>(
  function PresenceList(props, forwarded) {
    const { present, ref } = usePresenceRef(forwarded);
    return (
      <motion.ul
        {...props}
        ref={ref}
        inert={!present || props.inert}
        aria-hidden={!present ? true : props["aria-hidden"]}
        style={{
          ...props.style,
          ...(!present ? { pointerEvents: "none" } : {}),
        }}
      />
    );
  },
);
