/**
 * The Slack app the Slack tab needs, as a manifest: Slack's "Create New App →
 * From a manifest" takes it whole, or `createAppUrl` opens that page with it
 * filled in. Everything goes as the user (user token scopes only, no bot);
 * live updates come over Socket Mode. Slack can't make the app-level token
 * from a manifest: that's a step of its own (`SETUP_STEPS`).
 */

/** What each Slack Web API method the server calls needs, of the user token's scopes (any one that fits the conversation). */
export const METHOD_SCOPES: Record<string, string[]> = {
  // Who the token is: no scope.
  "auth.test": [],
  "chat.postMessage": ["chat:write"],
  "chat.update": ["chat:write"],
  "chat.delete": ["chat:write"],
  "conversations.history": ["channels:history", "groups:history", "im:history", "mpim:history"],
  "conversations.replies": ["channels:history", "groups:history", "im:history", "mpim:history"],
  "conversations.info": ["channels:read", "groups:read", "im:read", "mpim:read"],
  "users.conversations": ["channels:read", "groups:read", "im:read", "mpim:read"],
  // Marking read is a write, for each kind of conversation.
  "conversations.mark": ["channels:write", "groups:write", "im:write", "mpim:write"],
  "conversations.open": ["im:write", "mpim:write"],
  "users.list": ["users:read"],
  // People from another organisation in a shared channel.
  "users.info": ["users:read"],
  "emoji.list": ["emoji:read"],
  "reactions.get": ["reactions:read"],
  "reactions.add": ["reactions:write"],
  "reactions.remove": ["reactions:write"],
  "search.messages": ["search:read"],
  "files.getUploadURLExternal": ["files:write"],
  "files.completeUploadExternal": ["files:write"],
  // Socket Mode: the app-level token's connections:write, not a user scope.
  "apps.connections.open": [],
};

/** Downloading files and images from files.slack.com. */
const FILE_READ = ["files:read"];

/** The events Socket Mode brings, on the user's behalf (the socket listens for each). */
export const USER_EVENTS = [
  "message.channels",
  "message.groups",
  "message.im",
  "message.mpim",
  "reaction_added",
  "reaction_removed",
  "channel_rename",
  "group_rename",
  "member_joined_channel",
  "user_change",
];

/**
 * Events the socket handles that the Events API doesn't offer an app (Slack's
 * old real-time API only): a conversation read in another Slack client doesn't
 * arrive live, and shows when its unread state is next checked.
 */
export const RTM_ONLY_EVENTS = ["channel_marked", "group_marked", "im_marked", "mpim_marked"];

/** Every user scope the manifest asks for. */
export const USER_SCOPES = [...new Set([...Object.values(METHOD_SCOPES).flat(), ...FILE_READ])].sort();

/** The manifest, as Slack's app manifest schema has it. */
export function slackManifest(name = "Paseo Command") {
  return {
    display_information: {
      name,
      description: "Your Slack in Paseo Command: read, write and react as you.",
      background_color: "#1a1b1e",
    },
    oauth_config: { scopes: { user: USER_SCOPES } },
    settings: {
      event_subscriptions: { user_events: USER_EVENTS },
      socket_mode_enabled: true,
      org_deploy_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** The manifest as JSON, for copying into Slack. */
export const manifestJson = (name?: string) => JSON.stringify(slackManifest(name), null, 2);

/** Slack's Create app page with the manifest filled in. */
export const createAppUrl = (name?: string) =>
  `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(name)))}`;

/** What to do once the app is made, in order. */
export const SETUP_STEPS = [
  "Create the app from the manifest (pick your workspace, then Create).",
  "Install to Workspace (OAuth & Permissions), allow it, then copy the User OAuth Token (xoxp-…) into User token.",
  "For live messages: Basic Information → App-Level Tokens → Generate, with the connections:write scope; copy the token (xapp-…) into App token.",
];
