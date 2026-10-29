const ADJECTIVES = [
  "amber", "brave", "calm", "clever", "crisp", "dapper", "eager", "fleet",
  "gentle", "golden", "happy", "humble", "jolly", "keen", "lively", "lucky",
  "mellow", "nimble", "proud", "quiet", "rapid", "rustic", "silver", "steady",
  "sunny", "swift", "tidy", "vivid", "warm", "wise", "witty", "zesty",
];
const NOUNS = [
  "badger", "beacon", "breeze", "canyon", "cedar", "comet", "coral", "falcon",
  "fern", "harbor", "heron", "island", "lantern", "maple", "meadow", "otter",
  "pebble", "pine", "quill", "raven", "reef", "river", "robin", "sparrow",
  "summit", "thistle", "tide", "valley", "willow", "wren", "yarrow", "zephyr",
];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** A random branch (and so worktree) name, such as `swift-otter-4f2a`. */
export function randomBranchName() {
  const suffix = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${suffix}`;
}
