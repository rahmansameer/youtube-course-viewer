"use client";

// A tiny global snackbar: any screen calls showToast(), and the <Toaster>
// mounted once in AuthGate shows it for a few seconds.
type Toast = { id: number; message: string };

let current: Toast | null = null;
let nextId = 1;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function showToast(message: string, durationMs = 4000) {
  current = { id: nextId++, message };
  if (hideTimeout) {
    clearTimeout(hideTimeout);
  }
  hideTimeout = setTimeout(() => {
    current = null;
    emit();
  }, durationMs);
  emit();
}

export function getToast() {
  return current;
}

export function subscribeToast(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
