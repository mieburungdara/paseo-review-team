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
  translatorLabelFor,
  translatorPluralFor,
  type PresetDepthId,
} from "../shared/presets";
import {
  OUTPUT_EXTENSION_OPTIONS,
  isSafeRelativePath,
  normalizeOutputExtension,
  normalizeRelativePath,
} from "../shared/translation";
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
  const [outputDir, setOutputDir] = useState(() => {
    const initial = state.presets.find((entry) => entry.id === state.defaults.presetId) ??
      state.presets[0];
    if (!initial || initial.task !== "translate") return "";
    const saved = initial.id === state.defaults.presetId ? state.defaults.outputDir : null;
    return saved ?? initial.translation?.defaultOutputDir ?? "";
  });
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string | null>(null);
  const [thinkingOptionId, setThinkingOptionId] = useState<string | null>(null);
  const [outputExtension, setOutputExtension] = useState<string | null>(null);
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

  const providerIsDefault = provider?.id === state.defaults.provider;
  const defaultMode = provider
    ? (provider.modes.find((entry) => entry.id === provider.defaultModeId) ??
      provider.modes[0] ??
      null)
    : null;
  const savedMode =
    providerIsDefault && state.defaults.modeId
      ? provider?.modes.find((entry) => entry.id === state.defaults.modeId)
      : undefined;
  const chosenMode =
    (modeId ? provider?.modes.find((entry) => entry.id === modeId) : undefined) ??
    savedMode ??
    defaultMode;

  const modelIsDefault = providerIsDefault && chosenModel?.id === state.defaults.model;
  const defaultThinking = chosenModel
    ? (chosenModel.thinkingOptions.find(
        (entry) => entry.id === chosenModel.defaultThinkingOptionId,
      ) ??
      chosenModel.thinkingOptions[0] ??
      null)
    : null;
  const savedThinking =
    modelIsDefault && state.defaults.thinkingOptionId
      ? chosenModel?.thinkingOptions.find(
          (entry) => entry.id === state.defaults.thinkingOptionId,
        )
      : undefined;
  const chosenThinking =
    (thinkingOptionId
      ? chosenModel?.thinkingOptions.find((entry) => entry.id === thinkingOptionId)
      : undefined) ??
    savedThinking ??
    defaultThinking;

  const presetExtension =
    normalizeOutputExtension(preset.translation?.outputExtension) ?? ".txt";
  const savedExtension = presetIsDefault
    ? normalizeOutputExtension(state.defaults.outputExtension)
    : null;
  const selectedExtension =
    normalizeOutputExtension(outputExtension) ?? savedExtension ?? presetExtension;
  const extensionOptions = Array.from(
    new Set([...OUTPUT_EXTENSION_OPTIONS, presetExtension]),
  );

  const selectedLenses = useMemo(() => {
    const raw = lenses ?? (presetIsDefault ? state.defaults.lenses : preset.defaultLensIds);
    const allowed = new Set(preset.lenses.map((lens) => lens.id));
    return raw.filter((lens) => allowed.has(lens));
  }, [lenses, presetIsDefault, preset, state.defaults.lenses]);

  const selectedDepth = depth ?? (presetIsDefault ? state.defaults.depth : "standard");
  const trimmedTarget = target.trim();
  const isTranslation = preset.task === "translate";
  const trimmedOutputDir = outputDir.trim();
  const outputDirSafe = !isTranslation || isSafeRelativePath(trimmedOutputDir);
  const canStart =
    state.agentToolsEnabled &&
    trimmedTarget.length > 0 &&
    selectedLenses.length > 0 &&
    Boolean(provider && chosenModel) &&
    (!isTranslation ||
      (Boolean(workspace?.directory) &&
        trimmedOutputDir.length > 0 &&
        outputDirSafe)) &&
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
        singleInput: {
          minHeight: 44,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
          color: theme.colors.foreground,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 13,
        },
        row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        column: { flexDirection: "column", gap: 8 },
      }),
    [theme, compact],
  );

  function selectPreset(nextId: string) {
    if (nextId === preset.id) return;
    const next = state.presets.find((entry) => entry.id === nextId);
    setPresetId(nextId);
    setLenses(null);
    setDepth(null);
    setOutputExtension(null);
    setError(null);
    if (next?.task === "translate") {
      const saved = next.id === state.defaults.presetId ? state.defaults.outputDir : null;
      setOutputDir(saved ?? next.translation?.defaultOutputDir ?? "");
    } else {
      setOutputDir("");
    }
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
        modeId: chosenMode?.id ?? null,
        thinkingOptionId: chosenThinking?.id ?? null,
        ...(isTranslation
          ? {
              outputDir: trimmedOutputDir,
              outputExtension: selectedExtension,
            }
          : {}),
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
        <SectionTitle theme={theme}>
          {isTranslation ? "Mulai terjemahan tim" : "Mulai review tim"}
        </SectionTitle>
        <Muted theme={theme}>
          {isTranslation ? (
            <>
              Satu agen bertindak sebagai {preset.roles.lead} dan membuat{" "}
              {translatorPluralFor(preset)} per{" "}
              {preset.translation?.unitLabel.toLowerCase() ?? "unit"} di workspace{" "}
              <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>
                {workspace?.name ?? workspaceId}
              </Text>
              . Setelah semua unit terminal, {preset.roles.lead} membuat{" "}
              {preset.roles.reviewerPlural} read-only untuk memeriksa hasil.
            </>
          ) : (
            <>
              Satu agen bertindak sebagai {preset.roles.lead} dan memimpin{" "}
              {preset.roles.reviewerPlural} paralel di workspace{" "}
              <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>
                {workspace?.name ?? workspaceId}
              </Text>
              . {preset.roles.reviewer} hanya melapor ke {preset.roles.lead};{" "}
              {preset.roles.lead} yang menggabungkan temuan.
            </>
          )}
        </Muted>
        {workspace?.directory ? (
          <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {workspace.directory}
          </Text>
        ) : null}
      </Card>

      <Card theme={theme}>
        <SectionTitle theme={theme}>Preset</SectionTitle>
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

      {isTranslation && preset.translation ? (
        <Card theme={theme}>
          <SectionTitle theme={theme}>Folder hasil</SectionTitle>
          <Muted theme={theme}>
            Path relatif terhadap root workspace. {translatorLabelFor(preset)} menulis berkas{" "}
            {selectedExtension} di folder ini. Plugin tidak membuat folder atau menulis berkas.
          </Muted>
          <TextInput
            accessibilityLabel="Folder hasil terjemahan"
            editable={!busy}
            maxLength={300}
            onChangeText={setOutputDir}
            placeholder={preset.translation.defaultOutputDir}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.singleInput}
            value={outputDir}
          />
          <View style={styles.column}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" }}>
              FORMAT BERKAS
            </Text>
            <View style={styles.row}>
              {extensionOptions.map((extension) => (
                <Chip
                  key={extension}
                  disabled={busy}
                  label={extension}
                  onPress={() => setOutputExtension(extension)}
                  selected={selectedExtension === extension}
                  theme={theme}
                />
              ))}
            </View>
            <Muted theme={theme}>
              Format diterapkan ke semua penerjemah dan peninjau QA pada sesi ini. Default mengikuti
              preset; pilihan terakhir disimpan untuk sesi berikutnya.
            </Muted>
          </View>
          {workspace?.directory ? (
            trimmedOutputDir.length > 0 && outputDirSafe ? (
              <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                {workspace.directory}/{normalizeRelativePath(trimmedOutputDir)}
              </Text>
            ) : null
          ) : (
            <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
              Workspace ini tidak punya folder lokal di daemon. Terjemahan membutuhkan workspace
              dengan folder nyata.
            </Text>
          )}
          {trimmedOutputDir.length > 0 && !outputDirSafe ? (
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
              Folder hasil harus path relatif yang aman: tanpa drive, tanpa awalan /, tanpa "..",
              dan tidak boleh folder root workspace.
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card theme={theme}>
        <SectionTitle theme={theme}>{isTranslation ? "Lensa QA" : "Lensa review"}</SectionTitle>
        <Muted theme={theme}>
          {isTranslation
            ? `Setiap lensa menjadi satu ${preset.roles.reviewer.toLowerCase()}. QA berjalan setelah semua unit terjemahan terminal. Pilih minimal satu.`
            : `Setiap lensa menjadi satu ${preset.roles.reviewer.toLowerCase()}. Pilih yang relevan; minimal satu.`}
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
                    setModeId(null);
                    setThinkingOptionId(null);
                  }}
                  selected={provider?.id === entry.id}
                  theme={theme}
                />
              ))}
            </View>
            {provider ? (
              <>
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
                        onPress={() => {
                          setModelId(model.id);
                          setThinkingOptionId(null);
                        }}
                        selected={chosenModel?.id === model.id}
                        theme={theme}
                      />
                    ))}
                  </View>
                </View>

                <View style={styles.column}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" }}>
                    MODE
                  </Text>
                  {provider.modes.length === 0 ? (
                    <Muted theme={theme}>
                      Provider ini tidak menyediakan pilihan mode; Paseo memakai bawaan provider.
                    </Muted>
                  ) : (
                    <>
                      <View style={styles.row}>
                        {provider.modes.map((mode) => (
                          <Chip
                            key={mode.id}
                            disabled={busy}
                            label={mode.label || mode.id}
                            onPress={() => setModeId(mode.id)}
                            selected={chosenMode?.id === mode.id}
                            theme={theme}
                          />
                        ))}
                      </View>
                      {chosenMode?.description ? (
                        <Muted theme={theme}>{chosenMode.description}</Muted>
                      ) : null}
                    </>
                  )}
                </View>

                <View style={styles.column}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" }}>
                    THINKING LEVEL
                  </Text>
                  {chosenModel && chosenModel.thinkingOptions.length > 0 ? (
                    <>
                      <View style={styles.row}>
                        {chosenModel.thinkingOptions.map((option) => (
                          <Chip
                            key={option.id}
                            disabled={busy}
                            label={option.label || option.id}
                            onPress={() => setThinkingOptionId(option.id)}
                            selected={chosenThinking?.id === option.id}
                            theme={theme}
                          />
                        ))}
                      </View>
                      {chosenThinking?.description ? (
                        <Muted theme={theme}>{chosenThinking.description}</Muted>
                      ) : null}
                    </>
                  ) : (
                    <Muted theme={theme}>
                      Model ini tidak menyediakan pilihan thinking level.
                    </Muted>
                  )}
                </View>

                <Muted theme={theme}>
                  Mode dan thinking level dipakai untuk {preset.roles.lead.toLowerCase()} dan semua
                  agen anak (
                  {isTranslation
                    ? `${translatorPluralFor(preset)} dan ${preset.roles.reviewerPlural}`
                    : preset.roles.reviewerPlural}
                  ).
                </Muted>
              </>
            ) : null}
          </>
        )}
      </Card>

      {!state.agentToolsEnabled ? (
        <Card theme={theme} style={{ borderColor: theme.colors.statusWarning }}>
          <SectionTitle theme={theme}>Izin agent tools diperlukan</SectionTitle>
          <BodyText theme={theme}>
            {preset.roles.lead} membuat{" "}
            {isTranslation
              ? `${translatorPluralFor(preset)} dan ${preset.roles.reviewerPlural}`
              : preset.roles.reviewer.toLowerCase()}{" "}
            memakai alat agent Paseo (`create_agent`). Alat ini harus diaktifkan pada setelan
            daemon, dan berlaku untuk agen baru. Plugin ini tidak mengaktifkannya secara otomatis.
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

      {isTranslation ? (
        <Card theme={theme} style={{ borderColor: theme.colors.statusWarning }}>
          <SectionTitle theme={theme}>Mode menulis</SectionTitle>
          <BodyText theme={theme}>
            {translatorPluralFor(preset)} menulis dan dapat menimpa berkas di folder hasil.
            Plugin tidak menulis berkas, tidak membuat folder, dan tidak menyetujui izin otomatis.
            Ini bukan sandbox: izin tulis tetap memakai izin agen masing-masing dan ditinjau
            manual di Paseo.
          </BodyText>
          <Muted theme={theme}>
            Batas bawaan: {preset.translation?.maxUnitsPerSession ?? 20}{" "}
            {preset.translation?.unitLabel.toLowerCase() ?? "unit"} per sesi dan{" "}
            {preset.translation?.maxConcurrentTranslators ?? 5} penerjemah aktif. Untuk novel
            panjang, jalankan beberapa sesi per rentang.
          </Muted>
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
              : isTranslation
                ? `Mulai terjemahan (${selectedLenses.length} lensa QA)`
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
          {isTranslation
            ? `Penerjemah menulis hanya ke folder hasil lewat instruksi prompt, bukan sandbox. ${preset.roles.lead}, ${preset.roles.reviewer.toLowerCase()}, dan penerjemah tetap memakai izin agen masing-masing.`
            : `Review bersifat read-only lewat instruksi prompt, bukan sandbox. ${preset.roles.lead} dan ${preset.roles.reviewer.toLowerCase()} tetap memakai izin agen masing-masing.`}
        </Muted>
      </View>
    </View>
  );
}

