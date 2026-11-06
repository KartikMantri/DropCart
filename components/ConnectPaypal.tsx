/**
 * "Connect PayPal" — a plain form POST to the vault start route, which
 * redirects to PayPal. Works without client JS; usable from server and
 * client components.
 */
export function ConnectPaypal({ next, label = "Connect PayPal (sandbox)" }: { next: string; label?: string }) {
  return (
    <form action="/api/paypal/vault/start" method="post">
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="nb-btn">
        {label}
      </button>
    </form>
  );
}
