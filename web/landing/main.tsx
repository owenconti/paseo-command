import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  ArrowRight,
  Bell,
  Check,
  Desktop,
  Eye,
  HandPointing,
  Lock,
  MapTrifold,
  Planet,
  Robot,
  ShieldCheck,
  Terminal,
} from "@phosphor-icons/react";
import atlasShot from "./shots/atlas.jpg";
import galaxyShot from "./shots/galaxy.jpg";
import islandShot from "./shots/atlas-island.jpg";
import "./landing.css";

// The one action this page asks for: open the app it describes.
const APP = "/";
const CTA = "Open your fleet map";
const EASE = [0.22, 1, 0.36, 1] as const;

function PrimaryCta({ className = "" }: { className?: string }) {
  return (
    <a
      href={APP}
      className={`group inline-flex items-center gap-2 rounded-lg bg-gold px-3 py-2 text-base font-semibold text-black transition-colors duration-300 ease-weighted hover:bg-gold-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${className}`}
    >
      {CTA}
      <ArrowRight
        weight="bold"
        className="size-4 transition-transform duration-500 ease-weighted group-hover:translate-x-1 motion-reduce:transform-none"
      />
    </a>
  );
}

/** A section that rises into place the first time it scrolls into view. */
function Reveal({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      id={id}
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      {children}
    </motion.section>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase tracking-widest text-gold">
      {children}
    </p>
  );
}

const LINKS = [
  { href: "#benefits", label: "Why a map" },
  { href: "#worlds", label: "Worlds" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

function Nav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  // Links arrive 60ms apart, the whole sequence held under 400ms.
  const step = Math.min(0.06, 0.4 / (LINKS.length + 1));
  return (
    <>
      <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <nav
          aria-label="Main"
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-neutral-950/60 p-2 backdrop-blur-md"
        >
          <a
            href="#top"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold tracking-wide text-white"
          >
            <MapTrifold weight="duotone" className="size-5 text-gold" />
            Paseo Command
          </a>
          <ul className="hidden items-center md:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="rounded-lg px-3 py-2 text-sm text-neutral-400 transition-colors duration-300 ease-weighted hover:text-white"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <a
            href={APP}
            className="hidden rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-black transition-colors duration-300 ease-weighted hover:bg-gold-soft md:block"
          >
            Open the map
          </a>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen(!open)}
            className="relative size-10 rounded-lg text-white md:hidden"
          >
            {[-1, 1].map((side) => (
              <span
                key={side}
                className="absolute left-3 top-1/2 h-0.5 w-4 rounded-full bg-current transition-transform duration-500 ease-weighted"
                style={{
                  transform: open
                    ? `translateY(-50%) rotate(${side * 45}deg)`
                    : `translateY(calc(-50% + ${side * 4}px))`,
                }}
              />
            ))}
          </button>
        </nav>
      </header>
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            className="fixed inset-0 z-40 flex flex-col bg-black/90 px-6 pt-24 backdrop-blur-xl md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <ul className="flex flex-col gap-2">
              {[...LINKS, { href: APP, label: CTA }].map((l, i) => (
                <motion.li
                  key={l.href}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: EASE, delay: i * step }}
                >
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg py-3 text-2xl font-semibold ${
                      l.href === APP ? "text-gold" : "text-white"
                    }`}
                  >
                    {l.label}
                  </a>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Hero() {
  return (
    <section id="top" className="px-6 pt-24">
      <div className="mx-auto flex max-w-6xl flex-col items-center pt-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="flex flex-col items-center"
        >
          <Eyebrow>For people running a fleet of coding agents</Eyebrow>
          <h1 className="mt-6 max-w-[680px] bg-linear-to-r from-white to-[#9B9B9B] bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
            Know which agent needs you{" "}
            <br className="hidden sm:block" />
            without opening every terminal
          </h1>
          <p className="mt-6 max-w-[680px] text-lg text-neutral-400">
            Paseo Command draws your Paseo fleet as one living map. Machines
            become landmasses, projects become islands, and every Claude and
            Codex agent stands on a tile that shows whether it is working,
            waiting for you, finished or stuck.
          </p>
          <PrimaryCta className="mt-8" />
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-neutral-400">
            {[
              [Lock, "Runs on 127.0.0.1"],
              [ShieldCheck, "No account to create"],
              [Eye, "Seven agent states told apart"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Lock;
              return (
                <li key={text as string} className="flex items-center gap-2">
                  <I weight="bold" className="size-4 text-gold" />
                  {text as string}
                </li>
              );
            })}
          </ul>
        </motion.div>
        <motion.figure
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
          className="mt-16 w-full rounded-2xl border border-white/10 bg-[#181818] p-2"
        >
          <img
            src={atlasShot}
            width={1600}
            height={1000}
            alt="Paseo Command showing two machines as islands, with agents on coloured tiles beside their workspaces and a panel listing which agents need you"
            className="w-full rounded-lg"
          />
          <figcaption className="sr-only">
            The Atlas world with an illustrative fleet of eleven agents.
          </figcaption>
        </motion.figure>
      </div>
    </section>
  );
}

// B11: the tagline lights up word by word as it scrolls through the viewport.
const TAGLINE =
  "Your agents already know what they are doing. Paseo Command makes sure you do too, the moment one of them stops and waits.";

function Word({
  word,
  progress,
  range,
}: {
  word: string;
  progress: MotionValue<number>;
  range: [number, number];
}) {
  const opacity = useTransform(progress, range, [0.15, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block">
      {word}&nbsp;
    </motion.span>
  );
}

function Tagline() {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.45"],
  });
  const words = TAGLINE.split(" ");
  return (
    <section className="px-6 py-24">
      <p
        ref={ref}
        className="mx-auto max-w-4xl text-3xl font-semibold tracking-tight text-white sm:text-5xl"
        style={{ textWrap: "balance" }}
      >
        <span className="sr-only">{TAGLINE}</span>
        <span aria-hidden="true">
          {words.map((w, i) => (
            <Word
              key={i}
              word={w}
              progress={scrollYProgress}
              range={[i / words.length, (i + 1) / words.length]}
            />
          ))}
        </span>
      </p>
    </section>
  );
}

function Problem() {
  return (
    <Reveal className="px-6 py-24">
      <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#181818] p-8">
          <Eyebrow>Without a map</Eyebrow>
          <h2 className="mt-4 text-2xl font-semibold text-white">
            Twelve terminals and one question: who is waiting on me?
          </h2>
          <p className="mt-4 text-neutral-400">
            You start agents on your laptop and on the machine under the desk.
            One finished an hour ago. One has been asking permission to run a
            migration since lunch. You find out by tabbing through every
            session, one at a time.
          </p>
        </div>
        <div className="rounded-2xl border border-gold/30 bg-[#181818] p-8">
          <Eyebrow>With Paseo Command</Eyebrow>
          <h2 className="mt-4 text-2xl font-semibold text-white">
            One glance answers it, for every machine at once.
          </h2>
          <p className="mt-4 text-neutral-400">
            The agent that needs approval pulses amber at the top of the list.
            The finished one glows gold until you read it. The failed one is
            red. Press <Kbd>N</Kbd> to jump straight to the next agent that
            needs you.
          </p>
        </div>
      </div>
    </Reveal>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-white/15 bg-[#272727] px-1 font-mono text-sm text-white">
      {children}
    </kbd>
  );
}

const STATES = [
  ["bg-state-working", "Working"],
  ["bg-state-approval", "Needs approval"],
  ["bg-state-question", "Has a question"],
  ["bg-state-failed", "Failed"],
  ["bg-state-done", "Done, unread"],
  ["border border-white/40", "Idle"],
  ["bg-state-offline", "Offline, last known"],
] as const;

const BENEFITS = [
  {
    icon: Bell,
    title: "Catch the agent that is waiting",
    body: "Approvals and questions rise to a Needs you group and pulse on the map, so a blocked agent never sits unnoticed for an hour.",
  },
  {
    icon: Eye,
    title: "Trust what every tile says",
    body: "Running, idle, finished, approval, question, failed and offline each look different. A light runs round working tiles; tiles that need you breathe.",
  },
  {
    icon: Desktop,
    title: "See every machine in one place",
    body: "Each host is its own landmass under its own banner. When one goes offline it fades and keeps showing what it last knew.",
  },
  {
    icon: HandPointing,
    title: "Act without switching tools",
    body: "Pick a robot to open its conversation. Approve, answer or dispatch a new agent from the panel beside the map.",
  },
];

function Benefits() {
  return (
    <Reveal id="benefits" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <Eyebrow>Why a map</Eyebrow>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Spend your attention on the agents that need it
        </h2>
        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_minmax(0,28rem)]">
          <ul className="grid gap-6 sm:grid-cols-2">
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="rounded-2xl border border-white/10 bg-[#181818] p-6"
              >
                <span className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-[#272727]">
                  <Icon weight="duotone" className="size-5 text-gold" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-white">
                  {title}
                </h3>
                <p className="mt-2 text-sm text-neutral-400">{body}</p>
              </li>
            ))}
          </ul>
          <figure className="flex flex-col rounded-2xl border border-white/10 bg-[#181818] p-2">
            <img
              src={islandShot}
              width={640}
              height={660}
              alt="Close up of one project island: a landmark ringed by workspace cottages, each with robots on green, amber, gold and white tiles"
              className="w-full rounded-lg"
            />
            <figcaption className="p-4">
              <p className="text-sm font-semibold text-white">
                Every state, told apart
              </p>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {STATES.map(([swatch, label]) => (
                  <li
                    key={label}
                    className="flex items-center gap-2 text-xs text-neutral-400"
                  >
                    <span className={`size-3 rounded-sm ${swatch}`} />
                    {label}
                  </li>
                ))}
              </ul>
            </figcaption>
          </figure>
        </div>
      </div>
    </Reveal>
  );
}

const WORLDS = {
  atlas: {
    label: "Atlas",
    icon: MapTrifold,
    shot: atlasShot,
    body: "Hosts are hex landmasses in a painted sea. Projects are islands with a landmark at their heart, workspaces are timber cottages, and agents are robots: Claude orange, Codex white.",
    alt: "The Atlas world: hex islands in a blue sea with robots beside workspace cottages",
  },
  galaxy: {
    label: "Galaxy",
    icon: Planet,
    shot: galaxyShot,
    body: "Hosts are nebulae. Projects are rotating planets, workspaces are stations in orbit, and agents are satellites whose beams relay to their planet while they work.",
    alt: "The Galaxy world: planets inside orange and blue nebulae with satellites in orbit",
  },
} as const;

function Worlds() {
  const [world, setWorld] = useState<keyof typeof WORLDS>("atlas");
  return (
    <Reveal id="worlds" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Eyebrow>Two worlds, one fleet</Eyebrow>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Pick the world you like looking at all day
            </h2>
          </div>
          <div
            role="tablist"
            aria-label="World"
            className="flex rounded-xl border border-white/10 bg-[#181818] p-1"
          >
            {(Object.keys(WORLDS) as (keyof typeof WORLDS)[]).map((key) => {
              const { label, icon: Icon } = WORLDS[key];
              const on = key === world;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setWorld(key)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-300 ease-weighted ${
                    on ? "bg-[#313131] text-white" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <Icon weight="duotone" className="size-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-6 max-w-2xl text-neutral-400">
          {WORLDS[world].body} Switch from the map toolbar or with{" "}
          <Kbd>⌘</Kbd> <Kbd>⌥</Kbd> <Kbd>T</Kbd>; your choice is remembered.
        </p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-[#181818] p-2">
          <div className="grid overflow-hidden rounded-lg">
            {(Object.keys(WORLDS) as (keyof typeof WORLDS)[]).map((key) => (
              <img
                key={key}
                src={WORLDS[key].shot}
                width={1600}
                height={1000}
                alt={WORLDS[key].alt}
                aria-hidden={key !== world}
                className={`col-start-1 row-start-1 w-full transition-opacity duration-500 ease-weighted ${
                  key === world ? "opacity-100" : "opacity-0"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

const STEPS = [
  {
    icon: Robot,
    title: "Keep Paseo running",
    body: "Paseo Command reads the Paseo daemon you already use to run agents, on this machine and every host it knows.",
  },
  {
    icon: Terminal,
    title: "Start the map",
    body: "One command serves the app on your own machine.",
    code: "npm run app:dev",
  },
  {
    icon: HandPointing,
    title: "Pick a robot",
    body: "Its conversation opens beside the map. Approve, answer, or press D to dispatch another agent.",
  },
];

function HowItWorks() {
  return (
    <Reveal id="how" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          From terminal tabs to a full map in three steps
        </h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body, code }, i) => (
            <li
              key={title}
              className="flex flex-col rounded-2xl border border-white/10 bg-[#181818] p-6"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-[#272727]">
                  <Icon weight="duotone" className="size-5 text-gold" />
                </span>
                <span className="font-mono text-sm text-neutral-500">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-6 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm text-neutral-400">{body}</p>
              {code && (
                <code className="mt-4 rounded-lg border border-white/10 bg-black px-3 py-2 font-mono text-sm text-gold-soft">
                  {code}
                </code>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Reveal>
  );
}

const FACTS = [
  ["7", "agent states, each drawn differently"],
  ["2", "worlds drawing the same fleet"],
  ["0", "daemon actions sent by the map itself"],
  ["1", "loopback address: 127.0.0.1"],
];

function Proof() {
  return (
    <Reveal className="px-6 py-24">
      <div className="mx-auto max-w-6xl rounded-2xl border border-white/10 bg-[#181818] p-8 md:p-12">
        <Eyebrow>Built to be believed</Eyebrow>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          A map is only useful if it never lies to you
        </h2>
        <p className="mt-4 max-w-2xl text-neutral-400">
          Every tile comes from what the daemon reports. A finished agent stays
          gold until you read it, and a host that drops off the network fades
          instead of pretending its agents are still running.
        </p>
        <dl className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map(([n, label]) => (
            <div
              key={label}
              className="rounded-lg border border-white/10 bg-[#1F1F1F] p-6"
            >
              <dt className="sr-only">{label}</dt>
              <dd>
                <span className="block font-mono text-5xl font-semibold text-white">
                  {n}
                </span>
                <span className="mt-2 block text-sm text-neutral-400">
                  {label}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Reveal>
  );
}

const FAQ: [string, string][] = [
  [
    "What is Paseo Command?",
    "A visual control room for Paseo. It shows every host, project, workspace and agent the Paseo daemon knows about as a map, with a panel beside it for reading conversations, approving requests and dispatching new agents.",
  ],
  [
    "Do I need Paseo already?",
    "Yes. Paseo Command reads your fleet through the official Paseo SDK, so it shows whatever the Paseo daemon on your machine reports.",
  ],
  [
    "Which agents does it show?",
    "Every agent Paseo runs. Claude agents are orange robots, ChatGPT and Codex agents are white, and any other provider keeps a stable colour of its own.",
  ],
  [
    "Does anything leave my machine?",
    "No. The app and its API are bound to 127.0.0.1 and talk only to your local Paseo daemon. There is no account and nothing to sign in to.",
  ],
  [
    "Can the map change what my agents are doing?",
    "The map itself only selects and shows. Approving, answering, archiving and dispatching happen in the panel, where you can see exactly what you are about to do.",
  ],
  [
    "How do I know an agent needs me?",
    "It moves into the Needs you group at the top of the list, its tile pulses on the map, and the header counts how many are waiting. Press N to jump to the next one.",
  ],
  [
    "Can I watch more than one machine?",
    "Yes. Every host Paseo knows about gets its own landmass and banner. Offline hosts fade and are labeled, and keep showing their last known state.",
  ],
  [
    "Atlas or Galaxy: what is the difference?",
    "Only the look. Both draw the same fleet with the same states. Switch from the map toolbar or with Command Option T, and the choice is remembered.",
  ],
  [
    "Is there a keyboard workflow?",
    "J and K move through agents, N jumps to the next one needing you, D opens dispatch and F fits the whole map to the window.",
  ],
  [
    "Can I check it from my phone?",
    "The panels adapt to small screens. If you opt in to tailnet access through tailscale serve, you can reach it from your own devices while the server stays on loopback.",
  ],
];

function Faq() {
  useEffect(() => {
    document.getElementById("faq-schema")!.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  }, []);
  return (
    <Reveal id="faq" className="px-6 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[20rem_1fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Questions before you open it
          </h2>
        </div>
        <div className="grid gap-4">
          {FAQ.map(([q, a]) => (
            <details
              key={q}
              className="group rounded-2xl border border-white/10 bg-[#181818] px-6 py-4 open:bg-[#1F1F1F]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-white [&::-webkit-details-marker]:hidden">
                <h3>{q}</h3>
                <span
                  aria-hidden="true"
                  className="relative size-4 shrink-0 text-neutral-400"
                >
                  <span className="absolute left-0 top-1/2 h-0.5 w-4 -translate-y-1/2 rounded-full bg-current" />
                  <span className="absolute left-0 top-1/2 h-0.5 w-4 -translate-y-1/2 rotate-90 rounded-full bg-current transition-transform duration-500 ease-weighted group-open:rotate-0" />
                </span>
              </summary>
              <p className="mt-3 text-sm text-neutral-400">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

function FinalCta() {
  return (
    <Reveal className="px-6 py-24">
      <div className="mx-auto flex max-w-6xl flex-col items-center rounded-2xl border border-gold/30 bg-[#131209] px-6 py-16 text-center">
        <h2 className="max-w-[680px] text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Know which agent needs you without opening every terminal
        </h2>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-neutral-400">
          {[
            "Nothing to sign up for",
            "Nothing leaves your machine",
            "Close the tab and your agents carry on",
          ].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <Check weight="bold" className="size-4 text-gold" />
              {t}
            </li>
          ))}
        </ul>
        <PrimaryCta className="mt-8" />
      </div>
    </Reveal>
  );
}

function Footer() {
  return (
    <footer className="px-6 pb-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 px-6 py-4 text-sm text-neutral-500 sm:flex-row">
        <span className="flex items-center gap-2 text-neutral-300">
          <MapTrifold weight="duotone" className="size-4 text-gold" />
          Paseo Command
        </span>
        <span>Product shots use an illustrative fleet.</span>
      </div>
    </footer>
  );
}

function Landing() {
  return (
    <MotionConfig reducedMotion="user">
      <Nav />
      <main>
        <Hero />
        <Tagline />
        <Problem />
        <Benefits />
        <Worlds />
        <HowItWorks />
        <Proof />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Landing />
  </React.StrictMode>,
);
