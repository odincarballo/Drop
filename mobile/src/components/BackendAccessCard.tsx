import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { getApiToken, saveApiToken } from '@/services/token';
import { useTheme } from '@/theme';
import { ActionButton } from './ActionButton';

type State =
  | { status: 'loading' }
  | { status: 'ready'; configured: boolean; editing: boolean }
  | { status: 'error'; message: string };

export function BackendAccessCard() {
  const { colors } = useTheme();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [token, setToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void getApiToken()
      .then((saved) => {
        if (mounted.current)
          setState({ status: 'ready', configured: !!saved, editing: !saved });
      })
      .catch(() => {
        if (mounted.current)
          setState({
            status: 'error',
            message: 'No se pudo acceder al almacenamiento seguro.',
          });
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveApiToken(token);
      if (mounted.current) {
        setToken('');
        setState({ status: 'ready', configured: true, editing: false });
      }
    } catch (error) {
      if (mounted.current)
        setState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'No se pudo guardar el token de forma segura.',
        });
    } finally {
      if (mounted.current) setIsSaving(false);
    }
  }

  const isEditing =
    state.status === 'error' || (state.status === 'ready' && state.editing);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.title, { color: colors.text }]}>Acceso privado</Text>
      {state.status === 'loading' && (
        <Text style={[styles.detail, { color: colors.secondary }]}>
          Comprobando…
        </Text>
      )}
      {state.status === 'ready' && state.configured && !state.editing && (
        <>
          <Text style={[styles.detail, { color: colors.success }]}>
            Token guardado de forma segura
          </Text>
          <ActionButton
            label="Cambiar token"
            secondary
            onPress={() =>
              setState({ status: 'ready', configured: true, editing: true })
            }
          />
        </>
      )}
      {isEditing && (
        <>
          <TextInput
            accessibilityLabel="Token de acceso del backend"
            placeholder="Pega el token privado"
            placeholderTextColor={colors.secondary}
            selectionColor={colors.accent}
            value={token}
            onChangeText={(value) => {
              setToken(value);
              if (state.status === 'error')
                setState({ status: 'ready', configured: false, editing: true });
            }}
            editable={!isSaving}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            maxLength={512}
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          />
          {state.status === 'error' && (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: colors.error }]}
            >
              {state.message}
            </Text>
          )}
          <ActionButton
            label={isSaving ? 'Guardando…' : 'Guardar token'}
            loading={isSaving}
            disabled={isSaving || token.trim().length < 32}
            onPress={() => void save()}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  title: { fontSize: 16, fontWeight: '700' },
  detail: { fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  error: { fontSize: 13, lineHeight: 19 },
});
