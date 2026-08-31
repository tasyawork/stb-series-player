import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIviSeries, peekIviSeries, prefetchIviSeries } from "./ivi/serverFetch";
import type { IviSeries } from "./ivi/types";
import { PlayerScreen } from "./player/PlayerScreen";

const EXAMPLES = [
  { label: "Мало серий", q: "https://www.ivi.ru/watch/holod" },
  { label: "Много серий в сезоне", q: "https://www.ivi.ru/watch/dar" },
  {
    label: "Много сезонов",
    q: "https://www.ivi.ru/watch/selskij-detektiv-1-yablonya-razdora",
  },
];

export function App() {
  const [query, setQuery] = useState(EXAMPLES[0].q);
  const [loaded, setLoaded] = useState(EXAMPLES[0].q);
  // Подсветка чипа не ждёт сеть: выбор виден в том же кадре, что клик
  const [selected, setSelected] = useState(EXAMPLES[0].q);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<IviSeries | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // После выбора панель остаётся закрытой, пока курсор не уйдёт с неё и не вернётся
  const holdCollapsed = useRef(false);
  // Быстрые клики по чипам идут внахлёст: ответ отставшего запроса нужно выбросить
  const requestRef = useRef(0);

  const expanded = pinned || hovered || typing;

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

  function collapse() {
    holdCollapsed.current = true;
    setPinned(false);
    setHovered(false);
    inputRef.current?.blur();
  }

  useEffect(() => {
    // Прогрев остальных пресетов после первого: переключение уходит в кэш
    void load(EXAMPLES[0].q).then(() => {
      for (const item of EXAMPLES.slice(1)) void prefetchIviSeries(item.q, undefined, true);
    });
  }, [load]);

  // Ссылка на плеер должна быть стабильной, иначе memo на нём ничего не даёт
  const returnFocusToInput = useCallback(() => inputRef.current?.focus(), []);

  return (
    <div className="app-shell">
      <div
        className={`picker${expanded ? " expanded" : ""}`}
        onMouseEnter={() => {
          if (!holdCollapsed.current) setHovered(true);
        }}
        onMouseMove={() => {
          // mousemove идёт десятками событий в секунду: раскрываем панель один раз
          if (!hovered && !holdCollapsed.current) setHovered(true);
        }}
        onMouseLeave={() => {
          holdCollapsed.current = false;
          setHovered(false);
        }}
      >
        <div className="picker-plate">
        <button type="button" className="picker-toggle" onClick={() => setPinned(true)}>
          Выбрать сериал
        </button>
        <div className="picker-items">
          <div className="preset-chips">
            {EXAMPLES.map((item) => (
              <button
                key={item.q}
                type="button"
                className={`preset-chip${selected === item.q ? " active" : ""}`}
                onClick={() => {
                  setQuery(item.q);
                  // Панель не схлопываем: иначе следующий пресет можно выбрать
                  // только уведя курсор с панели и вернув обратно
                  setPinned(false);
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
              collapse();
              void load(query);
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder="Ссылка на сериал ivi.ru"
            />
            <button type="submit">{loading ? "Загрузка…" : "Смотреть"}</button>
          </form>
        </div>
        </div>
      </div>

      {error ? <div className="search-error">{error}</div> : null}

      <div className="player-stage">
        {series ? (
          <PlayerScreen key={loaded} series={series} onExit={returnFocusToInput} />
        ) : (
          /*
            До прихода меты кадр плеера уже на месте: заставки с иконкой запуска
            на первом экране нет, ожидание показывает тот же спиннер, что внутри
            плеера, поэтому загрузка выглядит одним непрерывным состоянием
          */
          <div className="player-wrap">
            {loading ? (
              <div className="player-loader" role="presentation" aria-hidden="true">
                <i className="player-spinner" />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
