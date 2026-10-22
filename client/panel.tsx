import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PANEL_REFRESH_MS } from "../shared/constants";
import type { ReviewSession, ReviewTeamState } from "../shared/contracts";
import {
  depthFor,
  lensLabelFor,
  type PresetClientConfig,
} from "../shared/presets";
import {
  leadSendRpc,
  requestReportRpc,
  sessionRefreshRpc,
  sessionStopRpc,
  stateGetRpc,
} from "../shared/contracts";
import {
  BodyText,
  Button,
  Card,
  Chip,
  CoverageBar,
  FindingsList,
  Muted,
  PhaseBadge,
  ReviewerCard,
  SectionTitle,
  StatusBadge,
  VerdictBadge,
  formatClock,
} from "./components";
import { SetupForm } from "./setup-form";

const ACTIVE_PHASES = new Set(["starting", "reviewing", "consolidating"]);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isActive(session: ReviewSession): boolean {
  return (
    session.status !== "stopped" &&
    session.status !== "failed" &&
    ACTIVE_PHASES.has(session.phase)
  );
}

export function ReviewTeamPanel(props: PluginWorkspacePanelProps) {
  const { theme, layout, workspaceId, navigation, host } = props;
  const queryClient = useQueryClient();
  const getState = useRpc(stateGetRpc);
  const refreshSession = useRpc(sessionRefreshRpc);
  const sendLead = useRpc(leadSendRpc);
  const requestReport = useRpc(requestReportRpc);
  const stopSession = useRpc(sessionStopRpc);

  const stateKey = useMemo(
    () => ["review-team", "state", host.id, workspaceId] as const,
    [host.id, workspaceId],
  );

  const stateQuery = useQuery({
    queryKey: stateKey,
    queryFn: () => getState({ workspaceId }),
    refetchInterval: (query) => {
      const session = query.state.data?.session;
      return session && isActive(session) ? PANEL_REFRESH_MS : false;
    },
  });

  const session = stateQuery.data?.session ?? null;
  const [showSetup, setShowSetup] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [archiveAgents, setArchiveAgents] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "refresh" | "send" | "report" | "stop">(null);
  const [showRawReport, setShowRawReport] = useState(false);

  const sessionId = session?.id ?? null;
  useEffect(() => {
    setDraft("");
    setConfirmStop(false);
    setWarnings([]);
    setActionError(null);
    setShowRawReport(false);
  }, [sessionId]);

  useEffect(() => {
    setShowSetup(false);
  }, [host.id, workspaceId]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        scroll: { flex: 1, backgroundColor: theme.colors.surface0 },
        content: {
          padding: layout.compact ? 16 : 24,
          gap: 14,
          paddingBottom: 48,
        },
        row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
        spread: {
          flexDirection: layout.compact ? "column" : "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: layout.compact ? "stretch" : "center",
          justifyContent: "space-between",
        },
        input: {
          minHeight: 44,
          maxHeight: 120,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
          color: theme.colors.foreground,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 13,
          lineHeight: 19,
          textAlignVertical: "top",
        },
        reportBox: {
          backgroundColor: theme.colors.surface0,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 9,
          padding: 12,
        },
      }),
    [theme, layout.compact],
  );

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ["review-team", "state", host.id, workspaceId],
    });
  }

  async function handleRefresh() {
    if (!session) return;
    setBusy("refresh");
    setActionError(null);
    try {
      await refreshSession({ sessionId: session.id });
      invalidate();
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    if (!session) return;
    const text = draft.trim();
    if (!text) return;
    setBusy("send");
    setActionError(null);
    try {
      await sendLead({ sessionId: session.id, text });
      setDraft("");
      invalidate();
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleRequestReport() {
    if (!session) return;
    setBusy("report");
    setActionError(null);
    try {
      await requestReport({ sessionId: session.id });
      invalidate();
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleStop() {
    if (!session) return;
    setBusy("stop");
    setActionError(null);
    setWarnings([]);
    try {
      const result = await stopSession({ sessionId: session.id, archiveAgents });
      setWarnings(result.warnings);
      setConfirmStop(false);
      queryClient.setQueryData<ReviewTeamState>(stateKey, (current) =>
        current ? { ...current, session: result.session } : current,
      );
      invalidate();
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  if (stateQuery.isPending) {
    return (
      <View style={[styles.scroll, { padding: layout.compact ? 16 : 24 }]}>
        <Muted theme={theme}>Memuat state Review Team…</Muted>
      </View>
    );
  }

  if (!stateQuery.data) {
    return (
      <View style={[styles.scroll, { padding: layout.compact ? 16 : 24 }]}>
        <Card theme={theme} style={{ borderColor: theme.colors.statusDanger }}>
          <SectionTitle theme={theme}>Gagal memuat Review Team</SectionTitle>
          <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
            {stateQuery.isError ? messageOf(stateQuery.error) : "State tidak tersedia."}
          </Text>
          <Button
            label="Coba lagi"
            onPress={() => {
              void stateQuery.refetch();
            }}
            theme={theme}
            variant="primary"
          />
        </Card>
      </View>
    );
  }

  const state = stateQuery.data;
  const sessionPreset =
    state.presets.find((entry) => entry.id === (session?.presetId ?? "code")) ??
    state.presets[0];
  const setupVisible =
    showSetup ||
    !session ||
    session.status === "stopped" ||
    session.status === "failed";

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {stateQuery.isError ? (
        <Card theme={theme} style={{ borderColor: theme.colors.statusWarning }}>
          <Text selectable style={{ color: theme.colors.statusWarning, fontSize: 12, lineHeight: 18 }}>
            Gagal memperbarui state; menampilkan data terakhir. {messageOf(stateQuery.error)}
          </Text>
          <Button
            compact
            label="Coba lagi"
            onPress={() => {
              void stateQuery.refetch();
            }}
            theme={theme}
          />
        </Card>
      ) : null}
      {state.presetWarnings.length > 0 ? (
        <Card theme={theme} style={{ borderColor: theme.colors.statusWarning }}>
          <SectionTitle theme={theme}>Preset custom bermasalah</SectionTitle>
          {state.presetWarnings.map((warning) => (
            <Text
              key={warning}
              selectable
              style={{ color: theme.colors.statusWarning, fontSize: 12, lineHeight: 18 }}
            >
              {warning}
            </Text>
          ))}
        </Card>
      ) : null}
      {setupVisible ? (
        <>
          {session ? (
            <PastSessionCard preset={sessionPreset} session={session} theme={theme} />
          ) : null}
          {session && showSetup && session.phase === "complete" ? (
            <View style={styles.row}>
              <Button
                compact
                label="Kembali ke hasil sesi"
                onPress={() => setShowSetup(false)}
                theme={theme}
              />
            </View>
          ) : null}
          <SetupForm
            key={`${host.id}:${workspaceId}`}
            compact={layout.compact}
            onStarted={(started) => {
              setShowSetup(false);
              queryClient.setQueryData<ReviewTeamState>(stateKey, (current) =>
                current ? { ...current, session: started } : current,
              );
              invalidate();
            }}
            onStateRefresh={invalidate}
            state={state}
            theme={theme}
            workspaceId={workspaceId}
          />
        </>
      ) : session ? (
        <>
          <Card theme={theme}>
            <View style={styles.spread}>
              <View style={{ gap: 4, flexShrink: 1 }}>
                <Text selectable style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "700" }}>
                  {session.target}
                </Text>
                <Muted theme={theme}>
                  {session.workspaceName ?? session.workspaceId ?? "Workspace"} ·{" "}
                  {sessionPreset.label} · {session.provider} ·{" "}
                  {depthFor(sessionPreset, session.depth).label}
                </Muted>
                <Muted theme={theme}>
                  Mulai {formatClock(session.createdAt)} · aktivitas terakhir{" "}
                  {formatClock(session.lastActivityAt)}
                </Muted>
              </View>
              <View style={styles.row}>
                <PhaseBadge phase={session.phase} theme={theme} />
                {session.phase !== "complete" ? (
                  <StatusBadge status={session.status} theme={theme} />
                ) : null}
              </View>
            </View>
            <CoverageBar
              completed={session.coverage.completed}
              theme={theme}
              total={session.coverage.total}
            />
            <View style={styles.row}>
              <Button
                compact
                disabled={busy !== null}
                label={busy === "refresh" ? "Memuat…" : "Muat ulang"}
                onPress={() => {
                  void handleRefresh();
                }}
                theme={theme}
              />
              <Button
                compact
                disabled={busy !== null || !session.leadAgentId || session.status === "stopped"}
                label={busy === "report" ? "Meminta…" : "Minta laporan"}
                onPress={() => {
                  void handleRequestReport();
                }}
                theme={theme}
              />
              {session.status !== "stopped" ? (
                <Button
                  compact
                  disabled={busy !== null}
                  label="Hentikan sesi"
                  onPress={() => setConfirmStop(true)}
                  theme={theme}
                  variant="danger"
                />
              ) : null}
              {session.phase === "complete" || session.status === "stopped" ? (
                <Button
                  compact
                  label="Review baru"
                  onPress={() => setShowSetup(true)}
                  theme={theme}
                  variant="primary"
                />
              ) : null}
            </View>
          </Card>

          {confirmStop ? (
            <Card theme={theme} style={{ borderColor: theme.colors.statusDanger }}>
              <SectionTitle theme={theme}>Hentikan sesi review?</SectionTitle>
              <BodyText theme={theme}>
                {sessionPreset.roles.lead} akan diinterupsi dan tidak diminta menyusun laporan
                akhir. Pekerjaan {sessionPreset.roles.reviewerPlural} yang sudah selesai tetap
                tersimpan di panel ini.
              </BodyText>
              <View style={styles.row}>
                <Chip
                  label="Arsipkan agen setelah dihentikan"
                  onPress={() => setArchiveAgents((value) => !value)}
                  selected={archiveAgents}
                  theme={theme}
                />
              </View>
              <View style={styles.row}>
                <Button
                  disabled={busy !== null}
                  label={busy === "stop" ? "Menghentikan…" : "Ya, hentikan"}
                  onPress={() => {
                    void handleStop();
                  }}
                  theme={theme}
                  variant="danger"
                />
                <Button
                  disabled={busy !== null}
                  label="Batal"
                  onPress={() => setConfirmStop(false)}
                  theme={theme}
                />
              </View>
            </Card>
          ) : null}

          {warnings.length > 0 ? (
            <Card theme={theme} style={{ borderColor: theme.colors.statusWarning }}>
              {warnings.map((warning) => (
                <Text
                  key={warning}
                  selectable
                  style={{ color: theme.colors.statusWarning, fontSize: 12, lineHeight: 18 }}
                >
                  {warning}
                </Text>
              ))}
            </Card>
          ) : null}

          {actionError ? (
            <Card theme={theme} style={{ borderColor: theme.colors.statusDanger }}>
              <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
                {actionError}
              </Text>
            </Card>
          ) : null}

          {session.error ? (
            <Card theme={theme} style={{ borderColor: theme.colors.statusDanger }}>
              <SectionTitle theme={theme}>Error sesi</SectionTitle>
              <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
                {session.error}
              </Text>
            </Card>
          ) : null}

          <Card theme={theme}>
            <View style={styles.spread}>
              <SectionTitle theme={theme}>{sessionPreset.roles.lead}</SectionTitle>
              <View style={styles.row}>
                {session.leadState ? (
                  <StatusBadge status={session.leadState} theme={theme} />
                ) : session.leadAgentStatus ? (
                  <StatusBadge status={session.leadAgentStatus} theme={theme} />
                ) : (
                  <StatusBadge status="starting" theme={theme} />
                )}
                {navigation && session.leadAgentId ? (
                  <Button
                    compact
                    label={`Buka agen ${sessionPreset.roles.lead.toLowerCase()}`}
                    onPress={() => navigation.openAgent({ agentId: session.leadAgentId! })}
                    theme={theme}
                  />
                ) : null}
              </View>
            </View>
            {session.leadNote ? (
              <BodyText theme={theme}>{session.leadNote}</BodyText>
            ) : (
              <Muted theme={theme}>
                Belum ada catatan status dari {sessionPreset.roles.lead.toLowerCase()}.
              </Muted>
            )}
            {session.pendingPermissions.length > 0 ? (
              <View
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.statusWarning,
                  paddingLeft: 10,
                  gap: 2,
                }}
              >
                <Text style={{ color: theme.colors.statusWarning, fontSize: 12, fontWeight: "700" }}>
                  {session.pendingPermissions.length} permintaan izin menunggu
                </Text>
                <Muted theme={theme}>
                  Plugin ini tidak menyetujui izin otomatis. Tinjau langsung di agen terkait.
                </Muted>
              </View>
            ) : null}
          </Card>

          <Card theme={theme}>
            <View style={styles.spread}>
              <SectionTitle theme={theme}>
                {sessionPreset.roles.reviewer} ({session.reviewers.length})
              </SectionTitle>
              <Muted theme={theme}>
                {session.coverage.completed}/{session.coverage.total} laporan terkumpul
              </Muted>
            </View>
            {session.reviewers.length === 0 ? (
              <Muted theme={theme}>
                {sessionPreset.roles.lead} belum membuat {sessionPreset.roles.reviewerPlural}.
                Ini bisa memakan waktu beberapa detik setelah sesi dimulai.
              </Muted>
            ) : (
              <View style={{ gap: 10 }}>
                {session.reviewers.map((reviewer) => (
                  <ReviewerCard
                    key={reviewer.agentId}
                    onOpenAgent={
                      navigation
                        ? () => navigation.openAgent({ agentId: reviewer.agentId })
                        : undefined
                    }
                    preset={sessionPreset}
                    reviewer={reviewer}
                    theme={theme}
                  />
                ))}
              </View>
            )}
          </Card>

          {session.phase === "complete" || session.verdict ? (
            <Card theme={theme}>
              <View style={styles.spread}>
                <SectionTitle theme={theme}>Hasil konsolidasi</SectionTitle>
                {session.verdict ? (
                  <VerdictBadge
                    preset={sessionPreset}
                    theme={theme}
                    verdict={session.verdict}
                  />
                ) : null}
              </View>
              {session.finalSummary ? (
                <BodyText theme={theme}>{session.finalSummary}</BodyText>
              ) : (
                <Muted theme={theme}>Lead belum mengirim ringkasan akhir yang terbaca.</Muted>
              )}
              {session.findings.length > 0 ? (
                <FindingsList
                  findings={session.findings}
                  preset={sessionPreset}
                  theme={theme}
                />
              ) : (
                <Muted theme={theme}>
                  Tidak ada {sessionPreset.labels.findings.toLowerCase()} pada laporan
                  konsolidasi.
                </Muted>
              )}
              {session.finalReport ? (
                <>
                  <Button
                    compact
                    label={showRawReport ? "Sembunyikan laporan lengkap" : "Lihat laporan lengkap"}
                    onPress={() => setShowRawReport((value) => !value)}
                    theme={theme}
                  />
                  {showRawReport ? (
                    <View style={styles.reportBox}>
                      <Text
                        selectable
                        style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}
                      >
                        {session.finalReport}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </Card>
          ) : null}

          {session.status !== "stopped" && session.leadAgentId ? (
            <Card theme={theme}>
              <SectionTitle theme={theme}>
                Pesan ke {sessionPreset.roles.lead.toLowerCase()}
              </SectionTitle>
              <Muted theme={theme}>
                Gunakan untuk mengarahkan ulang review, meminta fokus tambahan, atau menanyakan
                temuan. Permintaan izin tidak disetujui dari sini.
              </Muted>
              <TextInput
                accessibilityLabel={`Pesan untuk ${sessionPreset.roles.lead.toLowerCase()}`}
                editable={busy === null}
                maxLength={4000}
                multiline
                onChangeText={setDraft}
                placeholder={`Arahan untuk ${sessionPreset.roles.lead.toLowerCase()}…`}
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
                value={draft}
              />
              <View style={styles.row}>
                <Button
                  disabled={busy !== null || draft.trim().length === 0}
                  label={
                    busy === "send"
                      ? "Mengirim…"
                      : `Kirim ke ${sessionPreset.roles.lead.toLowerCase()}`
                  }
                  onPress={() => {
                    void handleSend();
                  }}
                  theme={theme}
                  variant="primary"
                />
              </View>
            </Card>
          ) : null}

          <Card theme={theme}>
            <SectionTitle theme={theme}>Aktivitas</SectionTitle>
            {session.events.length === 0 ? (
              <Muted theme={theme}>Belum ada aktivitas.</Muted>
            ) : (
              <View style={{ gap: 8 }}>
                {[...session.events]
                  .slice(-30)
                  .reverse()
                  .map((event) => (
                    <View
                      key={event.id}
                      style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}
                    >
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, width: 44 }}>
                        {formatClock(event.at)}
                      </Text>
                      <Text
                        selectable
                        style={{
                          color:
                            event.kind === "error"
                              ? theme.colors.statusDanger
                              : theme.colors.foreground,
                          fontSize: 12,
                          lineHeight: 17,
                          flexShrink: 1,
                        }}
                      >
                        {event.lens ? `${lensLabelFor(sessionPreset, event.lens)}: ` : ""}
                        {event.message}
                      </Text>
                    </View>
                  ))}
              </View>
            )}
          </Card>

          <Muted theme={theme}>
            Review berjalan read-only lewat prompt. Izin agen tetap ditinjau manual di Paseo.
            Lensa tersedia: {sessionPreset.lenses.map((lens) => lens.label).join(", ")}.
            Kedalaman: {depthFor(sessionPreset, session.depth).hint}
          </Muted>
        </>
      ) : null}
    </ScrollView>
  );
}

function PastSessionCard({
  theme,
  session,
  preset,
}: {
  theme: PluginTheme;
  session: ReviewSession;
  preset: PresetClientConfig;
}) {
  return (
    <Card theme={theme}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <SectionTitle theme={theme}>Sesi terakhir</SectionTitle>
        <PhaseBadge phase={session.phase} theme={theme} />
        {session.verdict ? (
          <VerdictBadge preset={preset} theme={theme} verdict={session.verdict} />
        ) : null}
      </View>
      <BodyText theme={theme}>{session.target}</BodyText>
      <Muted theme={theme}>
        {preset.label} · {session.workspaceName ?? session.workspaceId ?? "Workspace"} ·{" "}
        {session.coverage.completed}/{session.coverage.total} laporan ·{" "}
        {session.createdAt ? formatClock(session.createdAt) : ""}
      </Muted>
      {session.finalSummary ? <BodyText theme={theme}>{session.finalSummary}</BodyText> : null}
      {session.error ? (
        <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
          {session.error}
        </Text>
      ) : null}
    </Card>
  );
}
