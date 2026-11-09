import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "./nativePlatform";

export function CopyButton({
  text,
  label = "Copy code",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="md-copy"
      aria-label={copied ? "Copied" : label}
      data-tip={copied ? "Copied" : label}
      onClick={() =>
        copyText(text).then(
          () => setCopied(true),
          () => {},
        )
      }
    >
      {copied ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
    </button>
  );
}
