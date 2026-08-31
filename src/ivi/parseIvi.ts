const IVI_ORIGIN = "https://www.ivi.ru";

export function parseIviQuery(q: string): { slug: string; url: string } {
  const trimmed = q.trim();
  const urlMatch = trimmed.match(/ivi\.ru\/watch\/([A-Za-z0-9_-]+)/i);
  if (urlMatch) {
    const slug = urlMatch[1];
    return { slug, url: `${IVI_ORIGIN}/watch/${slug}` };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error("Нужна ссылка вида https://www.ivi.ru/watch/...");
  }
  const slug = slugify(trimmed);
  if (!slug) {
    throw new Error("Введите название, slug или ссылку на сериал Иви");
  }
  return { slug, url: `${IVI_ORIGIN}/watch/${slug}` };
}

function slugify(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
    ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "",
    ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return input
    .trim()
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
