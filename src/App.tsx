import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchIviFilm,
  fetchIviSeries,
  peekIviSeries,
  prefetchIviSeries,
} from "./ivi/serverFetch";
import type { IviSeries } from "./ivi/types";
import { PlayerScreen } from "./player/PlayerScreen";

// Вкладка «Фильм» показывает один конкретный фильм с его же рекомендациями
const FILM_URL = "https://www.ivi.ru/watch/642536";

const EXAMPLES = [
  { label: "Мало серий", q: "https://www.ivi.ru/watch/holod" },
  { label: "Много серий в сезоне", q: "https://www.ivi.ru/watch/dar" },
  {
    label: "Много сезонов",
    q: "https://www.ivi.ru/watch/selskij-detektiv-1-yablonya-razdora",
  },
  // Платный тайтл: без демо-видео рендерится «глазами» без подписки —
  // первая серия открыта, остальные под замком, вся платная логика видна
  { label: "Платный", q: "https://www.ivi.ru/watch/dva-holma" },
];

type Mode = "plain" | "recom";
// Правый переключатель: сериал (текущий прототип) или фильм (две галереи)
type Content = "series" | "film";

export function App() {
  const [query, setQuery] = useState(EXAMPLES[0].q);
  const [loaded, setLoaded] = useState(EXAMPLES[0].q);
  // Вкладка прототипа: «Без рекома» / «С рекомом». Пока обе показывают один плеер
  const [mode, setMode] = useState<Mode>("plain");
  // Тип контента: «Сериал» / «Фильм». В фильме вместо серий — две галереи
  const [content, setContent] = useState<Content>("series");
  // Фильм для вкладки «Фильм» грузится один раз и отдельно от сериала-пресета
  const [film, setFilm] = useState<IviSeries | null>(null);
  // Подсветка чипа не ждёт сеть: выбор виден в том же кадре, что клик
  const [selected, setSelected] = useState(EXAMPLES[0].q);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<IviSeries | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Быстрые клики по чипам идут внахлёст: ответ отставшего запроса нужно выбросить
  const requestRef = useRef(0);

  const load = useCallback(async (nextQuery: string) => {
    const token = (requestRef.current += 1);
    setSelected(nextQuery);
    const cached = peekIviSeries(nextQuery, undefined, true);
    if (cached) {
      // Закэшированный сериал показываем сразу, не подвешивая клик на сеть
      setSeries(cached.series);
      setLoaded(nextQuery);
      setError(null);
      setLoading(false);
      if (!cached.stale) return;
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const fresh = await fetchIviSeries(nextQuery, undefined, true);
      if (token !== requestRef.current) return;
      setSeries(fresh);
      setLoaded(nextQuery);
    } catch (err) {
      if (token !== requestRef.current) return;
      // Ревалидация упала, а на экране есть рабочие данные: молчим
      if (!cached) setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Прогрев остальных пресетов после первого: переключение уходит в кэш
    void load(EXAMPLES[0].q).then(() => {
      for (const item of EXAMPLES.slice(1)) void prefetchIviSeries(item.q, undefined, true);
    });
  }, [load]);

  // Фильм грузим лениво — при первом переходе на вкладку «Фильм»
  useEffect(() => {
    if (content !== "film" || film) return;
    let cancelled = false;
    void fetchIviFilm(FILM_URL).then(
      (loaded) => {
        if (!cancelled) setFilm(loaded);
      },
      () => {
        // Фильм не загрузился — вкладка просто останется на спиннере
      },
    );
    return () => {
      cancelled = true;
    };
  }, [content, film]);

  // Ссылка на плеер должна быть стабильной, иначе memo на нём ничего не даёт
  const returnFocusToInput = useCallback(() => inputRef.current?.focus(), []);

  // Какой контент отдать плееру: сериал-пресет или загруженный фильм
  const shown = content === "film" ? film : series;

  return (
    <div className="app-shell">
      {/*
        Верхняя панель всегда раскрыта (не сворачивается). В фильме она невидима,
        но место под неё остаётся — иначе плеер и кнопки (спозиционированы
        относительно .player-region) прыгали бы вверх при переключении.
      */}
      <div className={`picker expanded${content === "film" ? " picker-hidden" : ""}`}>
          <div className="picker-plate">
            <div className="picker-items">
              <div className="preset-chips">
                {EXAMPLES.map((item) => (
                  <button
                    key={item.q}
                    type="button"
                    className={`preset-chip${selected === item.q ? " active" : ""}`}
                    onClick={() => {
                      setQuery(item.q);
                      void load(item.q);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <form
                className="link-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  inputRef.current?.blur();
                  void load(query);
                }}
              >
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ссылка на сериал ivi.ru"
                />
                <button type="submit">{loading ? "Загрузка…" : "Смотреть"}</button>
              </form>
            </div>
          </div>
      </div>

      {error ? <div className="search-error">{error}</div> : null}

      <div className="player-region">
        {/* Реком-настройка есть только у сериала — в фильме её не показываем */}
        {content === "series" ? (
          <div className="mode-switch" role="group" aria-label="Вариант прототипа">
            <button
              type="button"
              className={`mode-btn${mode === "plain" ? " active" : ""}`}
              aria-pressed={mode === "plain"}
              onClick={() => setMode("plain")}
            >
              Без рекома
            </button>
            <button
              type="button"
              className={`mode-btn${mode === "recom" ? " active" : ""}`}
              aria-pressed={mode === "recom"}
              onClick={() => setMode("recom")}
            >
              С рекомом
            </button>
          </div>
        ) : null}

        <div className="content-switch" role="group" aria-label="Тип контента">
          <button
            type="button"
            className={`mode-btn${content === "series" ? " active" : ""}`}
            aria-pressed={content === "series"}
            onClick={() => setContent("series")}
          >
            Сериал
          </button>
          <button
            type="button"
            className={`mode-btn${content === "film" ? " active" : ""}`}
            aria-pressed={content === "film"}
            onClick={() => setContent("film")}
          >
            Фильм
          </button>
        </div>

        <div className="player-stage">
        {shown ? (
          <PlayerScreen
            key={`${content === "film" ? FILM_URL : loaded}::${mode}::${content}`}
            variant={mode}
            content={content}
            series={shown}
            onExit={returnFocusToInput}
          />
        ) : (
          /*
            До прихода меты кадр плеера уже на месте: заставки с иконкой запуска
            на первом экране нет, ожидание показывает тот же спиннер, что внутри
            плеера, поэтому загрузка выглядит одним непрерывным состоянием
          */
          <div className="player-wrap">
            {loading || (content === "film" && !film) ? (
              <div className="player-loader" role="presentation" aria-hidden="true">
                <i className="player-spinner" />
              </div>
            ) : null}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
