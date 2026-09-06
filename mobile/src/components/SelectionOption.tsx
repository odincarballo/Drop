import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

type Props = {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
};

export function SelectionOption({
  label,
  detail,
  selected,
  onPress,
  accessibilityLabel,
  disabled,
}: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      accessibilityLabel={
        accessibilityLabel ?? [label, detail].filter(Boolean).join('. ')
      }
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: selected ? colors.accent : colors.border,
          backgroundColor: selected ? colors.subtle : colors.surface,
          opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        {detail && (
          <Text style={[styles.detail, { color: colors.secondary }]}>
            {detail}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.radio,
          { borderColor: selected ? colors.accent : colors.secondary },
        ]}
      >
        {selected && (
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { flex: 1, gap: 5 },
  label: { fontSize: 16, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 20 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
