import { useEffect, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from '@/components/MiniPlayer';
import { useTheme } from '@/theme';

// Expo Router owns the routes/history; this is shared presentation only.
export function MainNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const primary =
    pathname === '/' || pathname === '/library' || pathname === '/download';
  const librarySelected = pathname === '/' || pathname === '/library';
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View
      testID="app-footer"
      style={{
        display: keyboardVisible ? 'none' : 'flex',
        backgroundColor: colors.surface,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <MiniPlayer aboveNavigation={primary} />
      {primary && (
        <View
          accessibilityRole="tablist"
          accessibilityLabel="Navegación principal"
          testID="main-navigation"
          style={[
            styles.bar,
            {
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          {(
            [
              {
                label: 'Biblioteca',
                href: '/library',
                selected: librarySelected,
                icon: 'books.vertical',
              },
              {
                label: 'Descargar',
                href: '/download',
                selected: !librarySelected,
                icon: 'arrow.down.circle',
              },
            ] as const
          ).map(({ label, href, selected, icon }) => (
            <Pressable
              key={href}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => {
                if (!selected) {
                  Keyboard.dismiss();
                  router.replace(href as Href);
                }
              }}
              style={styles.tab}
            >
              <SymbolView
                name={icon}
                type="monochrome"
                size={22}
                tintColor={selected ? colors.accent : colors.secondary}
              />
              <Text
                numberOfLines={1}
                style={{
                  color: selected ? colors.accent : colors.secondary,
                  fontSize: 14,
                  fontWeight: selected ? '700' : '500',
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
});
