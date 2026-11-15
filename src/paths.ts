import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Everything the factory owns lives in one folder outside every repo (~/.factory), so factory
 * bookkeeping never makes a checkout look dirty. FACTORY_HOME moves it (tests use a temp dir).
 */
export function factoryHome(): string {
  return process.env.FACTORY_HOME ?? join(homedir(), ".factory");
}

export const paths = {
  home: () => factoryHome(),
  db: () => join(factoryHome(), "factory.db"),
  run: () => join(factoryHome(), "run"),
  /** The engine's only door: a Unix socket file, mode 0600. No TCP port anywhere. */
  socket: () => process.env.FACTORY_SOCKET ?? join(factoryHome(), "run", "factoryd.sock"),
  pid: () => join(factoryHome(), "run", "factoryd.pid"),
  log: () => join(factoryHome(), "factoryd.log"),
  /** Each task's files: research.md, statechart.md, Factory.tla, plan.md, review-*.md, decision.md. */
  job: (taskId: string) => join(factoryHome(), "jobs", taskId),
  worktrees: () => join(factoryHome(), "worktrees"),
  worktree: (repoName: string, taskId: string) => join(factoryHome(), "worktrees", repoName, taskId),
  /** The factory's own skills; never the person's ~/.claude/skills. */
  skills: () => join(factoryHome(), "skills"),
  tools: () => join(factoryHome(), "tools"),
};
