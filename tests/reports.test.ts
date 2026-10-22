import { describe, expect, it } from "vitest";
import {
  parseFinalReport,
  parseLeadStatus,
  parseReviewerReport,
  parseReviewerStatus,
  recentAssistantText,
} from "../shared/reports";

describe("parseReviewerReport", () => {
  it("parses the fenced findings block and marker", () => {
    const text = [
      "I checked the auth path.",
      "REVIEW_REPORT: DONE",
      "```review-findings",
      JSON.stringify({
        lens: "security",
        verdict: "warn",
        summary: "One medium issue.",
        findings: [
          {
            severity: "medium",
            title: "Missing tenant check",
            detail: "The lookup ignores tenant id.",
            file: "src/auth.ts:42",
            recommendation: "Scope the query by tenant.",
          },
        ],
      }),
      "```",
    ].join("\n");

    const parsed = parseReviewerReport(text);
    expect(parsed.marker).toBe("done");
    expect(parsed.parsed).toBe(true);
    expect(parsed.verdict).toBe("warn");
    expect(parsed.lens).toBe("security");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].severity).toBe("medium");
    expect(parsed.findings[0].file).toBe("src/auth.ts:42");
  });

  it("keeps the raw text when the fenced JSON is broken", () => {
    const text = ["REVIEW_REPORT: DONE", "```review-findings", "{not json", "```"].join("\n");
    const parsed = parseReviewerReport(text);
    expect(parsed.parsed).toBe(false);
    expect(parsed.unparsedJson).toBe(true);
    expect(parsed.raw).toContain("{not json");
  });

  it("tolerates trailing commas", () => {
    const text = [
      "```review-findings",
      '{"verdict":"pass","findings":[],"summary":"ok",}',
      "```",
    ].join("\n");
    const parsed = parseReviewerReport(text);
    expect(parsed.parsed).toBe(true);
    expect(parsed.verdict).toBe("pass");
  });

  it("returns a marker without JSON", () => {
    const parsed = parseReviewerReport("REVIEW_REPORT: BLOCKED\nNo access to the repository.");
    expect(parsed.marker).toBe("blocked");
    expect(parsed.parsed).toBe(false);
    expect(parsed.unparsedJson).toBe(false);
  });
});

describe("parseLeadStatus", () => {
  it("takes the last status line", () => {
    const text = [
      "REVIEW_STATUS: WORKING — briefing reviewers",
      "REVIEW_STATUS: NEEDS_INPUT — reviewer needs a token",
    ].join("\n");
    expect(parseLeadStatus(text)).toEqual({
      state: "needs_input",
      note: "reviewer needs a token",
    });
  });

  it("returns null without a status line", () => {
    expect(parseLeadStatus("Just prose.")).toBeNull();
  });
});

describe("parseReviewerStatus", () => {
  it("maps DONE and COMPLETE to done", () => {
    expect(parseReviewerStatus("REVIEW_STATUS: DONE — finished")).toEqual({
      state: "done",
      note: "finished",
    });
    expect(parseReviewerStatus("REVIEW_STATUS: COMPLETE — finished")?.state).toBe("done");
  });

  it("takes the last status line", () => {
    const text = [
      "REVIEW_STATUS: WORKING — still checking",
      "REVIEW_STATUS: BLOCKED — no credentials",
    ].join("\n");
    expect(parseReviewerStatus(text)).toEqual({
      state: "blocked",
      note: "no credentials",
    });
  });
});

describe("parseFinalReport", () => {
  it("parses verdict, summary, and findings between the sentinels", () => {
    const text = [
      "All reviewers reported.",
      "=== REVIEW TEAM REPORT BEGIN ===",
      "REVIEW_VERDICT: request_changes",
      "```review-final",
      JSON.stringify({
        summary: "One blocker.",
        findings: [
          {
            severity: "high",
            title: "Unscoped delete",
            detail: "A delete has no tenant filter.",
            file: "src/db.ts:88",
            recommendation: "Add the tenant filter.",
          },
        ],
      }),
      "```",
      "=== REVIEW TEAM REPORT END ===",
      "REVIEW_STATUS: COMPLETE — report ready",
    ].join("\n");

    const parsed = parseFinalReport(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.verdict).toBe("request_changes");
    expect(parsed?.summary).toBe("One blocker.");
    expect(parsed?.findings[0].severity).toBe("high");
  });

  it("falls back to plain text when the final JSON is invalid", () => {
    const text = [
      "=== REVIEW TEAM REPORT BEGIN ===",
      "REVIEW_VERDICT: approve",
      "```review-final",
      "looks fine",
      "```",
      "=== REVIEW TEAM REPORT END ===",
    ].join("\n");

    const parsed = parseFinalReport(text);
    expect(parsed?.verdict).toBe("approve");
    expect(parsed?.parsed).toBe(false);
    expect(parsed?.unparsedJson).toBe(true);
    expect(parsed?.summary).toContain("looks fine");
  });

  it("returns null when the sentinels are absent", () => {
    expect(parseFinalReport("No report yet.")).toBeNull();
  });
});

describe("recentAssistantText", () => {
  it("collects only assistant messages in order", () => {
    const entries = [
      { item: { type: "assistant_message", text: "first" } },
      { item: { type: "tool_call", text: "ignored" } },
      { item: { type: "assistant_message", text: "second" } },
    ];
    expect(recentAssistantText(entries)).toBe("first\n\nsecond");
  });
});
