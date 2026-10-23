import type { PaseoApi } from "@getpaseo/client";
import { describe, expect, it, vi } from "vitest";
import {
  listProviderOptions,
  providerOptionFromSnapshotEntry,
  resolveModeId,
  resolveThinkingOptionId,
} from "../server/agents";

describe("provider options", () => {
  it("maps modes and per-model thinking options from a snapshot entry", () => {
    const option = providerOptionFromSnapshotEntry({
      provider: "codex",
      label: "Codex",
      modes: [
        { id: "read-only", label: "Read only", description: "Read files only" },
        { id: "full-access", label: "Full access" },
      ],
      defaultModeId: "full-access",
      models: [
        {
          id: "gpt-5",
          label: "GPT-5",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High", isDefault: true },
          ],
          defaultThinkingOptionId: "high",
        },
        { id: "gpt-5-mini", label: "GPT-5 mini", isSelectable: false },
      ],
    });

    expect(option).toEqual({
      id: "codex",
      label: "Codex",
      modes: [
        { id: "read-only", label: "Read only", description: "Read files only" },
        { id: "full-access", label: "Full access", description: null },
      ],
      defaultModeId: "full-access",
      models: [
        {
          id: "gpt-5",
          label: "GPT-5",
          isDefault: true,
          thinkingOptions: [
            { id: "low", label: "Low", description: null },
            { id: "high", label: "High", description: null },
          ],
          defaultThinkingOptionId: "high",
        },
      ],
    });
  });

  it("falls back to a valid thinking default and drops empty providers", () => {
    const option = providerOptionFromSnapshotEntry({
      provider: "claude",
      modes: [{ id: "default", label: "Default" }],
      defaultModeId: "missing",
      models: [
        {
          id: "sonnet",
          label: "Sonnet",
          thinkingOptions: [
            { id: "balanced", label: "Balanced" },
            { id: "deep", label: "Deep", isDefault: true },
          ],
          defaultThinkingOptionId: "missing",
        },
      ],
    });

    expect(option?.defaultModeId).toBeNull();
    expect(option?.models[0].defaultThinkingOptionId).toBe("deep");

    expect(
      providerOptionFromSnapshotEntry({
        provider: "empty",
        models: [{ id: "hidden", label: "Hidden", isSelectable: false }],
      }),
    ).toBeNull();
  });

  it("resolves saved selections against the current provider and model", () => {
    const provider = {
      modes: [
        { id: "read-only", label: "Read only", description: null },
        { id: "full-access", label: "Full access", description: null },
      ],
      defaultModeId: "read-only",
    };
    expect(resolveModeId(provider, "full-access")).toBe("full-access");
    expect(resolveModeId(provider, "missing")).toBe("read-only");
    expect(resolveModeId(provider, null)).toBe("read-only");
    expect(resolveModeId({ modes: [], defaultModeId: null }, "full-access")).toBeNull();

    const model = {
      thinkingOptions: [
        { id: "low", label: "Low", description: null },
        { id: "high", label: "High", description: null },
      ],
      defaultThinkingOptionId: "high",
    };
    expect(resolveThinkingOptionId(model, "low")).toBe("low");
    expect(resolveThinkingOptionId(model, "missing")).toBe("high");
    expect(resolveThinkingOptionId(model, null)).toBe("high");
    expect(
      resolveThinkingOptionId(
        { thinkingOptions: [], defaultThinkingOptionId: null },
        "high",
      ),
    ).toBeNull();
  });

  it("uses the provider snapshot before the fallback lists", async () => {
    const listAvailable = vi.fn();
    const paseo = {
      providers: {
        snapshot: vi.fn(async () => ({
          entries: [
            {
              provider: "codex",
              status: "ready",
              enabled: true,
              label: "Codex",
              models: [
                {
                  provider: "codex",
                  id: "gpt-5",
                  label: "GPT-5",
                  thinkingOptions: [{ id: "high", label: "High" }],
                  defaultThinkingOptionId: "high",
                },
              ],
              modes: [{ id: "full-access", label: "Full access" }],
              defaultModeId: "full-access",
            },
          ],
        })),
        listAvailable,
      },
    } as unknown as PaseoApi;

    const options = await listProviderOptions(paseo);
    expect(options).toHaveLength(1);
    expect(options[0].defaultModeId).toBe("full-access");
    expect(options[0].models[0].defaultThinkingOptionId).toBe("high");
    expect(listAvailable).not.toHaveBeenCalled();
  });

  it("falls back to listModels and listModes when the snapshot is empty", async () => {
    const paseo = {
      providers: {
        snapshot: vi.fn(async () => ({ entries: [] })),
        listAvailable: vi.fn(async () => ({
          providers: [{ provider: "claude", available: true }],
        })),
        listModels: vi.fn(async () => ({
          provider: "claude",
          models: [
            {
              provider: "claude",
              id: "sonnet",
              label: "Sonnet",
              thinkingOptions: [{ id: "deep", label: "Deep" }],
              defaultThinkingOptionId: "deep",
            },
          ],
        })),
        listModes: vi.fn(async () => ({
          provider: "claude",
          modes: [{ id: "default", label: "Default" }],
        })),
      },
    } as unknown as PaseoApi;

    const options = await listProviderOptions(paseo);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("claude");
    expect(options[0].modes).toEqual([
      { id: "default", label: "Default", description: null },
    ]);
    expect(options[0].models[0].thinkingOptions).toEqual([
      { id: "deep", label: "Deep", description: null },
    ]);
    expect(options[0].models[0].defaultThinkingOptionId).toBe("deep");
  });
});
