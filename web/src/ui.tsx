import { copyText } from "./nativePlatform";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { providerLogos } from "./providerLogos";
import { providerName, tone } from "./types";

export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${tone(status)}`}>
      <span className={`dot ${tone(status)}`} />
      {status.replaceAll("_", " ")}
    </span>
  );
}
export function ProviderIcon({ provider }: { provider: string }) {
  const name = providerName(provider);
  const logo = Object.hasOwn(providerLogos, name)
    ? providerLogos[name]
    : undefined;
  return logo ? (
    <span
      className={`provider-icon ${name}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: logo }}
    />
  ) : (
    <span className={`provider-icon ${name}`} aria-hidden="true">
      ◇
    </span>
  );
}
export function CopyButton({
  value,
  label,
  className = "icon-btn",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      data-tip={copied ? "Copied" : label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
