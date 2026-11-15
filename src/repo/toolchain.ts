import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Purpose = "test" | "lint" | "typecheck" | "build" | "format";

export interface ToolCommand {
  purpose: Purpose;
  command: string;
  from: string;
}

export interface Toolchain {
  commands: ToolCommand[];
  ci: { file: string; run: string }[];
}

const PURPOSE: [Purpose, RegExp][] = [
  ["typecheck", /^(typecheck|type-check|types|tsc|check-types|mypy)$/],
  ["lint", /^(lint|lint:.*|clippy|vet|check|ruff|rubocop|eslint)$/],
  ["format", /^(format|fmt|format:check|fmt-check|prettier)$/],
  ["test", /^(test|tests|test:.*|unit|spec|e2e|integration|check:.*)$/],
  ["build", /^(build|compile|bundle)$/],
];

const purposeOf = (name: string): Purpose | undefined => PURPOSE.find(([, re]) => re.test(name))?.[0];
const has = (repo: string, f: string) => existsSync(join(repo, f));
const text = (repo: string, f: string) => (has(repo, f) ? readFileSync(join(repo, f), "utf8") : "");

function nodeRunner(repo: string): string {
  if (has(repo, "pnpm-lock.yaml")) return "pnpm";
  if (has(repo, "yarn.lock")) return "yarn";
  if (has(repo, "bun.lockb") || has(repo, "bun.lock")) return "bun";
  return "npm";
}

function pythonRunner(repo: string): string {
  if (has(repo, "uv.lock")) return "uv run ";
  if (has(repo, "poetry.lock")) return "poetry run ";
  if (has(repo, "pdm.lock")) return "pdm run ";
  return "";
}

const targets = (body: string, re: RegExp) => [...body.matchAll(re)].map((m) => m[1]!).filter((t, i, all) => all.indexOf(t) === i);

export function discover(repo: string): Toolchain {
  const commands: ToolCommand[] = [];
  const add = (purpose: Purpose | undefined, command: string, from: string) => {
    if (purpose && !commands.some((c) => c.command === command)) commands.push({ purpose, command, from });
  };

  if (has(repo, "package.json")) {
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(text(repo, "package.json")) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      scripts = {};
    }
    const pm = nodeRunner(repo);
    for (const name of Object.keys(scripts)) add(purposeOf(name), name === "test" ? `${pm} test` : `${pm} run ${name}`, "package.json scripts");
  }
  for (const f of ["Makefile", "makefile", "GNUmakefile"]) for (const t of targets(text(repo, f), /^([A-Za-z][\w:-]*):(?!=)/gm)) add(purposeOf(t), `make ${t}`, f);
  for (const f of ["justfile", "Justfile", ".justfile"]) for (const t of targets(text(repo, f), /^([A-Za-z][\w-]*)\s*(?:[\w\s=*+"'-]*)?:(?!=)/gm)) add(purposeOf(t), `just ${t}`, f);
  for (const f of ["Taskfile.yml", "Taskfile.yaml"]) {
    const body = text(repo, f).split(/^tasks:\s*$/m)[1] ?? "";
    for (const t of targets(body, /^ {2}([\w:-]+):\s*$/gm)) add(purposeOf(t), `task ${t}`, f);
  }
  if (has(repo, "Cargo.toml")) {
    add("test", "cargo test", "Cargo.toml");
    add("lint", "cargo clippy", "Cargo.toml");
    add("format", "cargo fmt --check", "Cargo.toml");
    add("build", "cargo build", "Cargo.toml");
  }
  if (has(repo, "go.mod")) {
    add("test", "go test ./...", "go.mod");
    add("lint", "go vet ./...", "go.mod");
    add("build", "go build ./...", "go.mod");
    if (has(repo, ".golangci.yml") || has(repo, ".golangci.yaml")) add("lint", "golangci-lint run", ".golangci.yml");
  }
  const py = text(repo, "pyproject.toml") + text(repo, "setup.cfg");
  if (py || has(repo, "requirements.txt") || has(repo, "setup.py")) {
    const run = pythonRunner(repo);
    if (has(repo, "tox.ini")) add("test", "tox", "tox.ini");
    if (has(repo, "noxfile.py")) add("test", "nox", "noxfile.py");
    if (/pytest/.test(py) || has(repo, "pytest.ini") || has(repo, "conftest.py") || has(repo, "tests")) add("test", `${run}pytest`, "pytest config");
    if (/\[tool\.ruff/.test(py) || has(repo, "ruff.toml") || has(repo, ".ruff.toml")) add("lint", `${run}ruff check .`, "ruff config");
    if (/\[tool\.mypy|\[mypy/.test(py) || has(repo, "mypy.ini")) add("typecheck", `${run}mypy .`, "mypy config");
    if (/\[tool\.black/.test(py)) add("format", `${run}black --check .`, "black config");
  }
  if (has(repo, "Gemfile")) {
    if (has(repo, "spec")) add("test", "bundle exec rspec", "spec/");
    else if (has(repo, "Rakefile")) add("test", "bundle exec rake test", "Rakefile");
    if (has(repo, ".rubocop.yml")) add("lint", "bundle exec rubocop", ".rubocop.yml");
  }
  if (has(repo, "pom.xml")) {
    const mvn = has(repo, "mvnw") ? "./mvnw" : "mvn";
    add("test", `${mvn} -q test`, "pom.xml");
    add("build", `${mvn} -q package -DskipTests`, "pom.xml");
  }
  if (has(repo, "build.gradle") || has(repo, "build.gradle.kts")) {
    const gradle = has(repo, "gradlew") ? "./gradlew" : "gradle";
    add("test", `${gradle} test`, "build.gradle");
    add("lint", `${gradle} check`, "build.gradle");
    add("build", `${gradle} build -x test`, "build.gradle");
  }
  if (has(repo, "Package.swift")) {
    add("test", "swift test", "Package.swift");
    add("build", "swift build", "Package.swift");
  }
  if (has(repo, "mix.exs")) {
    add("test", "mix test", "mix.exs");
    add("format", "mix format --check-formatted", "mix.exs");
  }
  const dotnet = readdirSync(repo).find((f) => f.endsWith(".sln") || f.endsWith(".csproj"));
  if (dotnet) {
    add("test", "dotnet test", dotnet);
    add("build", "dotnet build", dotnet);
  }
  if (has(repo, "composer.json")) {
    try {
      const scripts = (JSON.parse(text(repo, "composer.json")) as { scripts?: Record<string, unknown> }).scripts ?? {};
      for (const name of Object.keys(scripts)) add(purposeOf(name), `composer run ${name}`, "composer.json scripts");
    } catch {
      add("test", "composer test", "composer.json");
    }
  }

  const ci: Toolchain["ci"] = [];
  const workflows = join(repo, ".github", "workflows");
  if (existsSync(workflows)) {
    for (const f of readdirSync(workflows).filter((x) => /\.ya?ml$/.test(x))) {
      const body = readFileSync(join(workflows, f), "utf8");
      for (const m of body.matchAll(/^\s*(?:-\s*)?run:\s*(?:\|\s*\n((?:\s{6,}.*\n?)+)|(.+))$/gm)) {
        const run = (m[1] ?? m[2] ?? "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" && ");
        if (run) ci.push({ file: `.github/workflows/${f}`, run: run.slice(0, 200) });
      }
    }
  }
  for (const f of [".gitlab-ci.yml", "bitbucket-pipelines.yml", ".circleci/config.yml", "Jenkinsfile", "azure-pipelines.yml"]) if (has(repo, f)) ci.push({ file: f, run: "(see the file)" });
  return { commands, ci };
}

export function toolchainMarkdown(t: Toolchain): string {
  const lines = ["## Toolchain", ""];
  if (!t.commands.length)
    lines.push("No test, lint or build commands were found in the repo's manifests. Find how the repo is checked (README, CONTRIBUTING, CI) before changing code, and say what you found.", "");
  else {
    lines.push(
      "Commands found in the repo's own manifests. Use these, not tools the repo doesn't use. Stage sessions are allowed to run them.",
      "",
      "| Purpose | Command | From |",
      "| --- | --- | --- |",
    );
    for (const c of t.commands) lines.push(`| ${c.purpose} | \`${c.command}\` | ${c.from} |`);
    lines.push("");
  }
  if (t.ci.length) {
    lines.push("### What CI runs", "", "CI is the bar a change must clear. Run the same checks locally where you can.", "");
    for (const c of t.ci.slice(0, 25)) lines.push(`- ${c.file}: \`${c.run.replace(/`/g, "'")}\``);
    lines.push("");
  }
  return lines.join("\n");
}

export const allowRules = (t: Toolchain) => t.commands.map((c) => `Bash(${c.command}:*)`);
