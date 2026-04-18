/**
 * Shared types for runner adapters.
 */

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type MaybeCommandSpec = CommandSpec | null | undefined;

export interface ProjectTarget {
  /** Unique name of the target. */
  name: string;
  /** ID of the runner that handle this target. */
  runner: string;
  /** Working directory for the target. */
  cwd?: string;
  /** Optional build command. */
  build?: MaybeCommandSpec;
  /** Command to launch the target (required). */
  launch: MaybeCommandSpec;
  /** Optional test command. */
  test?: MaybeCommandSpec;
}

/**
 * Runner adapter interface.
 * Implementations handle build/test/launch for different languages.
 */
export interface RunnerAdapter {
  id: string;
  detect(root: string): Promise<boolean>;
  listTargets(root: string): Promise<ProjectTarget[]>;
  build(target: ProjectTarget): Promise<MaybeCommandSpec>;
  test(target: ProjectTarget): Promise<MaybeCommandSpec>;
  launch(target: ProjectTarget): MaybeCommandSpec;
}