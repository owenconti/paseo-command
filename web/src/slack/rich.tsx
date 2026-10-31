import { createContext, Fragment, memo, useContext, type ReactNode } from "react";
import { Emoji, onLinkClick } from "./bits";
import { formatSlackDate, messageBlocks, type Block, type Inline, type Style } from "./mrkdwn";
import { useSlack } from "./store";
import type { SlackMessage } from "./types";

/** What a channel link does: opens it in the view. */
export const OpenConversation = createContext<(conversationId: string) => void>(() => {});

function styled(style: Style, node: ReactNode): ReactNode {
  let out = node;
  if (style.code) out = <code>{out}</code>;
  if (style.bold) out = <b>{out}</b>;
  if (style.italic) out = <i>{out}</i>;
  if (style.strike) out = <s>{out}</s>;
  return out;
}

function UserMention({ id, style }: { id: string; style: Style }) {
  const name = useSlack((d) => d.users.get(id)?.name);
  const self = useSlack((d) => d.workspace?.selfId === id);
  return styled(style, <span className={`slack-mention${self ? " self" : ""}`} data-tip={name ? undefined : id}>@{name ?? "someone"}</span>);
}

function ChannelMention({ id, name, style }: { id: string; name?: string; style: Style }) {
  const known = useSlack((d) => d.conversations.get(id));
  const open = useContext(OpenConversation);
  const label = known?.name ?? name ?? "channel";
  return styled(
    style,
    known ? (
      <button type="button" className="slack-mention channel" onClick={() => open(id)}>
        #{label}
      </button>
    ) : (
      <span className="slack-mention channel">#{label}</span>
    ),
  );
}

function InlineNode({ node }: { node: Inline }) {
  switch (node.t) {
    case "text":
      return <>{styled(node, node.text)}</>;
    case "link": {
      const href = node.url;
      const safe = /^(https?:|mailto:)/i.test(href);
      const label = node.label ?? href.replace(/^mailto:/, "");
      return <>{styled(node, safe ? <a href={href} target="_blank" rel="noreferrer noopener" onClick={onLinkClick}>{label}</a> : label)}</>;
    }
    case "user":
      return <UserMention id={node.id} style={node} />;
    case "channel":
      return <ChannelMention id={node.id} name={node.name} style={node} />;
    case "usergroup":
      return <>{styled(node, <span className="slack-mention group">@{node.name ?? "group"}</span>)}</>;
    case "broadcast":
      return <span className="slack-mention broadcast">@{node.range}</span>;
    case "emoji":
      return <Emoji name={node.name} unicode={node.unicode} skin={node.skin} />;
    case "date": {
      const text = formatSlackDate(node.timestamp, node.format, node.fallback);
      const at = new Date(node.timestamp * 1000);
      return (
        <time className="slack-date" dateTime={Number.isNaN(at.getTime()) ? undefined : at.toISOString()}>
          {node.url ? <a href={node.url} target="_blank" rel="noreferrer noopener" onClick={onLinkClick}>{text}</a> : text}
        </time>
      );
    }
  }
}

const Inlines = ({ nodes }: { nodes: Inline[] }) => (
  <>
    {nodes.map((n, i) => (
      <InlineNode key={i} node={n} />
    ))}
  </>
);

/** Only emoji (up to 23, as Slack): they show big. */
const onlyEmoji = (blocks: Block[]) => {
  if (blocks.length !== 1 || blocks[0].t !== "paragraph") return false;
  const nodes = blocks[0].inlines.filter((n) => !(n.t === "text" && !n.text.trim()));
  return nodes.length > 0 && nodes.length <= 23 && nodes.every((n) => n.t === "emoji");
};

/** Blocks as the page shows them; `trailing` (a message's "(edited)") ends the last line. */
export function RichBlocks({ blocks, trailing }: { blocks: Block[]; trailing?: ReactNode }) {
  const big = onlyEmoji(blocks);
  const last = blocks.length - 1;
  const tail = (i: number) => (i === last && trailing ? <> {trailing}</> : null);
  return (
    <div className={`slack-rich${big ? " emoji-only" : ""}`}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "paragraph":
            return (
              <p key={i}>
                <Inlines nodes={b.inlines} />
                {tail(i)}
              </p>
            );
          case "quote":
            return (
              <blockquote key={i}>
                <Inlines nodes={b.inlines} />
                {tail(i)}
              </blockquote>
            );
          case "pre":
            return (
              <Fragment key={i}>
                <pre>{b.text}</pre>
                {tail(i)}
              </Fragment>
            );
          case "list": {
            const List = b.style === "ordered" ? "ol" : "ul";
            return (
              <List key={i} className={`indent-${Math.min(b.indent, 6)}`} start={b.style === "ordered" ? b.offset + 1 : undefined}>
                {b.items.map((item, n) => (
                  <li key={n}>
                    <Inlines nodes={item} />
                    {n === b.items.length - 1 && tail(i)}
                  </li>
                ))}
              </List>
            );
          }
          default:
            return <Fragment key={i} />;
        }
      })}
    </div>
  );
}

/** A message's text: its rich text, else its mrkdwn; `trailing` ends its last line. */
export const MessageText = memo(function MessageText({ message, trailing }: { message: Pick<SlackMessage, "text" | "blocks">; trailing?: ReactNode }) {
  const blocks = messageBlocks(message);
  if (blocks.length === 0) return trailing ? <>{trailing}</> : null;
  return <RichBlocks blocks={blocks} trailing={trailing} />;
});
