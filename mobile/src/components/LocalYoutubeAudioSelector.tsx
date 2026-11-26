import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import type { LocalYoutubeAudioFormat } from '@/models/onDeviceYoutube';
import { useTheme } from '@/theme';

const languages: Record<string, string> = {
  af: 'afrikáans',
  am: 'amárico',
  ar: 'árabe',
  bn: 'bengalí',
  ca: 'catalán',
  cs: 'checo',
  da: 'danés',
  de: 'alemán',
  el: 'griego',
  en: 'inglés',
  es: 'español',
  eu: 'euskera',
  fa: 'persa',
  fi: 'finés',
  fil: 'filipino',
  fr: 'francés',
  gl: 'gallego',
  gu: 'guyaratí',
  he: 'hebreo',
  hi: 'hindi',
  hr: 'croata',
  hu: 'húngaro',
  id: 'indonesio',
  it: 'italiano',
  ja: 'japonés',
  kn: 'canarés',
  ko: 'coreano',
  ml: 'malayalam',
  mr: 'maratí',
  ms: 'malayo',
  nl: 'neerlandés',
  no: 'noruego',
  pa: 'punyabí',
  pl: 'polaco',
  pt: 'portugués',
  ro: 'rumano',
  ru: 'ruso',
  sk: 'eslovaco',
  sr: 'serbio',
  sv: 'sueco',
  sw: 'suajili',
  ta: 'tamil',
  te: 'telugu',
  th: 'tailandés',
  tr: 'turco',
  uk: 'ucraniano',
  ur: 'urdu',
  vi: 'vietnamita',
  yue: 'cantonés',
  zh: 'chino',
};
const qualifiers: Record<string, string> = {
  '419': 'Latinoamérica',
  ar: 'Argentina',
  au: 'Australia',
  br: 'Brasil',
  ca: 'Canadá',
  cn: 'China',
  es: 'España',
  fr: 'Francia',
  gb: 'Reino Unido',
  hk: 'Hong Kong',
  in: 'India',
  mx: 'México',
  pt: 'Portugal',
  tw: 'Taiwán',
  us: 'Estados Unidos',
  hans: 'simplificado',
  hant: 'tradicional',
  latn: 'latino',
  cyrl: 'cirílico',
};

function languageName(tag: string) {
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    try {
      const localized = new Intl.DisplayNames('es', {
        type: 'language',
        fallback: 'none',
        languageDisplay: 'standard',
      }).of(tag);
      if (localized) return localized;
    } catch {
      // Some source tags are not valid locale identifiers.
    }
  }
  const [base = '', ...parts] = tag.split('-');
  const name = languages[base] ?? 'Idioma sin identificar';
  const details = parts.map((part) => qualifiers[part]).filter(Boolean);
  return details.length ? `${name} (${details.join(', ')})` : name;
}

function audioChoices(
  options: LocalYoutubeAudioFormat[],
  selectedId: string | undefined,
  preferredId: string | null,
) {
  const groups = new Map<string, LocalYoutubeAudioFormat>();
  const priority = (track: LocalYoutubeAudioFormat) =>
    track.id === selectedId
      ? 3
      : track.isOriginal
        ? 2
        : track.id === preferredId
          ? 1
          : 0;
  const language = (track: LocalYoutubeAudioFormat) =>
    track.language?.toLowerCase() ?? '';

  for (const track of options) {
    // Bare AAC rendition itags are comparable. Keep qualified and opaque IDs
    // individually because the public catalog does not expose their identity fields.
    const tag = language(track);
    const key =
      tag &&
      tag !== 'und' &&
      /^(139|140|141)$/.test(track.id) &&
      !track.isOriginal
        ? `${tag}:${track.codec?.toLowerCase()}`
        : track.id;
    const existing = groups.get(key);
    if (
      !existing ||
      priority(track) > priority(existing) ||
      (priority(track) === priority(existing) &&
        (track.bitrateKbps ?? 0) > (existing.bitrateKbps ?? 0))
    ) {
      groups.set(key, track);
    }
  }

  const labels = [...groups.values()]
    .sort(
      (left, right) =>
        Number(Boolean(right.isOriginal)) - Number(Boolean(left.isOriginal)) ||
        Number(right.id === preferredId) - Number(left.id === preferredId),
    )
    .map((track) => ({
      id: track.id,
      label: [
        languageName(language(track)),
        track.isOriginal
          ? 'Original'
          : track.id === preferredId
            ? 'Preferida'
            : null,
        track.bitrateKbps ? `${track.bitrateKbps} kbps` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }));
  const seen = new Map<string, number>();
  return labels.map(({ id, label }) => {
    if (labels.filter((choice) => choice.label === label).length === 1)
      return { id, label };
    const variant = (seen.get(label) ?? 0) + 1;
    seen.set(label, variant);
    return { id, label: `${label} · Variante ${variant}` };
  });
}

export function LocalYoutubeAudioSelector({
  options,
  selectedId,
  preferredId,
  disabled,
  onSelect,
}: {
  options: LocalYoutubeAudioFormat[];
  selectedId?: string;
  preferredId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const choices = audioChoices(options, selectedId, preferredId);
  const selected = choices.find(({ id }) => id === selectedId);
  const value = selected?.label ?? 'Elige una pista de audio.';
  const open = expanded && !disabled;
  const border = {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pista de audio"
        accessibilityValue={{ text: value }}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setExpanded(!open)}
        style={[styles.trigger, border, disabled && styles.disabled]}
      >
        <Text style={[styles.label, { color: colors.text }]}>{value}</Text>
        <Text accessible={false} style={{ color: colors.secondary }}>
          {open ? '▴' : '▾'}
        </Text>
      </Pressable>
      {open && (
        <ScrollView
          accessibilityRole="radiogroup"
          accessibilityLabel="Pistas de audio"
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={[styles.list, border]}
        >
          {choices.map(({ id, label }) => (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selectedId === id }}
              onPress={() => {
                onSelect(id);
                setExpanded(false);
              }}
              style={styles.option}
            >
              <Text style={{ color: colors.text }}>
                {label}
                {selectedId === id ? ' ✓' : ''}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
  },
  label: { flex: 1, fontWeight: '600' },
  list: { maxHeight: 240, borderRadius: 13, borderWidth: 1 },
  option: { minHeight: 44, justifyContent: 'center', padding: 12 },
  disabled: { opacity: 0.5 },
});
