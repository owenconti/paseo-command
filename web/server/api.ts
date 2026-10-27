/**
 * The local API: routes over the Paseo daemon's SDK (and, where only it can
 * help, the CLI), served by the Vite dev and preview servers and the native
 * host. The pieces live in server/api/; this module is their public face.
 */
import { resetConnections } from "./daemon";
import { resetFleet } from "./fleet";
import { resetLive } from "./live";
import { resetEpochs } from "./api/agents";
import { resetCliSlots } from "./api/cli";
import { resetRegistry, unfollow } from "./api/hosts";
import { resetUsage } from "./api/reads";
import { resetLinks } from "./links";

export { redactText } from "./redact";
export { PaseoError, CLI_SLOTS, cliEnv, cliLoad, paseo } from "./api/cli";
export {
  AGENT_COMMANDS,
  LABEL_COLORS,
  dispatchPlan,
  option,
  validateAgentPost,
  workspaceArchiveCommand,
  workspaceLabelCommand,
  type DispatchPlan,
} from "./api/validate";
export { LOCAL, REGISTRY, timed } from "./api/hosts";
export { agentDetail, detailOf } from "./api/agents";
export { affectedKeys } from "./api/commands";
export { handleUpgrade } from "./api/stream";
export { handleApi } from "./api/routes";
export { apiPlugin, attachApiServer } from "./api/server";

/** Forget every cache, snapshot, health record, feed and connection (tests). */
export function resetApiState() {
  resetLive();
  resetEpochs();
  unfollow();
  resetFleet();
  resetConnections();
  resetCliSlots();
  resetUsage();
  resetRegistry();
  resetLinks();
}
