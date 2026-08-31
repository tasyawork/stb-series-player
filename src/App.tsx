import { useEffect, useRef, useState } from "react";
import { fetchIviSeries } from "./ivi/serverFetch";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<IviSeries | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // После выбора панель остаётся закрытой, пока курсор не уйдёт с неё и не вернётся
  const holdCollapsed = useRef(false);

  const expanded = pinned || hovered || typing;

  async function load(nextQuery: string) {
    setLoading(true);
    setError(null);
    try {
      setSeries(await fetchIviSeries(nextQuery, undefined, true));
      setLoaded(nextQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  function collapse() {
    holdCollapsed.current = true;
    setPinned(false);
    setHovered(false);
    inputRef.current?.blur();
  }

  useEffect(() => {
    void load(EXAMPLES[0].q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-shell">
      <div
        className={`picker${expanded ? " expanded" : ""}`}
        onMouseEnter={() => {
          if (!holdCollapsed.current) setHovered(true);
        }}
        onMouseMove={() => {
          if (!holdCollapsed.current) setHovered(true);
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
                className={`preset-chip${loaded === item.q ? " active" : ""}`}
                disabled={loading}
                onClick={() => {
                  setQuery(item.q);
                  collapse();
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
            <button type="submit" disabled={loading}>
              {loading ? "Загрузка…" : "Смотреть"}
            </button>
          </form>
        </div>
        </div>
      </div>

      {error ? <div className="search-error">{error}</div> : null}

      <div className="player-stage">
        {series ? (
          <PlayerScreen
            key={loaded}
            series={series}
            onExit={() => inputRef.current?.focus()}
          />
        ) : (
          <div className="player-placeholder">
            {loading ? "Загружаем мету из mobileapi Иви…" : "Вставьте ссылку на сериал ivi.ru"}
          </div>
        )}
      </div>
    </div>
  );
}
