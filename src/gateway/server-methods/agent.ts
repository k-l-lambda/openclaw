import { agentGetProfileHandler } from "./agent-get-profile.js";
import { agentRunHandler } from "./agent-run-handler.js";
import { agentWaitHandler } from "./agent-wait.js";
// Gateway agent methods implement agent.run, agent.wait, and agent profile
// (Anthroid memory sync) RPCs.
import type { GatewayRequestHandlers } from "./types.js";

export const agentHandlers: GatewayRequestHandlers = {
  agent: agentRunHandler,
  "agent.getProfile": agentGetProfileHandler,
  "agent.wait": agentWaitHandler,
};
