// agent.getMemoryPatch + agent.applyMemoryPatch RPC handlers.
// Incremental memory sync between gateway agent workspaces and Anthroid.
// getMemoryPatch returns a git diff of workspace/memory/ since a timestamp
// (or a full file snapshot when no base commit exists); applyMemoryPatch applies
// a patch or a full file set, with a path-traversal guard on file names. Re-ported
// onto upstream's per-handler-module structure during the 0724 upstream rebase.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveAssistantIdentity } from "../assistant-identity.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import type { GatewayRequestHandlers } from "./types.js";

const execFileAsync = promisify(execFile);

export const agentGetMemoryPatchHandler: GatewayRequestHandlers["agent.getMemoryPatch"] =
  async ({ params, respond, context }) => {
    const p = params as Record<string, unknown>;
    const cfg = context.getRuntimeConfig();
    const identity = resolveAssistantIdentity({
      cfg,
      agentId: typeof p.agentId === "string" ? normalizeAgentId(p.agentId) : undefined,
    });
    const workspaceDir = resolveAgentWorkspaceDir(cfg, identity.agentId);
    const memoryDir = path.join(workspaceDir, "memory");

    try {
      const sinceRaw = p.sinceTimestamp;
      let sinceDate: string | undefined;
      if (typeof sinceRaw === "number") {
        sinceDate = new Date(sinceRaw).toISOString();
      } else if (typeof sinceRaw === "string" && sinceRaw.trim()) {
        sinceDate = sinceRaw.trim();
      }

      const gitOpts = { cwd: workspaceDir, timeout: 10_000 };

      let baseCommit = "";
      if (sinceDate) {
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["log", `--before=${sinceDate}`, "--format=%H", "-1", "--", "memory/"],
            gitOpts,
          );
          baseCommit = stdout.trim();
        } catch {
          baseCommit = "";
        }
      }

      if (!baseCommit) {
        // No base commit — return full content of all memory/ files as a "full sync" response.
        const files: Record<string, string> = {};
        try {
          const entries = await fs.readdir(memoryDir);
          for (const entry of entries) {
            if (entry.endsWith(".md")) {
              const content = await fs.readFile(path.join(memoryDir, entry), "utf-8");
              files[entry] = content;
            }
          }
        } catch {
          // memory/ doesn't exist
        }
        respond(true, { mode: "full", files, latestTimestamp: Date.now() }, undefined);
        return;
      }

      const { stdout: patch } = await execFileAsync(
        "git",
        ["diff", baseCommit, "HEAD", "--", "memory/"],
        gitOpts,
      );

      let latestTimestamp = Date.now();
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["log", "-1", "--format=%ct", "--", "memory/"],
          gitOpts,
        );
        const epoch = Number.parseInt(stdout.trim(), 10);
        if (!Number.isNaN(epoch)) latestTimestamp = epoch * 1000;
      } catch {
        // Use current time
      }

      respond(true, { mode: "patch", patch, latestTimestamp }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `getMemoryPatch failed: ${String(err)}`),
      );
    }
  };

export const agentApplyMemoryPatchHandler: GatewayRequestHandlers["agent.applyMemoryPatch"] =
  async ({ params, respond, context }) => {
    const p = params as Record<string, unknown>;
    const cfg = context.getRuntimeConfig();
    const identity = resolveAssistantIdentity({
      cfg,
      agentId: typeof p.agentId === "string" ? normalizeAgentId(p.agentId) : undefined,
    });
    const workspaceDir = resolveAgentWorkspaceDir(cfg, identity.agentId);
    const memoryDir = path.join(workspaceDir, "memory");
    const gitOpts = { cwd: workspaceDir, timeout: 10_000 };

    try {
      const mode = typeof p.mode === "string" ? p.mode : "full";

      if (mode === "patch" && typeof p.patch === "string" && p.patch.trim()) {
        try {
          const tmpPatch = path.join(workspaceDir, ".anthroid-patch.tmp");
          await fs.writeFile(tmpPatch, p.patch, "utf-8");
          try {
            await execFileAsync("git", ["apply", "--check", tmpPatch], gitOpts);
            await execFileAsync("git", ["apply", tmpPatch], gitOpts);
          } finally {
            await fs.unlink(tmpPatch).catch(() => {});
          }
        } catch (applyErr) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `Patch apply failed (conflict?): ${String(applyErr)}. Please resolve manually.`,
            ),
          );
          return;
        }
      } else if (mode === "full" && p.files && typeof p.files === "object") {
        await fs.mkdir(memoryDir, { recursive: true });
        const files = p.files as Record<string, string>;
        const resolvedMemoryDir = path.resolve(memoryDir) + path.sep;
        for (const [name, content] of Object.entries(files)) {
          if (typeof content !== "string" || !name.endsWith(".md")) continue;
          // Path traversal guard: reject names with path separators or ".."
          if (
            /[/\\]/.test(name) ||
            name.includes("..") ||
            !path.resolve(memoryDir, name).startsWith(resolvedMemoryDir)
          ) {
            continue;
          }
          await fs.writeFile(path.join(memoryDir, name), content, "utf-8");
        }
      } else {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Invalid mode or missing data"),
        );
        return;
      }

      try {
        await execFileAsync("git", ["add", "memory/"], gitOpts);
        await execFileAsync(
          "git",
          ["commit", "-m", "anthroid memory sync", "--allow-empty"],
          gitOpts,
        );
      } catch {
        // Commit may fail if nothing changed — that's ok
      }

      respond(true, { ok: true, timestamp: Date.now() }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `applyMemoryPatch failed: ${String(err)}`),
      );
    }
  };
