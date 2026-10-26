import type { Vector3 } from "three";
import { CONFIG_CAR_SCALE, ENGINE_V12_MODEL, ENGINE_V8_MODEL } from "./constants";
import type { CarSpecFact, EngineBase, EngineId, EngineTune, EngineZoneId, ExhaustId } from "./schema";

export interface EngineZone {
  id: EngineZoneId;
  label: string;
  node: RegExp;
}

export interface EngineDefinition {
  label: string;
  model: string;
  /** Turns the engine so its belt drive faces the front of the stand. */
  yaw: number;
  /** Garage units per metre; the V12 is shrunk a little so it still fits the stand and the camera. */
  scale: number;
  /** Node names come from scripts/build-engine-glb.py, which splits each body by material and cylinder bank. */
  zones: EngineZone[];
  /** Swatch colours for the model's own finish; picking one restores the original material. */
  factoryPaints: Partial<Record<EngineZoneId, string>>;
}

export const engines: Record<EngineId, EngineDefinition> = {
  v8: {
    label: "V8",
    model: ENGINE_V8_MODEL,
    yaw: -Math.PI / 2,
    scale: CONFIG_CAR_SCALE,
    zones: [
      { id: "covers", label: "Valve covers", node: /^block_paintedRough_orange/ },
      { id: "coils", label: "Coil packs", node: /^block_rough_black/ },
      { id: "sump", label: "Sump", node: /^block_paintedMetallic_gray/ },
    ],
    // Converted from the glTF base colour factors.
    factoryPaints: { covers: "#925A2E", coils: "#282828", sump: "#716E6B" },
  },
  v12: {
    label: "V12",
    model: ENGINE_V12_MODEL,
    yaw: Math.PI / 2,
    scale: 1.4,
    zones: [
      { id: "covers", label: "Cam covers", node: /^body_\d+_painted_blue/ },
      { id: "headers", label: "Headers", node: /^body_\d+_bronzePolished/ },
    ],
    // Averages of the albedo textures these materials use.
    factoryPaints: { covers: "#3A42C9", headers: "#D5B8A2" },
  },
};

export const exhaustOptions: { id: ExhaustId; label: string }[] = [
  { id: "stock", label: "Stock" },
  { id: "sport", label: "Sport" },
  { id: "straight", label: "Straight pipe" },
];

export const BOOST_RANGE = { min: 0, max: 100, step: 5 };
export const REV_LIMIT_RANGE = { min: -500, max: 1500, step: 250 };

const exhaustGain: Record<ExhaustId, number> = { stock: 0, sport: 0.03, straight: 0.05 };

/** Loudness of the engine loop per exhaust, before the master volume. */
export const exhaustVolume: Record<ExhaustId, number> = { stock: 1, sport: 1.25, straight: 1.5 };

/** Illustrative multipliers on the factory figures; not a dyno model. */
export function tuneFactors(tune: EngineTune) {
  const boost = tune.boost / BOOST_RANGE.max;
  return {
    power: 1 + boost * 0.18 + (tune.revLimit / REV_LIMIT_RANGE.max) * 0.04 + exhaustGain[tune.exhaust],
    torque: 1 + boost * 0.22 + exhaustGain[tune.exhaust] / 2,
  };
}

export function isStockTune(tune: EngineTune) {
  return tune.boost === 0 && tune.revLimit === 0 && tune.exhaust === "stock";
}

export function tunedFigures(base: EngineBase, tune: EngineTune) {
  const factors = tuneFactors(tune);
  return {
    power: Math.round(base.power * factors.power),
    torque: Math.round(base.torque * factors.torque),
    // Traction-limited cars gain less off the line than on paper, so cap the improvement at 15 %.
    sprint: base.sprint && Math.max(0.85, Math.sqrt(1 / factors.power)) * base.sprint.seconds,
  };
}

export function formatPower(base: EngineBase, value: number) {
  return `${value.toLocaleString("en-GB")} ${base.powerUnit}`;
}

export function formatTorque(base: EngineBase, value: number) {
  return `${value.toLocaleString("en-GB")} ${base.torqueUnit}`;
}

export function formatSprint(seconds: number) {
  return `${seconds.toFixed(seconds < 10 ? 2 : 1).replace(/0$/, "")} s`;
}

export function formatGain(factor: number) {
  const percent = Math.round((factor - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

/** Replaces Power, Torque and sprint values in a spec list with the tuned figures. */
export function tunedSpecFacts(facts: CarSpecFact[], base: EngineBase | undefined, tune: EngineTune) {
  if (!base || isStockTune(tune)) return facts;
  const tuned = tunedFigures(base, tune);
  return facts.map((fact) => {
    if (fact.label === "Power") return { ...fact, value: formatPower(base, tuned.power) };
    if (fact.label === "Torque") return { ...fact, value: formatTorque(base, tuned.torque) };
    if (tuned.sprint && fact.label === base.sprint?.label) return { ...fact, value: formatSprint(tuned.sprint) };
    return fact;
  });
}

/** Where a part sits in the exploded view, relative to its rest position, in engine metres. */
export function explodeOffset(name: string, part: Vector3, center: Vector3, out: Vector3) {
  out.subVectors(part, center);
  const reach = out.length();
  if (reach < 0.06) return out.set(0, 0, 0);
  const push = /^(gear|pulley|strap)_/.test(name) ? 0.38 : 0.2;
  return out.normalize().multiplyScalar(push * (0.4 + reach));
}
