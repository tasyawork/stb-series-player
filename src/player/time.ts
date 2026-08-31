export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
}

export function formatMinutes(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} мин`;
}
