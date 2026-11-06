import "server-only";
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentInitiator,
  PaymentsController,
  PaypalPaymentTokenUsageType,
  StoredPaymentSourceUsageType,
  VaultController,
  VaultTokenRequestType,
} from "@paypal/paypal-server-sdk";
import { paypalEnv, requireEnv } from "./env";

/**
 * Everything DropCart says to PayPal goes through this file (PayPal Server
 * SDK, sandbox only). Written with the APIMatic ContextMatic MCP tools — see
 * docs/contextmatic.md for the prompts behind each function.
 *
 *   createVaultSetupToken   user consents once: save PayPal for later
 *   exchangeSetupToken      approved setup token → reusable payment token
 *   chargeVaultedPayment    merchant-initiated order + capture, idempotent
 *   refundCapture           full refund of a capture, idempotent
 *
 * Only PayPal token ids are ever stored — never card or wallet details.
 */

export class PaypalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** PayPal's debug_id, for support tickets and the audit log. */
    readonly debugId: string | null,
    readonly issue: string | null,
  ) {
    super(message);
  }
}

type Controllers = { vault: VaultController; orders: OrdersController; payments: PaymentsController };

const globalForPaypal = globalThis as unknown as { paypal?: Controllers };

function controllers(): Controllers {
  if (!globalForPaypal.paypal) {
    paypalEnv(); // throws unless PAYPAL_ENV is sandbox (or unset)
    const client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: requireEnv("PAYPAL_CLIENT_ID"),
        oAuthClientSecret: requireEnv("PAYPAL_CLIENT_SECRET"),
      },
      timeout: 20_000,
      environment: Environment.Sandbox,
    });
    globalForPaypal.paypal = {
      vault: new VaultController(client),
      orders: new OrdersController(client),
      payments: new PaymentsController(client),
    };
  }
  return globalForPaypal.paypal;
}

/** Turn an SDK ApiError into a PaypalError that keeps PayPal's debug_id. */
function wrap(action: string, err: unknown): never {
  if (err instanceof ApiError) {
    let body: { debug_id?: string; message?: string; details?: { issue?: string; description?: string }[] } = {};
    try {
      body = typeof err.body === "string" ? JSON.parse(err.body) : {};
    } catch {
      /* non-JSON body */
    }
    const detail = body.details?.[0];
    throw new PaypalError(
      `PayPal ${action} failed (${err.statusCode}): ${detail?.description ?? body.message ?? "unknown error"}`,
      err.statusCode,
      body.debug_id ?? null,
      detail?.issue ?? null,
    );
  }
  throw err;
}

/** PayPal amounts are strings with two decimals. */
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

// ── Vault ────────────────────────────────────────────────────────────────

export type SetupToken = { setupTokenId: string; approveUrl: string };

/**
 * Step 1 of "vault without purchase": a setup token for a PayPal wallet,
 * usable later by DropCart as the merchant (usageType MERCHANT). The user
 * opens approveUrl, logs in to PayPal and agrees; PayPal then redirects to
 * returnUrl with ?approval_token_id=<setupTokenId>.
 */
export async function createVaultSetupToken(opts: {
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}): Promise<SetupToken> {
  try {
    const { result } = await controllers().vault.createSetupToken({
      paypalRequestId: opts.requestId,
      body: {
        paymentSource: {
          paypal: {
            usageType: PaypalPaymentTokenUsageType.Merchant,
            description: "DropCart buys a tracked item for you when it drops to your price.",
            permitMultiplePaymentTokens: false,
            experienceContext: {
              brandName: "DropCart",
              returnUrl: opts.returnUrl,
              cancelUrl: opts.cancelUrl,
            },
          },
        },
      },
    });
    const approveUrl = result.links?.find((l) => l.rel === "approve")?.href;
    if (!result.id || !approveUrl) {
      throw new PaypalError("PayPal setup token response had no id or approve link.", null, null, null);
    }
    return { setupTokenId: result.id, approveUrl };
  } catch (err) {
    wrap("vault setup", err);
  }
}

export type PaymentToken = { paymentTokenId: string; customerId: string | null };

/**
 * Step 2: exchange the approved setup token for a long-lived payment token.
 * Idempotent per setup token, so a double-loaded return page is harmless.
 */
export async function exchangeSetupToken(setupTokenId: string): Promise<PaymentToken> {
  try {
    const { result } = await controllers().vault.createPaymentToken({
      paypalRequestId: `vault:${setupTokenId}`,
      body: { paymentSource: { token: { id: setupTokenId, type: VaultTokenRequestType.SetupToken } } },
    });
    if (!result.id) {
      throw new PaypalError("PayPal payment token response had no id.", null, null, null);
    }
    return { paymentTokenId: result.id, customerId: result.customer?.id ?? null };
  } catch (err) {
    wrap("vault exchange", err);
  }
}

// ── Orders ───────────────────────────────────────────────────────────────

export type Charge = {
  orderId: string;
  captureId: string;
  /** Capture status: COMPLETED, or PENDING while PayPal reviews it. */
  status: string;
  amount: string;
  currency: string;
};

/**
 * Charge a vaulted PayPal wallet with no buyer present.
 *
 * requestId becomes the PayPal-Request-Id header on both calls, so retrying
 * with the same id returns the original order/capture instead of charging
 * twice. lib/purchase.ts uses `${watchId}:${priceCheckId}`.
 *
 * With a vault id, PayPal usually captures inside createOrder and returns
 * status COMPLETED with the capture attached. If it returns an order that is
 * not yet captured, captureOrder finishes it.
 */
export async function chargeVaultedPayment(opts: {
  vaultId: string;
  amount: number;
  /** The mandate's limit. A last, independent check: never send more. */
  maxAmount: number;
  currency: string;
  requestId: string;
  description: string;
  referenceId: string;
}): Promise<Charge> {
  if (!(opts.amount > 0) || Math.round(opts.amount * 100) > Math.round(opts.maxAmount * 100)) {
    throw new PaypalError(
      `Refusing to charge ${money(opts.amount)}: the limit is ${money(opts.maxAmount)}.`,
      null,
      null,
      "OVER_MANDATE",
    );
  }
  const { orders } = controllers();
  try {
    const created = await orders.createOrder({
      paypalRequestId: opts.requestId,
      prefer: "return=representation",
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            referenceId: opts.referenceId,
            description: opts.description.slice(0, 127),
            amount: { currencyCode: opts.currency, value: money(opts.amount) },
          },
        ],
        paymentSource: {
          paypal: {
            vaultId: opts.vaultId,
            // PayPal-wallet stored credentials have no paymentType (that
            // field is card-only), just who initiated and first/subsequent.
            storedCredential: {
              paymentInitiator: PaymentInitiator.Merchant,
              usage: StoredPaymentSourceUsageType.Subsequent,
            },
          },
        },
      },
    });

    let order = created.result;
    const orderId = order.id;
    if (!orderId) throw new PaypalError("PayPal order response had no id.", null, null, null);

    if (order.status !== "COMPLETED") {
      const captured = await orders.captureOrder({
        id: orderId,
        paypalRequestId: `${opts.requestId}:capture`,
        prefer: "return=representation",
      });
      order = captured.result;
    }

    const capture = order.purchaseUnits?.[0]?.payments?.captures?.[0];
    if (!capture?.id) {
      throw new PaypalError(
        `PayPal order ${orderId} is ${order.status ?? "in an unknown state"} with no capture.`,
        null,
        null,
        null,
      );
    }
    const status = capture.status ?? "UNKNOWN";
    if (status !== "COMPLETED" && status !== "PENDING") {
      throw new PaypalError(`PayPal capture ${capture.id} is ${status}.`, null, null, status);
    }
    return {
      orderId,
      captureId: capture.id,
      status,
      amount: capture.amount?.value ?? money(opts.amount),
      currency: capture.amount?.currencyCode ?? opts.currency,
    };
  } catch (err) {
    wrap("charge", err);
  }
}

// ── Refunds ──────────────────────────────────────────────────────────────

export type RefundResult = { refundId: string; status: string };

/** Full refund (no body = refund the whole capture). Idempotent per requestId. */
export async function refundCapture(captureId: string, requestId: string): Promise<RefundResult> {
  try {
    const { result } = await controllers().payments.refundCapturedPayment({
      captureId,
      paypalRequestId: requestId,
      prefer: "return=representation",
    });
    if (!result.id) throw new PaypalError("PayPal refund response had no id.", null, null, null);
    return { refundId: result.id, status: result.status ?? "UNKNOWN" };
  } catch (err) {
    wrap("refund", err);
  }
}
