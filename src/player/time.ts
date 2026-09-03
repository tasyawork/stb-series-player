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

// Длительность в мете: часы и минуты, как в макете («2 ч 14 мин», «47 мин»)
export function formatDuration(seconds: number): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  return `${m} мин`;
}
