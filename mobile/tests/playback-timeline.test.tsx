import { fireEvent, render, screen } from '@testing-library/react-native';

import { PlaybackTimeline } from '@/components/PlaybackTimeline';

function handlers() {
  return {
    start: jest.fn(),
    move: jest.fn(),
    end: jest.fn(),
    cancel: jest.fn(),
  };
}

function timeline(
  position: number,
  duration: number | null,
  callbacks: ReturnType<typeof handlers>,
) {
  return (
    <PlaybackTimeline
      position={position}
      duration={duration}
      trackColor="#ddd"
      fillColor="#111"
      onScrubStart={callbacks.start}
      onScrubMove={callbacks.move}
      onScrubEnd={callbacks.end}
      onScrubCancel={callbacks.cancel}
    />
  );
}

test('uses a finger-sized responder, stable page coordinates and one final seek', async () => {
  const callbacks = handlers();
  await render(timeline(10, 80, callbacks));
  const slider = screen.getByRole('adjustable', {
    name: 'Progreso de reproducción',
  });
  expect(slider.props.style.height).toBeGreaterThanOrEqual(44);
  expect(slider.props.onResponderTerminationRequest()).toBe(false);
  await fireEvent(slider, 'layout', {
    nativeEvent: { layout: { width: 100 } },
  });
  await fireEvent(slider, 'responderGrant', {
    nativeEvent: { pageX: 125, locationX: 25 },
  });
  await fireEvent(slider, 'responderMove', {
    nativeEvent: { pageX: 150, locationX: 4 },
  });
  expect(callbacks.start).toHaveBeenCalledWith(20);
  expect(callbacks.move).toHaveBeenCalledWith(40);
  expect(callbacks.end).not.toHaveBeenCalled();
  await fireEvent(slider, 'responderRelease', {
    nativeEvent: { pageX: 175, locationX: 5 },
  });
  expect(callbacks.end).toHaveBeenCalledTimes(1);
  expect(callbacks.end).toHaveBeenCalledWith(60);
});

test('clamps both ends, handles cancellation, and offers bounded accessibility steps', async () => {
  const callbacks = handlers();
  const rendered = await render(timeline(70, 80, callbacks));
  const slider = screen.getByRole('adjustable');
  await fireEvent(slider, 'layout', {
    nativeEvent: { layout: { width: 100 } },
  });
  await fireEvent(slider, 'responderGrant', {
    nativeEvent: { pageX: 125, locationX: 25 },
  });
  await fireEvent(slider, 'responderMove', {
    nativeEvent: { pageX: 50, locationX: -50 },
  });
  expect(callbacks.move).toHaveBeenCalledWith(0);
  await fireEvent(slider, 'responderRelease', {
    nativeEvent: { pageX: 300, locationX: 200 },
  });
  expect(callbacks.end).toHaveBeenCalledWith(80);
  await fireEvent(slider, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(callbacks.end).toHaveBeenLastCalledWith(80);
  await rendered.rerender(timeline(4, 80, callbacks));
  await fireEvent(screen.getByRole('adjustable'), 'accessibilityAction', {
    nativeEvent: { actionName: 'decrement' },
  });
  expect(callbacks.end).toHaveBeenLastCalledWith(0);
  await fireEvent(slider, 'responderTerminate');
  expect(callbacks.cancel).toHaveBeenCalledTimes(1);
});

test('unknown duration does not begin scrubbing or seek', async () => {
  const callbacks = handlers();
  await render(timeline(0, null, callbacks));
  const slider = screen.getByRole('adjustable');
  expect(slider.props.onStartShouldSetResponder()).toBe(false);
  await fireEvent(slider, 'responderRelease', {
    nativeEvent: { pageX: 50, locationX: 50 },
  });
  await fireEvent(slider, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(callbacks.end).not.toHaveBeenCalled();
});
