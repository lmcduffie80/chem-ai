import type Stripe from "stripe";
import { stripe, syncSubscription } from "@/lib/billing/stripe";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) return new Response("Webhook not configured", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch (error) {
    console.warn("Stripe webhook signature verification failed", error instanceof Error ? error.message : error);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      // Re-fetch so out-of-order deliveries always converge on the latest state.
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(await stripe().subscriptions.retrieve(sub.id));
    } else if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        await syncSubscription(await stripe().subscriptions.retrieve(id));
      }
    }
  } catch (error) {
    console.error(`Stripe webhook ${event.type} (${event.id}) failed`, error);
    return new Response("Webhook handler failed", { status: 500 });
  }

  return Response.json({ received: true });
}
