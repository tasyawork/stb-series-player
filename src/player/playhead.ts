import { useSyncExternalStore } from "react";

/*
  Позиция воспроизведения тикает четыре раза в секунду. Если держать её в
  состоянии PlayerScreen, каждый тик перерисовывает весь экран: сезоны, рельсу
  серий со всеми карточками и контролы. Поэтому позиция живёт отдельно, а
  подписаны на неё только таймлайн и полоска на постере текущей серии.
*/
export type PlayheadStore = {
  get: () => number;
  set: (next: number) => void;
  update: (next: (value: number) => number) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createPlayhead(initial = 0): PlayheadStore {
  let value = initial;
  const listeners = new Set<() => void>();

  const set = (next: number) => {
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };

  return {
    get: () => value,
    set,
    update: (next) => set(next(value)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function usePlayhead(store: PlayheadStore): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
