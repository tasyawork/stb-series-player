type SubscriptionButtonProps = {
  focused: boolean;
};

/** Button_STB Subscription из Figma 1299:14143. */
export function SubscriptionButton({ focused }: SubscriptionButtonProps) {
  return (
    <div className={`subscription-btn${focused ? " focused" : ""}`}>
      <span className="subscription-icon">
        <img src="/icons/subscription-warning.svg" alt="" />
      </span>
      <span className="subscription-text">
        <span className="subscription-title">Оформить подписку</span>
        <span className="subscription-caption">чтобы смотреть все серии</span>
      </span>
    </div>
  );
}
