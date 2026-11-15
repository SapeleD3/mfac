import { homedir } from "node:os";
import { join } from "node:path";

export function factoryHome(): string {
  return process.env.FACTORY_HOME ?? join(homedir(), ".factory");
}

export const paths = {
  home: () => factoryHome(),
  db: () => join(factoryHome(), "factory.db"),
  run: () => join(factoryHome(), "run"),
  socket: () => process.env.FACTORY_SOCKET ?? join(factoryHome(), "run", "factoryd.sock"),
  pid: () => join(factoryHome(), "run", "factoryd.pid"),
  log: () => join(factoryHome(), "factoryd.log"),
  job: (taskId: string) => join(factoryHome(), "jobs", taskId),
  worktrees: () => join(factoryHome(), "worktrees"),
  worktree: (repoName: string, taskId: string) => join(factoryHome(), "worktrees", repoName, taskId),
  skills: () => join(factoryHome(), "skills"),
  tools: () => join(factoryHome(), "tools"),
  sessions: () => join(factoryHome(), "sessions"),
};
