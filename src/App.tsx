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
// Вкладка «Дети» — мультсериал «Три кота» (обычный сериал, все три режима)
const KIDS_URL = "https://www.ivi.ru/watch/tri-kota";

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

// recom → «Горизонталь», vertical → «Вертикаль 1» (табы сверху, непрерывная лента),
// vertical2 → «Вертикаль 2» (табы слева, посезонно, вертикальный скролл)
// split → «Раздельный» (пока рендерится так же, как vertical/«Сквозной», доделаем позже)
// Сейчас в UI показаны только «Сквозной» (vertical) и «Раздельный» (split);
// остальные режимы скрыты, но оставлены в коде.
type Mode = "plain" | "recom" | "vertical" | "vertical2" | "split";
// Левый переключатель контента: сериал / фильм (две галереи) / дети (мультсериал)
type Content = "series" | "film" | "kids";

export function App() {
  const [query, setQuery] = useState(EXAMPLES[0].q);
  const [loaded, setLoaded] = useState(EXAMPLES[0].q);
  // Вкладка прототипа. По умолчанию «Сквозной» (vertical), т.к. остальные
  // режимы сейчас скрыты в UI.
  const [mode, setMode] = useState<Mode>("vertical");
  // Тип контента: «Сериал» / «Фильм». В фильме вместо серий — две галереи
  const [content, setContent] = useState<Content>("series");
  // Раскладка фильма: «Горизонталь» (две ленты) / «Вертикаль» (вторая галерея сеткой вниз)
  const [filmVertical, setFilmVertical] = useState(false);
  // Фильм для вкладки «Фильм» грузится один раз и отдельно от сериала-пресета
  const [film, setFilm] = useState<IviSeries | null>(null);
  // Детский мультсериал «Три кота» — грузится лениво при первом заходе на вкладку
  const [kids, setKids] = useState<IviSeries | null>(null);
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

  // «Три кота» грузим лениво — при первом переходе на вкладку «Дети»
  useEffect(() => {
    if (content !== "kids" || kids) return;
    let cancelled = false;
    void fetchIviSeries(KIDS_URL, undefined, true).then(
      (loaded) => {
        if (!cancelled) setKids(loaded);
      },
      () => {
        // Не загрузился — вкладка просто останется на спиннере
      },
    );
    return () => {
      cancelled = true;
    };
  }, [content, kids]);

  // Ссылка на плеер должна быть стабильной, иначе memo на нём ничего не даёт
  const returnFocusToInput = useCallback(() => inputRef.current?.focus(), []);

  // Какой контент отдать плееру: сериал-пресет, фильм или детский мультсериал
  const shown = content === "film" ? film : content === "kids" ? kids : series;

  return (
    <div className="app-shell">
      {/*
        Верхняя панель всегда раскрыта (не сворачивается). В фильме она невидима,
        но место под неё остаётся — иначе плеер и кнопки (спозиционированы
        относительно .player-region) прыгали бы вверх при переключении.
      */}
      <div className={`picker expanded${content !== "series" ? " picker-hidden" : ""}`}>
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
        {/* Три режима — у сериала и у детей; у фильма свой переключатель раскладки */}
        {content !== "film" ? (
          <div className="mode-switch" role="group" aria-label="Вариант прототипа">
            {/*
              Скрытые режимы (оставлены в коде на будущее):
              «Горизонталь» (recom) и «Вертикаль 2» (vertical2).
              Сейчас показываем только «Сквозной» и «Раздельный».
            */}
            <button
              type="button"
              className={`mode-btn${mode === "vertical" ? " active" : ""}`}
              aria-pressed={mode === "vertical"}
              onClick={() => setMode("vertical")}
            >
              Сквозной
            </button>
            <button
              type="button"
              className={`mode-btn${mode === "split" ? " active" : ""}`}
              aria-pressed={mode === "split"}
              onClick={() => setMode("split")}
            >
              Раздельный
            </button>
          </div>
        ) : (
          <div className="mode-switch" role="group" aria-label="Раскладка фильма">
            <button
              type="button"
              className={`mode-btn${!filmVertical ? " active" : ""}`}
              aria-pressed={!filmVertical}
              onClick={() => setFilmVertical(false)}
            >
              Горизонталь
            </button>
            <button
              type="button"
              className={`mode-btn${filmVertical ? " active" : ""}`}
              aria-pressed={filmVertical}
              onClick={() => setFilmVertical(true)}
            >
              Вертикаль
            </button>
          </div>
        )}

        <div className="content-switch" role="group" aria-label="Тип контента">
          {/*
            Табы «Фильм» и «Дети» скрыты (оставлены в коде на будущее).
            Сейчас доступен только «Сериал».
          */}
          <button
            type="button"
            className={`mode-btn${content === "series" ? " active" : ""}`}
            aria-pressed={content === "series"}
            onClick={() => setContent("series")}
          >
            Сериал
          </button>
        </div>

        <div className="player-stage">
        {shown ? (
          <PlayerScreen
            key={`${
              content === "film" ? FILM_URL : content === "kids" ? KIDS_URL : loaded
            }::${mode}::${content}::${filmVertical ? "v" : "h"}`}
            variant={mode}
            /* «Дети» — это обычный сериал: раскладка серий и те же три режима */
            content={content === "kids" ? "series" : content}
            filmVertical={content === "film" && filmVertical}
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
            {loading || (content === "film" && !film) || (content === "kids" && !kids) ? (
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
