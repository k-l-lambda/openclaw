// Fork-specific gateway method descriptors, kept out of the upstream table so
// upstream growth and our additions cannot collide on the max-lines budget.
// Grouped by insertion point: the upstream table splices each group in place so
// each addition stays beside the upstream methods it belongs with, keeping the
// diff against upstream minimal. Order itself carries no contract -- the registry
// is name-keyed (byName map) and the advertise frame sends method names, not
// indices -- so this is for readability, not wire compatibility.
export const FORK_METHOD_SPECS = {
  agentMemory: [
    ["agent.getProfile", "agent", "operator.read", "<=2026.7"],
    ["agent.getMemoryPatch", "agent", "operator.read", "<=2026.7"],
    ["agent.applyMemoryPatch", "agent", "operator.write", "<=2026.7"],
  ],
  notification: [["notification.push", "notification", "operator.write", "<=2026.7"]],
  sessionDrain: [
    ["session.drainPending", "session-drain", "operator.write", "<=2026.7"],
    ["session.drainAllPending", "session-drain", "operator.write", "<=2026.7"],
  ],
} as const;
