import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

// The Expo view has an AVPlayerLayer bound to DropPlayback's one AVPlayer.
// No local file URI or player instance crosses this boundary.
const NativeVideoSurface: ComponentType<ViewProps> =
  requireNativeViewManager('DropPlayback');

export default NativeVideoSurface;
