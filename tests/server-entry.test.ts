import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server";

describe("server entry", () => {
  it("registers every RPC handler and lifecycle hook", () => {
    const handle = vi.fn();
    const on = vi.fn(() => () => undefined);
    const server = { handle, on } as unknown as PluginServerContext;

    const dispose = contribute(server);

    expect(handle).toHaveBeenCalledTimes(7);
    expect(on).toHaveBeenCalledTimes(7);
    expect(typeof dispose).toBe("function");
    dispose();
  });
});
