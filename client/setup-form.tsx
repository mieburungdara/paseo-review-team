import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { DEPTHS, LENSES, depthHint, lensHint, lensLabel } from "../shared/constants";
import type { ReviewSession, ReviewTeamState } from "../shared/contracts";
import { sessionStartRpc, toolsEnableRpc } from "../shared/contracts";
import { BodyText, Button, Card, Chip, Muted, SectionTitle } from "./components";

type DepthId = (typeof DEPTHS)[number]["id"];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SetupForm({
  theme,
  compact,
  workspaceId,
  state,
  onStateRefresh,
  onStarted,
}: {
  theme: PluginTheme;
  compact: boolean;
  workspaceId: string;
  state: ReviewTeamState;
  onStateRefresh: () => void;
  onStarted: (session: ReviewSession) => void;
}) {
  const workspace = useWorkspace(workspaceId, (snapshot) => ({
    name: snapshot.name,
    directory: snapshot.directory,
    title: snapshot.title,
  }));
  const startSession = useRpc(sessionStartRpc);
  const enableTools = useRpc(toolsEnableRpc);

  const [target, setTarget] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [lenses, setLenses] = useState<string[] | null>(null);
  const [depth, setDepth] = useState<DepthId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider =
    state.providers.find((entry) => entry.id === (providerId ?? state.defaults.provider)) ??
    state.providers[0] ??
    null;
  const chosenModel =
    provider?.models.find((entry) => entry.id === (modelId ?? state.defaults.model)) ??
    provider?.models.find((entry) => entry.isDefault) ??
    provider?.models[0] ??
    null;

  const selectedLenses = useMemo(() => {
    const raw = lenses ?? state.defaults.lenses;
    return raw.filter((lens) => LENSES.some((entry) => entry.id === lens));
  }, [lenses, state.defaults.lenses]);

  const selectedDepth = depth ?? state.defaults.depth;
  const trimmedTarget = target.trim();
  const canStart =
    state.agentToolsEnabled &&
    trimmedTarget.length > 0 &&
    selectedLenses.length > 0 &&
    Boolean(provider && chosenModel) &&
    !busy;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { gap: compact ? 12 : 14 },
        input: {
          minHeight: 64,
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
        row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        column: { flexDirection: "column", gap: 8 },
      }),
    [theme, compact],
  );

  function toggleLens(lens: string) {
    setLenses((current) => {
      const base = current ?? state.defaults.lenses;
      return base.includes(lens) ? base.filter((entry) => entry !== lens) : [...base, lens];
    });
  }

  async function enableAgentTools() {
    setBusy(true);
    setError(null);
    try {
      const result = await enableTools({});
      if (!result.agentTools) {
        throw new Error("Setelan agent tools belum aktif setelah disimpan. Coba lagi.");
      }
      onStateRefresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!provider || !chosenModel || !canStart) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startSession({
        workspaceId,
        target: trimmedTarget,
        lenses: selectedLenses,
        depth: selectedDepth,
        providerId: provider.id,
        modelId: chosenModel.id,
      });
      onStarted(result.session);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Card theme={theme}>
        <SectionTitle theme={theme}>Mulai review tim</SectionTitle>
        <Muted theme={theme}>
          Satu agen lead memimpin beberapa reviewer paralel di workspace{" "}
          <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>
            {workspace?.name ?? workspaceId}
          </Text>
          . Reviewer hanya melapor ke lead; lead yang menggabungkan temuan.
        </Muted>
        {workspace?.directory ? (
          <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {workspace.directory}
          </Text>
        ) : null}
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>Target review</SectionTitle>
        <Muted theme={theme}>
          Jelaskan apa yang harus diperiksa. Sebutkan diff, branch, PR, atau area kode yang
          relevan agar reviewer tidak menebak.
        </Muted>
        <TextInput
          accessibilityLabel="Target review"
          editable={!busy}
          maxLength={2000}
          multiline
          onChangeText={setTarget}
          placeholder="mis. diff vs main, src/auth/login, atau PR #42"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          value={target}
        />
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>Lensa reviewer</SectionTitle>
        <Muted theme={theme}>
          Setiap lensa menjadi satu reviewer. Pilih yang relevan; minimal satu.
        </Muted>
        <View style={styles.row}>
          {LENSES.map((lens) => (
            <Chip
              key={lens.id}
              disabled={busy}
              label={lens.label}
              onPress={() => toggleLens(lens.id)}
              selected={selectedLenses.includes(lens.id)}
              theme={theme}
            />
          ))}
        </View>
        <View style={styles.column}>
          {selectedLenses.map((lens) => (
            <Muted key={lens} theme={theme}>
              <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
                {lensLabel(lens)}:{" "}
              </Text>
              {lensHint(lens)}
            </Muted>
          ))}
        </View>
        {selectedLenses.length === 0 ? (
          <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
            Pilih minimal satu lensa.
          </Text>
        ) : null}
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>Kedalaman</SectionTitle>
        <View style={styles.row}>
          {DEPTHS.map((entry) => (
            <Chip
              key={entry.id}
              disabled={busy}
              label={entry.label}
              onPress={() => setDepth(entry.id)}
              selected={selectedDepth === entry.id}
              theme={theme}
            />
          ))}
        </View>
        <Muted theme={theme}>{depthHint(selectedDepth)}</Muted>
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>Provider</SectionTitle>
        {state.providers.length === 0 ? (
          <Muted theme={theme}>
            Tidak ada provider yang terbaca. Periksa koneksi daemon lalu muat ulang state.
          </Muted>
        ) : (
          <>
            <View style={styles.row}>
              {state.providers.map((entry) => (
                <Chip
                  key={entry.id}
                  disabled={busy}
                  label={entry.label || entry.id}
                  onPress={() => {
                    setProviderId(entry.id);
                    setModelId(null);
                  }}
                  selected={provider?.id === entry.id}
                  theme={theme}
                />
              ))}
            </View>
            {provider ? (
              <View style={styles.column}>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" }}>
                  MODEL
                </Text>
                <View style={styles.row}>
                  {provider.models.map((model) => (
                    <Chip
                      key={model.id}
                      disabled={busy}
                      label={model.label || model.id}
                      onPress={() => setModelId(model.id)}
                      selected={chosenModel?.id === model.id}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </Card>

      {!state.agentToolsEnabled ? (
        <Card theme={theme} style={{ borderColor: theme.colors.statusWarning }}>
          <SectionTitle theme={theme}>Izin agent tools diperlukan</SectionTitle>
          <BodyText theme={theme}>
            Lead membuat reviewer memakai alat agent Paseo (`create_agent`). Alat ini harus
            diaktifkan pada setelan daemon, dan berlaku untuk agen baru. Plugin ini tidak
            mengaktifkannya secara otomatis.
          </BodyText>
          <Muted theme={theme}>
            Dengan menekan tombol di bawah, kamu mengizinkan plugin mengubah setelan
            `mcp.injectIntoAgents` menjadi aktif. Tidak ada izin agen yang disetujui otomatis.
          </Muted>
          <Button
            disabled={busy}
            label={busy ? "Mengaktifkan…" : "Aktifkan agent tools"}
            onPress={() => {
              void enableAgentTools();
            }}
            theme={theme}
            variant="primary"
          />
        </Card>
      ) : null}

      {error ? (
        <Card theme={theme} style={{ borderColor: theme.colors.statusDanger }}>
          <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
            {error}
          </Text>
        </Card>
      ) : null}

      <View style={styles.column}>
        <Button
          disabled={!canStart}
          label={busy ? "Memulai…" : `Mulai review (${selectedLenses.length} reviewer)`}
          onPress={() => {
            void submit();
          }}
          theme={theme}
          variant="primary"
        />
        <Muted theme={theme}>
          Review bersifat read-only lewat instruksi prompt, bukan sandbox. Lead dan reviewer
          tetap memakai izin agen masing-masing.
        </Muted>
      </View>
    </View>
  );
}

