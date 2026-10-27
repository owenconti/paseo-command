/**
 * Reading thrown values, which may be anything (an Error, a string, an SDK
 * payload, null). Each helper reads one property the way `e?.prop` would.
 */
const field = (e: unknown, key: string): unknown =>
  e !== null && e !== undefined
    ? (Object(e) as Record<string, unknown>)[key]
    : undefined;

/** `e?.message`: the value's own message, if it has one. */
export const messageOf = (e: unknown) => field(e, "message");

/** `e?.message ?? e`, as text. */
export const errorMessage = (e: unknown) => String(messageOf(e) ?? e);

/** `e?.code`: a Node error's code (`ENOENT`, `EPERM`) or an exit code. */
export const errorCode = (e: unknown) => field(e, "code");
