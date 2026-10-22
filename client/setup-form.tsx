import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { ReviewSession, ReviewTeamState } from "../shared/contracts";
import { sessionStartRpc, toolsEnableRpc } from "../shared/contracts";
import {
  PRESET_DEPTH_IDS,
  depthFor,
  lensHintFor,
  lensLabelFor,
  type PresetDepthId,
} from "../shared/presets";
import { BodyText, Button, Card, Chip, Muted, SectionTitle } from "./components";

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
  const [presetId, setPresetId] = useState(state.defaults.presetId);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [lenses, setLenses] = useState<string[] | null>(null);
  const [depth, setDepth] = useState<PresetDepthId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset =
    state.presets.find((entry) => entry.id === presetId) ?? state.presets[0];
  const presetIsDefault = preset.id === state.defaults.presetId;

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
    const raw = lenses ?? (presetIsDefault ? state.defaults.lenses : preset.defaultLensIds);
    const allowed = new Set(preset.lenses.map((lens) => lens.id));
    return raw.filter((lens) => allowed.has(lens));
  }, [lenses, presetIsDefault, preset, state.defaults.lenses]);

  const selectedDepth = depth ?? (presetIsDefault ? state.defaults.depth : "standard");
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

  function selectPreset(nextId: string) {
    if (nextId === preset.id) return;
    setPresetId(nextId);
    setLenses(null);
    setDepth(null);
    setError(null);
  }

  function toggleLens(lens: string) {
    setLenses((current) => {
      const base = current ?? selectedLenses;
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
        presetId: preset.id,
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
          Satu agen bertindak sebagai {preset.roles.lead} dan memimpin{" "}
          {preset.roles.reviewerPlural} paralel di workspace{" "}
          <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>
            {workspace?.name ?? workspaceId}
          </Text>
          . {preset.roles.reviewer} hanya melapor ke {preset.roles.lead};{" "}
          {preset.roles.lead} yang menggabungkan temuan.
        </Muted>
        {workspace?.directory ? (
          <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {workspace.directory}
          </Text>
        ) : null}
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>Preset review</SectionTitle>
        <View style={styles.row}>
          {state.presets.map((entry) => (
            <Chip
              key={entry.id}
              disabled={busy}
              label={entry.label}
              onPress={() => selectPreset(entry.id)}
              selected={preset.id === entry.id}
              theme={theme}
            />
          ))}
        </View>
        <Muted theme={theme}>{preset.description}</Muted>
        <Muted theme={theme}>
          {preset.source === "builtin" ? "Preset bawaan" : "Preset custom"} ·{" "}
          {preset.lenses.length} lensa tersedia
        </Muted>
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>{preset.target.label}</SectionTitle>
        <Muted theme={theme}>{preset.target.hint}</Muted>
        <TextInput
          accessibilityLabel={preset.target.label}
          editable={!busy}
          maxLength={2000}
          multiline
          onChangeText={setTarget}
          placeholder={preset.target.placeholder}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          value={target}
        />
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>Lensa review</SectionTitle>
        <Muted theme={theme}>
          Setiap lensa menjadi satu {preset.roles.reviewer.toLowerCase()}. Pilih yang relevan;
          minimal satu.
        </Muted>
        <View style={styles.row}>
          {preset.lenses.map((lens) => (
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
                {lensLabelFor(preset, lens)}:{" "}
              </Text>
              {lensHintFor(preset, lens)}
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
          {PRESET_DEPTH_IDS.map((id) => (
            <Chip
              key={id}
              disabled={busy}
              label={preset.depths[id].label}
              onPress={() => setDepth(id)}
              selected={selectedDepth === id}
              theme={theme}
            />
          ))}
        </View>
        <Muted theme={theme}>{depthFor(preset, selectedDepth).hint}</Muted>
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
            {preset.roles.lead} membuat {preset.roles.reviewer.toLowerCase()} memakai alat
            agent Paseo (`create_agent`). Alat ini harus diaktifkan pada setelan daemon, dan
            berlaku untuk agen baru. Plugin ini tidak mengaktifkannya secara otomatis.
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
          label={
            busy
              ? "Memulai…"
              : `Mulai review (${selectedLenses.length} ${preset.roles.reviewer})`
          }
          onPress={() => {
            void submit();
          }}
          theme={theme}
          variant="primary"
        />
        <Muted theme={theme}>{preset.ui.startHint}</Muted>
        <Muted theme={theme}>
          Review bersifat read-only lewat instruksi prompt, bukan sandbox. {preset.roles.lead}{" "}
          dan {preset.roles.reviewer.toLowerCase()} tetap memakai izin agen masing-masing.
        </Muted>
      </View>
    </View>
  );
}

