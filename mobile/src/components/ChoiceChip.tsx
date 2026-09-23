import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme';

type Props = {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
};

export function ChoiceChip({
  label,
  detail,
  selected,
  onPress,
  disabled,
}: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.accent : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: selected ? colors.onAccent : colors.text },
        ]}
      >
        {label}
        {selected ? ' ✓' : ''}
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 12, marginTop: 2 },
});
