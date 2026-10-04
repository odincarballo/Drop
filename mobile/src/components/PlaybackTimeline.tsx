import { useRef, useState } from 'react';
import { View, type GestureResponderEvent } from 'react-native';

type Props = {
  position: number;
  duration: number | null;
  trackColor: string;
  fillColor: string;
  onScrubStart: (seconds: number) => void;
  onScrubMove: (seconds: number) => void;
  onScrubEnd: (seconds: number) => void;
  onScrubCancel: () => void;
};

export function PlaybackTimeline({
  position,
  duration,
  trackColor,
  fillColor,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
  onScrubCancel,
}: Props) {
  const [width, setWidth] = useState(0);
  const originX = useRef<number | null>(null);
  const valid = duration != null && Number.isFinite(duration) && duration > 0;
  const bounded = valid ? Math.max(0, Math.min(duration, position)) : 0;
  const fraction = valid ? bounded / duration : 0;

  function target(event: GestureResponderEvent, starting = false) {
    if (!valid || width <= 0) return 0;
    const { pageX, locationX } = event.nativeEvent;
    if (starting && Number.isFinite(pageX) && Number.isFinite(locationX))
      originX.current = pageX - locationX;
    const localX =
      Number.isFinite(pageX) && originX.current != null
        ? pageX - originX.current
        : locationX;
    return (Math.max(0, Math.min(width, localX)) / width) * duration;
  }

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Progreso de reproducción"
      accessibilityValue={{
        min: 0,
        max: valid ? Math.round(duration) : 0,
        now: Math.round(bounded),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (!valid) return;
        onScrubEnd(
          Math.max(
            0,
            Math.min(
              duration,
              position +
                (event.nativeEvent.actionName === 'increment' ? 15 : -15),
            ),
          ),
        );
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => valid}
      onMoveShouldSetResponder={() => valid}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => onScrubStart(target(event, true))}
      onResponderMove={(event) => onScrubMove(target(event))}
      onResponderRelease={(event) => {
        const value = target(event);
        originX.current = null;
        if (valid) onScrubEnd(value);
      }}
      onResponderTerminate={() => {
        originX.current = null;
        onScrubCancel();
      }}
      style={{ height: 48, justifyContent: 'center' }}
    >
      <View
        pointerEvents="none"
        style={{ height: 4, borderRadius: 2, backgroundColor: trackColor }}
      >
        <View
          style={{
            width: `${fraction * 100}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: fillColor,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 13,
          left: Math.max(0, width * fraction - 11),
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: fillColor,
        }}
      />
    </View>
  );
}
