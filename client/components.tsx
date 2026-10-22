import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Finding, Reviewer } from "../shared/contracts";
import {
  lensLabelFor,
  type PresetClientConfig,
  type PresetVerdictLabels,
} from "../shared/presets";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const STATUS_LABELS: Record<string, string> = {
  starting: "Menyiapkan",
  running: "Berjalan",
  needs_input: "Perlu perhatian",
  stopped: "Dihentikan",
  failed: "Gagal",
  initializing: "Menyiapkan",
  idle: "Idle",
  error: "Gagal",
  closed: "Ditutup",
  working: "Bekerja",
  done: "Selesai",
  complete: "Selesai",
  blocked: "Terhambat",
  archived: "Diarsipkan",
  unknown: "Tidak diketahui",
};

const PHASE_LABELS: Record<string, string> = {
  starting: "Menyiapkan",
  reviewing: "Review berjalan",
  consolidating: "Konsolidasi",
  complete: "Selesai",
  stopped: "Dihentikan",
  failed: "Gagal",
};

function toneForStatus(status: string): Tone {
  if (status === "done" || status === "complete") return "success";
  if (status === "running" || status === "reviewing" || status === "consolidating") return "accent";
  if (status === "needs_input" || status === "blocked" || status === "idle") return "warning";
  if (status === "failed" || status === "error") return "danger";
  return "neutral";
}

function toneColor(theme: PluginTheme, tone: Tone): string {
  if (tone === "accent") return theme.colors.accent;
  if (tone === "success") return theme.colors.statusSuccess;
  if (tone === "warning") return theme.colors.statusWarning;
  if (tone === "danger") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

export function StatusBadge({
  theme,
  status,
  label,
}: {
  theme: PluginTheme;
  status: string;
  label?: string;
}) {
  const tone = toneForStatus(status);
  const color = toneColor(theme, tone);
  return (
    <View style={[badgeStyles.badge, { borderColor: color, backgroundColor: theme.colors.surface1 }]}>
      <Text style={[badgeStyles.text, { color }]}>{label ?? STATUS_LABELS[status] ?? status}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  text: { fontSize: 11, fontWeight: "700" },
});

export function PhaseBadge({ theme, phase }: { theme: PluginTheme; phase: string }) {
  return <StatusBadge theme={theme} status={phase} label={PHASE_LABELS[phase] ?? phase} />;
}

export function SeverityBadge({ theme, severity }: { theme: PluginTheme; severity: string }) {
  const tone: Tone =
    severity === "high" ? "danger" : severity === "medium" ? "warning" : "neutral";
  const color = toneColor(theme, tone);
  return (
    <View style={[badgeStyles.badge, { borderColor: color, backgroundColor: theme.colors.surface1 }]}>
      <Text style={[badgeStyles.text, { color }]}>{severity.toUpperCase()}</Text>
    </View>
  );
}

const DEFAULT_VERDICTS: Record<string, { label: string; tone: Tone }> = {
  approve: { label: "APPROVE", tone: "success" },
  request_changes: { label: "PERLU PERUBAHAN", tone: "warning" },
  blocked: { label: "BLOCKED", tone: "danger" },
  pass: { label: "PASS", tone: "success" },
  warn: { label: "WARN", tone: "warning" },
  fail: { label: "FAIL", tone: "danger" },
};

export function VerdictBadge({
  theme,
  verdict,
  preset,
}: {
  theme: PluginTheme;
  verdict: string;
  preset?: Pick<PresetClientConfig, "labels"> | null;
}) {
  const fallback = DEFAULT_VERDICTS[verdict];
  const custom = preset?.labels.verdicts[verdict as keyof PresetVerdictLabels];
  const color = toneColor(theme, fallback?.tone ?? "neutral");
  return (
    <View style={[badgeStyles.badge, { borderColor: color, backgroundColor: theme.colors.surface1 }]}>
      <Text style={[badgeStyles.text, { color }]}>
        {custom ?? fallback?.label ?? verdict.toUpperCase()}
      </Text>
    </View>
  );
}

export function Card({
  theme,
  children,
  style,
}: {
  theme: PluginTheme;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 14,
          gap: 10,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({
  theme,
  children,
  trailing,
}: {
  theme: PluginTheme;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "700" }}>{children}</Text>
      {trailing}
    </View>
  );
}

export function Muted({
  theme,
  children,
  selectable,
}: {
  theme: PluginTheme;
  children: ReactNode;
  selectable?: boolean;
}) {
  return (
    <Text selectable={selectable} style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
      {children}
    </Text>
  );
}

export function BodyText({
  theme,
  children,
  selectable = true,
}: {
  theme: PluginTheme;
  children: ReactNode;
  selectable?: boolean;
}) {
  return (
    <Text selectable={selectable} style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 20 }}>
      {children}
    </Text>
  );
}

export function Button({
  theme,
  label,
  onPress,
  variant = "secondary",
  disabled,
  compact,
}: {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  compact?: boolean;
}) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          borderRadius: 9,
          borderWidth: 1,
          paddingHorizontal: compact ? 12 : 14,
          paddingVertical: compact ? 8 : 10,
          alignItems: "center",
          justifyContent: "center",
        },
        primary: {
          backgroundColor: theme.colors.accent,
          borderColor: theme.colors.accent,
        },
        secondary: {
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
        },
        danger: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.statusDanger,
        },
        textPrimary: { color: theme.colors.accentForeground },
        textSecondary: { color: theme.colors.foreground },
        textDanger: { color: theme.colors.statusDanger },
      }),
    [theme, compact],
  );

  const textStyle =
    variant === "primary" ? styles.textPrimary : variant === "danger" ? styles.textDanger : styles.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" ? styles.primary : variant === "danger" ? styles.danger : styles.secondary,
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.75 },
      ]}
    >
      <Text style={[textStyle, { fontSize: 12, fontWeight: "700" }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  theme,
  label,
  selected,
  onPress,
  disabled,
}: {
  theme: PluginTheme;
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderRadius: 999,
          borderWidth: 1,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: selected ? theme.colors.accent : theme.colors.surface2,
          paddingHorizontal: 12,
          paddingVertical: 7,
        },
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.75 },
      ]}
    >
      <Text
        style={{
          color: selected ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: 12,
          fontWeight: selected ? "700" : "500",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function CoverageBar({
  theme,
  completed,
  total,
}: {
  theme: PluginTheme;
  completed: number;
  total: number;
}) {
  const ratio = total > 0 ? Math.min(1, completed / total) : 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
          Coverage laporan
        </Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 11, fontWeight: "700" }}>
          {completed}/{total} lensa
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 999,
          backgroundColor: theme.colors.surface2,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: 6,
            width: `${Math.round(ratio * 100)}%`,
            borderRadius: 999,
            backgroundColor: ratio === 1 ? theme.colors.statusSuccess : theme.colors.accent,
          }}
        />
      </View>
    </View>
  );
}

export function FindingsList({
  theme,
  findings,
  preset,
}: {
  theme: PluginTheme;
  findings: Finding[];
  preset?: Pick<PresetClientConfig, "labels"> | null;
}) {
  const labels = preset?.labels;
  if (findings.length === 0) {
    return (
      <Muted theme={theme}>
        Tidak ada {(labels?.findings ?? "temuan").toLowerCase()} terstruktur.
      </Muted>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {findings.map((finding, index) => (
        <View
          key={`${finding.title}-${index}`}
          style={{
            borderLeftWidth: 3,
            borderLeftColor:
              finding.severity === "high"
                ? theme.colors.statusDanger
                : finding.severity === "medium"
                  ? theme.colors.statusWarning
                  : theme.colors.border,
            paddingLeft: 10,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <SeverityBadge theme={theme} severity={finding.severity} />
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700", flexShrink: 1 }}>
              {finding.title}
            </Text>
          </View>
          <BodyText theme={theme}>{finding.detail}</BodyText>
          {finding.file ? (
            <Text selectable style={{ color: theme.colors.accent, fontSize: 11 }}>
              {labels?.location ? `${labels.location}: ${finding.file}` : finding.file}
            </Text>
          ) : null}
          {finding.recommendation ? (
            <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
              {labels?.recommendation ?? "Saran"}: {finding.recommendation}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function ReviewerCard({
  theme,
  reviewer,
  preset,
  onOpenAgent,
}: {
  theme: PluginTheme;
  reviewer: Reviewer;
  preset: PresetClientConfig;
  onOpenAgent?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const findingLabel = preset.labels.findings;
  const findingLabelLower = findingLabel.toLowerCase();
  return (
    <Card theme={theme} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700" }}>
            {lensLabelFor(preset, reviewer.lens)}
          </Text>
          <StatusBadge theme={theme} status={reviewer.status} />
          {reviewer.verdict ? (
            <VerdictBadge theme={theme} verdict={reviewer.verdict} preset={preset} />
          ) : null}
        </View>
        {onOpenAgent ? (
          <Button theme={theme} label="Buka agen" onPress={onOpenAgent} compact />
        ) : null}
      </View>

      {reviewer.summary ? <BodyText theme={theme}>{reviewer.summary}</BodyText> : null}

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Muted theme={theme}>
          {reviewer.findings.length} {findingLabelLower}
        </Muted>
        {reviewer.reportFormat === "text" ? (
          <Muted theme={theme}>Format teks (JSON tidak valid)</Muted>
        ) : null}
        {reviewer.reportFormat === "none" ? <Muted theme={theme}>Belum ada laporan</Muted> : null}
      </View>

      {reviewer.findings.length > 0 ? (
        expanded ? (
          <FindingsList findings={reviewer.findings} preset={preset} theme={theme} />
        ) : (
          <View style={{ gap: 4 }}>
            {reviewer.findings.slice(0, 3).map((finding, index) => (
              <View
                key={`${finding.title}-${index}`}
                style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}
              >
                <SeverityBadge theme={theme} severity={finding.severity} />
                <Text style={{ color: theme.colors.foreground, fontSize: 12, flexShrink: 1 }}>
                  {finding.title}
                </Text>
              </View>
            ))}
            {reviewer.findings.length > 3 ? (
              <Muted theme={theme}>
                +{reviewer.findings.length - 3} {findingLabelLower} lainnya.
              </Muted>
            ) : null}
          </View>
        )
      ) : null}

      {reviewer.findings.length > 3 ? (
        <Button
          theme={theme}
          label={
            expanded
              ? `Sembunyikan ${findingLabelLower}`
              : `Lihat semua ${findingLabelLower} (${reviewer.findings.length})`
          }
          onPress={() => setExpanded((value) => !value)}
          compact
        />
      ) : null}

      {reviewer.reportText && reviewer.reportFormat === "text" ? (
        <>
          <Button
            theme={theme}
            label={expanded ? "Sembunyikan laporan" : "Lihat laporan"}
            onPress={() => setExpanded(!expanded)}
            compact
          />
          {expanded ? (
            <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
              {reviewer.reportText}
            </Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
