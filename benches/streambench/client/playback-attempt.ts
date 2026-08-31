export type PlaybackAttempt = {
  id: number;
  signal: AbortSignal;
};

export function createPlaybackAttemptCoordinator() {
  let sequence = 0;
  let active: { id: number; controller: AbortController } | null = null;

  const cancel = (reason: "superseded" | "stopped" = "stopped"): void => {
    if (active && !active.controller.signal.aborted) active.controller.abort(reason);
    active = null;
  };

  return {
    begin(): PlaybackAttempt {
      cancel("superseded");
      const controller = new AbortController();
      active = { id: ++sequence, controller };
      return { id: active.id, signal: controller.signal };
    },
    cancel,
    complete(attempt: PlaybackAttempt): void {
      if (active?.id === attempt.id && active.controller.signal === attempt.signal) active = null;
    },
  };
}
