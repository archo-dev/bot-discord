import { DisclosureCard } from "../../../ui/disclosure.js";
import { FAQ_ITEMS } from "./data.js";

/* FAQ d'objections (M4) — réutilise DisclosureCard (accordéon accessible). */
export function PricingFaq() {
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {FAQ_ITEMS.map((item) => (
        <DisclosureCard key={item.question} title={item.question}>
          <p className="text-[13px] leading-relaxed text-zinc-400">{item.answer}</p>
        </DisclosureCard>
      ))}
    </div>
  );
}
