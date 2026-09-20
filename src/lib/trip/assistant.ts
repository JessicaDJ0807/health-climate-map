// Answers questions about the trip currently on screen.
//
// Every reply is generated from the scored routes, so the numbers it quotes
// are the same ones on the cards. It matches intent by keyword and does not
// call a language model: it cannot answer anything outside the current trip,
// and says so rather than inventing an answer.
import { PROFILES, ROLE_LABELS, type ProfileId, type TripResult } from "./score";
import type { Conditions } from "./score";
import { SHOW_POLLEN } from "./features";

export type Answer = { text: string; grounded: boolean };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const min = (v: number) => `${Math.round(v)} min`;

type Scored = TripResult["routes"][number];

function nameOf(r: Scored) {
  return r.roles.map((role) => ROLE_LABELS[role]).join(" · ");
}

/**
 * "X, at N, against M on the fastest" — but when the best route on a measure
 * *is* the fastest, there is nothing to contrast it with, so say that instead
 * of comparing the route to itself.
 */
function versus(best: Scored, fastest: Scored, bestValue: string, fastestValue: string) {
  return best.id === fastest.id
    ? `${nameOf(best)}, at ${bestValue} — it is also the fastest option, so there is nothing to trade off here`
    : `${nameOf(best)} at ${bestValue}, against ${fastestValue} on the fastest route`;
}

const INTENTS = [
  { key: "pollen", words: SHOW_POLLEN ? ["pollen", "allerg", "hay fever", "sneez"] : [] },
  { key: "shade", words: ["shade", "tree", "shady", "sun cover", "canopy"] },
  { key: "traffic", words: ["traffic", "truck", "road", "busy", "car"] },
  { key: "air", words: ["air", "pm2", "pm 2", "no2", "no₂", "pollut", "smog"] },
  { key: "heat", words: ["heat", "hot", "sun", "temperature", "warm"] },
  { key: "time", words: ["long", "minute", "time", "fast", "quick", "slow"] },
  { key: "why", words: ["why", "recommend", "best", "which route", "should i", "pick"] },
  { key: "method", words: ["data", "source", "how do you", "how does", "method", "accurate", "where do"] },
] as const;

function intentOf(q: string) {
  const lower = q.toLowerCase();
  return INTENTS.find((i) => i.words.some((w) => lower.includes(w)))?.key ?? null;
}

export function answer(
  question: string,
  result: TripResult | null,
  cond: Conditions,
  profileId: ProfileId,
): Answer {
  const intent = intentOf(question);

  if (intent === "method") {
    return {
      grounded: true,
      text:
        "Shade comes from the NYC Parks Forestry tree inventory, traffic from DOT truck routes, air from annual " +
        "PM2.5 and NO₂ by community district, and heat from Heat Vulnerability Index surface temperature plus the " +
        "National Weather Service forecast and sun position. They are estimates for comparing routes, not health " +
        "measurements.",
    };
  }

  if (!result) {
    return {
      grounded: false,
      text: "Set a start and destination first — then I can compare the routes by shade, traffic, air and heat.",
    };
  }

  const rec = result.routes.find((r) => r.id === result.recommendedId)!;
  const fastest = result.routes.find((r) => r.roles.includes("fastest")) ?? rec;
  const who = PROFILES[profileId].short;

  switch (intent) {
    case "why":
      return { grounded: true, text: result.explanation };

    case "time": {
      const extra = Math.round(rec.extraMinutes);
      const lines = result.routes.map((r) => `${nameOf(r)} ${min(r.minutes)} (${r.km.toFixed(1)} km)`).join("; ");
      return {
        grounded: true,
        text:
          extra <= 0
            ? `The route I'd pick for ${who} is also the fastest, at ${min(rec.minutes)}. All options: ${lines}.`
            : `${nameOf(rec)} takes ${min(rec.minutes)} — ${extra} more than the fastest at ${min(fastest.minutes)}. All options: ${lines}.`,
      };
    }

    case "shade": {
      const best = result.routes.reduce((a, b) => (b.shade > a.shade ? b : a));
      const source = best.shadeSource === "trees" ? "counted from individual trees" : "estimated from neighborhood tree density";
      const sun = best.id === fastest.id
        ? `That leaves ${min(best.metrics.sunMinutes)} in direct sun.`
        : `At this departure time that is ${min(best.metrics.sunMinutes)} in direct sun rather than ${min(fastest.metrics.sunMinutes)}.`;
      return {
        grounded: true,
        text: `Most tree cover: ${versus(best, fastest, pct(best.shade), pct(fastest.shade))}. ${sun} Shade is ${source}.`,
      };
    }

    case "traffic": {
      const best = result.routes.reduce((a, b) => (b.metrics.trafficMinutes < a.metrics.trafficMinutes ? b : a));
      return {
        grounded: true,
        text: `Least time beside truck routes: ${versus(best, fastest, min(best.metrics.trafficMinutes), min(fastest.metrics.trafficMinutes))}. That counts any point within 30 m of a designated DOT truck route.`,
      };
    }

    case "air": {
      const best = result.routes.reduce((a, b) => (b.metrics.airIndex < a.metrics.airIndex ? b : a));
      const same = result.routes.every((r) => Math.abs(r.metrics.airIndex - rec.metrics.airIndex) < 0.02);
      return {
        grounded: true,
        text: same
          ? `These routes all pass through the same air-quality districts, so air doesn't separate them here — every option reads ${rec.metrics.airLevel.toLowerCase()} against other NYC neighborhoods. Traffic proximity is what differs.`
          : `${nameOf(best)} has the lowest air index of the three (${best.metrics.airLevel.toLowerCase()} relative to other NYC neighborhoods). These are annual averages by community district, not live readings.`,
      };
    }

    case "heat": {
      const best = result.routes.reduce((a, b) => (b.metrics.sunMinutes < a.metrics.sunMinutes ? b : a));
      const weather = cond.forecast ? `It's ${cond.forecast.tempF}°F, feels like ${cond.forecast.heatIndexF}°F. ` : "";
      const sun = cond.sunFactor === 0 ? "The sun is down, so shade barely matters for this departure." : `Sun factor is ${cond.sunFactor.toFixed(2)}.`;
      return {
        grounded: true,
        text: `${weather}${sun} Least direct sun: ${versus(best, fastest, min(best.metrics.sunMinutes), min(fastest.metrics.sunMinutes))}.`,
      };
    }

    case "pollen": {
      if (cond.pollenFactor === 0) {
        return {
          grounded: true,
          text: "Tree pollen is out of season right now, so it isn't affecting the ranking. In spring I compare how many wind-pollinated trees — oak, planetree, maple — each route passes.",
        };
      }
      const best = result.routes.reduce((a, b) => (b.metrics.pollenIndex < a.metrics.pollenIndex ? b : a));
      return {
        grounded: true,
        text: `Season is at ${Math.round(cond.pollenFactor * 100)}% of peak. The lightest allergenic load here is ${best.metrics.pollenLevel.toLowerCase()} for NYC, counted as time beside wind-pollinated trees: ${versus(best, fastest, min(best.metrics.pollenMinutes), min(fastest.metrics.pollenMinutes))}. Estimated from tree species, not a pollen measurement.`,
      };
    }

    default:
      return {
        grounded: true,
        text: `For ${who} I'd take ${nameOf(rec)}: ${min(rec.minutes)}, ${pct(rec.shade)} shaded, ${min(rec.metrics.trafficMinutes)} near truck routes, exposure ${rec.metrics.exposure}/100. Ask me about shade, traffic, air, heat, timing, or where the data comes from.`,
      };
  }
}

/** Starter questions, matched to what this trip can actually answer. */
export function suggestions(result: TripResult | null, cond: Conditions): string[] {
  if (!result) return ["What can you compare?", "Where does the data come from?"];
  const base = ["Why this route?", "How much longer is it?", "Which has the most shade?", "What about traffic?"];
  if (SHOW_POLLEN && cond.pollenFactor > 0) base.splice(2, 0, "How's the pollen?");
  return base;
}
