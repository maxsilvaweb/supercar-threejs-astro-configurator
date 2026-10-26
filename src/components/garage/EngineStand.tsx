import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box3, MeshStandardMaterial, Object3D, Vector3, type Group, type Mesh } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  CONFIG_CAR_SCALE as ENGINE_SCALE,
  CONFIG_ENGINE_STAND as STAND,
  ENGINE_V8_MODEL as ENGINE_URL,
} from "../../lib/constants";
import { engineZones, explodeOffset } from "../../lib/engine";
import { finishes } from "../../lib/finishes";
import type { EngineZoneId } from "../../lib/schema";
import { useConfig } from "../../lib/store";

const box = new Box3();
const center = new Vector3();
const partCenter = new Vector3();

interface EnginePart {
  mesh: Mesh;
  rest: Vector3;
  offset: Vector3;
  pulley: boolean;
}

function skipRaycast() {}

/** Rest positions and exploded offsets for every mesh, measured in the engine's own space. */
function measureParts(root: Object3D) {
  root.updateMatrixWorld(true);
  box.setFromObject(root).getCenter(center);
  const parts: EnginePart[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.raycast = skipRaycast;
    box.setFromObject(mesh).getCenter(partCenter);
    parts.push({
      mesh,
      rest: mesh.position.clone(),
      offset: explodeOffset(mesh.name, partCenter, center, new Vector3()),
      pulley: /^gear_/.test(mesh.name),
    });
  });
  return { parts, center: center.clone(), floor: box.min.y };
}

/** Gives each colour zone its own material so recolouring never touches shared ones. */
function zoneMaterials(root: Object3D) {
  const zones = new Map<EngineZoneId, MeshStandardMaterial[]>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    const zone = mesh.isMesh && engineZones.find((entry) => entry.node.test(mesh.name));
    if (!zone || !(mesh.material instanceof MeshStandardMaterial)) return;
    const material = mesh.material.clone();
    mesh.material = material;
    zones.set(zone.id, [...(zones.get(zone.id) ?? []), material]);
  });
  return zones;
}

export function EngineStand() {
  const { scene } = useGLTF(ENGINE_URL);
  const root = useMemo(() => clone(scene) as Group, [scene]);
  const shake = useRef<Group>(null);
  const progress = useRef(0);
  const [spotTarget] = useState(() => new Object3D());
  const layout = useMemo(() => measureParts(root), [root]);
  const zones = useMemo(() => zoneMaterials(root), [root]);
  const engine = useConfig((state) => state.engine);
  const exploded = useConfig((state) => state.engineExploded);
  const running = useConfig((state) => state.engineRunning);
  const revving = useConfig((state) => state.engineRevving);

  useLayoutEffect(() => {
    const finish = finishes[engine.finish];
    for (const [zone, materials] of zones) {
      for (const material of materials) {
        material.color.set(engine.paints[zone]);
        material.roughness = finish.roughness;
        material.metalness = finish.metalness;
      }
    }
  }, [engine.finish, engine.paints, zones]);

  useEffect(
    () => () => {
      for (const materials of zones.values()) materials.forEach((material) => material.dispose());
    },
    [zones],
  );

  useFrame((_, delta) => {
    const target = exploded ? 1 : 0;
    progress.current += (target - progress.current) * Math.min(1, delta * 4);
    const eased = progress.current * progress.current * (3 - 2 * progress.current);
    const spin = running ? (revving ? 42 : 14) * delta : 0;

    for (const part of layout.parts) {
      part.mesh.position.copy(part.rest).addScaledVector(part.offset, eased);
      if (part.pulley) part.mesh.rotation.x += spin;
    }

    const group = shake.current;
    if (!group) return;
    const amplitude = running ? (revving ? 0.0035 : 0.0012) : 0;
    group.position.set(
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
      (Math.random() - 0.5) * amplitude,
    );
  });

  return (
    <group position={[STAND.x, 0, STAND.z]}>
      <primitive object={spotTarget} position={[0, STAND.plinth + 0.7, 0]} />
      <spotLight target={spotTarget} position={[1.6, 4.6, 2]} angle={0.45} penumbra={0.8} intensity={1.6} />
      <mesh position={[0, STAND.plinth / 2, 0]} raycast={skipRaycast}>
        <cylinderGeometry args={[0.85, 0.95, STAND.plinth, 48]} />
        <meshStandardMaterial color="#1b1c1f" roughness={0.42} metalness={0.65} envMapIntensity={0.6} />
      </mesh>
      <group position={[0, STAND.plinth, 0]} rotation={[0, -Math.PI / 2, 0]} scale={ENGINE_SCALE}>
        <group ref={shake}>
          <primitive object={root} position={[-layout.center.x, -layout.floor, -layout.center.z]} />
        </group>
      </group>
    </group>
  );
}
