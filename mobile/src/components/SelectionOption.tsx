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
          backgroundColor: selected ? colors.accent : colors.surface,
          opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.copy}>
        <Text
          style={[
            styles.label,
            { color: selected ? colors.onAccent : colors.text },
          ]}
        >
          {label}
        </Text>
        {detail && (
          <Text
            style={[
              styles.detail,
              { color: selected ? colors.onAccent : colors.secondary },
            ]}
          >
            {detail}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.radio,
          { borderColor: selected ? colors.onAccent : colors.secondary },
        ]}
      >
        {selected && (
          <View style={[styles.dot, { backgroundColor: colors.onAccent }]} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { flex: 1, gap: 3 },
  label: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 12, lineHeight: 18 },
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
