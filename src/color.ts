import { styleText } from "node:util";

/** Honors NO_COLOR, FORCE_COLOR, and TTY, same convention jev-cli uses. */
export function shouldColor(env: NodeJS.ProcessEnv = process.env, isTTY = process.stdout.isTTY): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR === "0") return false;
  if (env.FORCE_COLOR !== undefined) return true;
  return Boolean(isTTY);
}

export type Style = Parameters<typeof styleText>[0];
/** A single style name, never the array form (useful when composing your own arrays). */
export type SingleStyle = Exclude<Style, readonly string[]>;

/**
 * `enabled` is decided once, up front, by `shouldColor()`. `validateStream:
 * false` stops `styleText` from doing its own independent TTY check on top,
 * which would otherwise silently strip styling in non-TTY contexts (piping
 * to `cat`, running under a test runner) even when we deliberately want it.
 */
export function paint(enabled: boolean, style: Style, text: string): string {
  return enabled ? styleText(style, text, { validateStream: false }) : text;
}
