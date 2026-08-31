type NotifyButtonProps = {
  active: boolean;
  focused: boolean;
};

/** Button_STB из Figma 1299:10310: Default — прозрачный, Active — заливка */
export function NotifyButton({ active, focused }: NotifyButtonProps) {
  return (
    <div className={`notify-btn${active ? " active" : ""}${focused ? " focused" : ""}`}>
      <span className="notify-icon">
        <img src="/icons/pull.svg" alt="" />
      </span>
      <span className="notify-text">
        <span className="notify-title">Уведомлять</span>
        <span className="notify-caption">о выходе новых серий</span>
      </span>
    </div>
  );
}
